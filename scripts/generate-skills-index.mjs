#!/usr/bin/env node
/*
 * Sigistry skills index.
 *
 * Walks every registry-hosted plugin's skills (including the container layout
 * skills/<container>/<variant>/SKILL.md), and for externally-hosted plugins
 * with a commit pin, clones exactly that commit and indexes its skills too.
 * Joins the parent plugin's verification status from verified.json and writes
 * .claude-plugin/skills.json - the data source for sigistry.com/skills and
 * MCP search_skills / get_skill.
 *
 * External skills are indexed by reference only: skills.json records
 * repo + commit + path, and consumers fetch SKILL.md from the AUTHOR'S repo
 * at the pinned (immutable) commit. No source is copied into this repo;
 * delisting an entry removes it everywhere, with nothing to clean up.
 *
 * Pure Node, no dependencies. Usage: node scripts/generate-skills-index.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

// Defense in depth for external clones: never follow symlinks out of the
// checkout (a hostile repo could point skills/x/SKILL.md at a local file and
// have its contents ingested into the published index).
const isRealPath = (p) => {
  try {
    return !fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** YAML-ish frontmatter parser, kept in sync with verify-plugins.mjs. Handles
 * single-line scalars plus block scalars (`key: >` folded / `key: |` literal,
 * optional +/- chomp), whose value is the following indented lines. A naive
 * line-by-line parse captured the value as just ">" and mis-indexed a rich
 * multi-line description as the bare folded-scalar marker. */
function frontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let val = kv[2].trim();
    if (/^[|>][+-]?$/.test(val)) {
      const block = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^\s/.test(lines[i + 1]))) {
        block.push(lines[++i].trim());
      }
      val = block.join(' ').trim();
    }
    out[key] = val;
  }
  return out;
}

/** Skill dirs in both layouts (keep in sync with verify-plugins listSkillDirs). */
function listSkillDirs(skillsDir) {
  const out = [];
  for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue; // isDirectory() is false for symlinks here
    const dir = path.join(skillsDir, e.name);
    if (exists(path.join(dir, 'SKILL.md')) && isRealPath(path.join(dir, 'SKILL.md'))) {
      out.push({ name: e.name, dir, rel: e.name });
      continue;
    }
    const variants = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (v) =>
          v.isDirectory() &&
          exists(path.join(dir, v.name, 'SKILL.md')) &&
          isRealPath(path.join(dir, v.name, 'SKILL.md'))
      );
    for (const v of variants) {
      out.push({ name: v.name, dir: path.join(dir, v.name), rel: `${e.name}/${v.name}` });
    }
  }
  return out;
}

function collectSkills(skillsDir, entry, v, base) {
  const out = [];
  if (!exists(skillsDir)) return out;
  for (const s of listSkillDirs(skillsDir)) {
    const fm = frontmatter(read(path.join(s.dir, 'SKILL.md'))) ?? {};
    out.push({
      name: fm.name || s.name,
      description: fm.description || '',
      plugin: entry.name,
      pluginCategory: entry.category ?? null,
      status: v?.status ?? 'unknown',
      verifiedDate: v?.date ?? null,
      firstSeen: v?.firstSeen ?? null, // parent plugin's registry-entry date; drives "newest first" + New badge
      ...base(s),
    });
  }
  return out;
}

const marketplace = JSON.parse(read(path.join(ROOT, '.claude-plugin', 'marketplace.json')));
const verified = JSON.parse(read(path.join(ROOT, '.claude-plugin', 'verified.json')));

const git = (cmd, opts = {}) =>
  execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 120000, ...opts }).trim();

// The external pin is the marketplace entry's own `git-subdir` source: its `sha`
// is the exact commit Claude Code installs, and the commit we index skills from.
// One source of truth, shared with verify-plugins.mjs (no separate pin file).
function pinFromSource(entry) {
  const s = entry.source;
  if (!s || typeof s === 'string' || !s.sha) return null;
  const m = /(?:github\.com[/:])([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(s.url ?? '');
  if (!m) return null;
  return { repo: m[1], commit: s.sha, path: s.path ?? '.' };
}

const skills = [];
for (const entry of marketplace.plugins) {
  const v = verified.plugins?.[entry.name];

  // Registry-hosted: walk the vendored tree; path is relative to THIS repo.
  if (typeof entry.source === 'string') {
    const src = entry.source.replace(/^\.\//, '');
    skills.push(
      ...collectSkills(path.join(ROOT, src, 'skills'), entry, v, (s) => ({
        hosting: 'registry',
        path: `${src}/skills/${s.rel}`,
      }))
    );
    continue;
  }

  // Externally-hosted with a commit pin: clone exactly that commit and index
  // by reference. Without a pin there is nothing immutable to point at.
  // Pin fields are interpolated into git commands, so validate their shape
  // even though the source (and its sha) only changes via reviewed PRs (same
  // rules as verify-plugins.mjs validatePin).
  const pin = pinFromSource(entry);
  if (!pin?.repo || !pin?.commit) continue;
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(pin.repo) ||
    !/^[0-9a-f]{7,40}$/i.test(pin.commit) ||
    (pin.path && (pin.path.includes('..') || path.isAbsolute(pin.path)))
  ) {
    console.warn(`external ${entry.name}: invalid pin shape, skipping`);
    continue;
  }
  const sub = pin.path && pin.path !== '.' ? `${pin.path.replace(/\/+$/, '')}/` : '';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-skills-'));
  try {
    git('init -q', { cwd: tmp });
    git(`remote add origin https://github.com/${pin.repo}.git`, { cwd: tmp });
    git(`fetch -q --depth 1 origin ${pin.commit}`, { cwd: tmp });
    git('checkout -q FETCH_HEAD', { cwd: tmp });
    skills.push(
      ...collectSkills(path.join(tmp, pin.path ?? '.', 'skills'), entry, v, (s) => ({
        hosting: 'external',
        repo: pin.repo,
        commit: pin.commit,
        path: `${sub}skills/${s.rel}`,
      }))
    );
  } catch (e) {
    console.warn(`external ${entry.name}: could not index at pin (${String(e.message ?? e).slice(0, 120)})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

skills.sort((a, b) => a.name.localeCompare(b.name));

// Consistency guard (added after wentong2022-arch caught a folded-scalar +
// stale-verified.json bug on flowforge-skill, PR #19): every indexed skill must
// carry a real description (not empty, not a bare YAML block-scalar marker) and
// a status/date/firstSeen that agrees with its parent plugin's verified.json
// entry. Fail the build rather than ship a wrong catalog row. The status/date
// arm also enforces run order: verify-plugins.mjs must run before this script.
const markerDesc = skills.filter((s) => !s.description || /^[|>][+-]?$/.test(s.description));
const staleJoin = skills.filter((s) => {
  const pv = verified.plugins?.[s.plugin];
  return (
    pv &&
    (s.status !== pv.status ||
      s.verifiedDate !== (pv.date ?? null) ||
      s.firstSeen !== (pv.firstSeen ?? null))
  );
});
if (markerDesc.length || staleJoin.length) {
  for (const s of markerDesc)
    console.error(`  empty/marker description: ${s.plugin}/${s.name} -> ${JSON.stringify(s.description)}`);
  for (const s of staleJoin) {
    const pv = verified.plugins[s.plugin];
    console.error(
      `  status/date mismatch: ${s.plugin}/${s.name} (index ${s.status}/${s.verifiedDate}/${s.firstSeen} vs verified.json ${pv.status}/${pv.date ?? null}/${pv.firstSeen ?? null})`
    );
  }
  throw new Error('skills index consistency check failed (see above). Run "node scripts/verify-plugins.mjs" first, then regenerate.');
}

const out = {
  $comment: 'Generated by scripts/generate-skills-index.mjs. Data source for sigistry.com/skills. Do not edit by hand.',
  methodologyUrl: 'https://sigistry.com/skill-verification',
  generated: new Date().toISOString(),
  count: skills.length,
  skills,
};

fs.writeFileSync(path.join(ROOT, '.claude-plugin', 'skills.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`${skills.length} skills across ${new Set(skills.map((s) => s.plugin)).size} plugins. Wrote .claude-plugin/skills.json`);
