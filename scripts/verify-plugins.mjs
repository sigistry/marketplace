#!/usr/bin/env node
/*
 * Sigistry plugin verification.
 *
 * Runs the public verification methodology (https://sigistry.com/verification)
 * against every plugin in marketplace.json and writes the machine-readable result
 * to .claude-plugin/verified.json. That file is the source of truth for the
 * "Verified by Sigistry" badges served at sigistry.com/badge/<id>.svg.
 *
 * Pure Node, no dependencies. Static analysis only: nothing is executed.
 *
 * Usage: node scripts/verify-plugins.mjs
 * Exit code 0 always (the report is the output); CI can gate on the JSON.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const METHODOLOGY_VERSION = '1.2';

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

/** Parse the YAML-ish frontmatter block of a .md file into a flat map (regex, v1). */
function frontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim();
  }
  return out;
}

/** Collect all files under dir (relative paths), or [] if missing. */
function walk(dir, base = dir) {
  if (!exists(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks. Each returns { status: 'pass'|'fail'|'n/a', detail }.
// ---------------------------------------------------------------------------

function checkManifestIntegrity(pluginDir, entry) {
  const problems = [];
  const pj = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  if (!exists(pj)) problems.push('missing .claude-plugin/plugin.json');
  else {
    try {
      const parsed = JSON.parse(read(pj));
      if (entry && parsed.name !== entry.name)
        problems.push(`plugin.json name "${parsed.name}" != marketplace entry "${entry.name}"`);
      if (!parsed.version) problems.push('plugin.json missing version');
      if (!parsed.license) problems.push('plugin.json missing license');
      if (!parsed.description) problems.push('plugin.json missing description');
      // Ported from the retired validate-plugins.sh structural validator.
      if (parsed.name && !/^[a-z0-9-]+$/.test(parsed.name))
        problems.push(`plugin name "${parsed.name}" must be lowercase alphanumeric with hyphens`);
      if (parsed.version && !/^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?(\+[A-Za-z0-9.-]+)?$/.test(parsed.version))
        problems.push(`version "${parsed.version}" does not follow semantic versioning`);
    } catch {
      problems.push('plugin.json is not valid JSON');
    }
  }
  // Standalone mode (no marketplace entry yet): only plugin.json is checkable.
  if (!entry) {
    return problems.length
      ? { status: 'fail', detail: problems.join('; ') }
      : {
          status: 'pass',
          detail: 'plugin.json valid and complete (marketplace-entry cross-check runs at submission)',
        };
  }
  // Every path the marketplace entry advertises must exist on disk.
  for (const kind of ['commands', 'agents', 'skills']) {
    for (const rel of entry[kind] ?? []) {
      if (!exists(path.join(pluginDir, rel))) problems.push(`${kind} entry not on disk: ${rel}`);
    }
  }
  // Reverse: files on disk the manifest forgot (drift the other way). Only
  // enforceable when the entry declares the arrays at all; external entries
  // may list none, and then auto-discovery is the contract.
  const declaresArrays = ['commands', 'agents', 'skills'].some((k) => entry[k]);
  if (declaresArrays) {
    const listed = new Set(
      ['commands', 'agents', 'skills'].flatMap((k) => (entry[k] ?? []).map((r) => r.replace(/^\.\//, '')))
    );
    const onDisk = [
      ...walk(path.join(pluginDir, 'commands')).map((f) => `commands/${f}`),
      ...walk(path.join(pluginDir, 'agents')).map((f) => `agents/${f}`),
      ...walk(path.join(pluginDir, 'skills')).filter((f) => f.endsWith('SKILL.md')).map((f) => `skills/${f}`),
    ];
    for (const f of onDisk) {
      if (f.endsWith('.md') && !listed.has(f)) problems.push(`on disk but not in marketplace entry: ${f}`);
    }
  }
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : { status: 'pass', detail: 'plugin.json valid; marketplace entry matches disk in both directions' };
}

const HOOK_FORBIDDEN = [
  [/\bfetch\s*\(|\bXMLHttpRequest\b|\bhttps?\.request\b|\bnet\.connect\b|\bWebSocket\b/, 'network call'],
  [/\bwriteFileSync?\s*\(|\bappendFileSync?\s*\(|\bcreateWriteStream\b|\bunlinkSync?\s*\(|\brmSync\s*\(/, 'filesystem write'],
  // ".env" must not match reading the process environment (process.env,
  // import.meta.env), only .env *files* and other credential stores.
  [/(?<!process)(?<!import\.meta)\.env\b|\bid_rsa\b|\.aws\b|credentials/i, 'credential/env access'],
  [/\beval\s*\(|\bFunction\s*\(/, 'dynamic code evaluation'],
];

// Subprocess use in a hook is acceptable ONLY for constant, read-only git
// introspection (the common "gather git context" pattern). Anything dynamic,
// non-git, or write-capable fails.
const SUBPROCESS_ALLOWLIST = [
  'git rev-parse', 'git diff', 'git describe', 'git rev-list', 'git status',
  'git log', 'git branch', 'git ls-files', 'git tag', 'git show', 'git config --get',
];

function analyzeSubprocess(src, rel) {
  const problems = [];
  if (!/\bchild_process\b|\bexecSync?\s*\(|\bspawnSync?\s*\(|\bexecFile\b/.test(src)) {
    return { uses: false, problems };
  }
  // Any command assembled from a template literal with interpolation is dynamic.
  if (/(?:sh|exec\w*|spawn\w*)\s*\(\s*`[^`]*\$\{/.test(src)) {
    problems.push(`${rel}: subprocess command built dynamically from interpolated input`);
  }
  const literals = [...src.matchAll(/\b(?:sh|execSync|execFileSync)\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const cmd of literals) {
    if (!SUBPROCESS_ALLOWLIST.some((a) => cmd.startsWith(a))) {
      problems.push(`${rel}: non-allowlisted subprocess command "${cmd}"`);
    }
  }
  if (literals.length === 0 && problems.length === 0) {
    problems.push(`${rel}: subprocess used but commands not statically resolvable`);
  }
  return { uses: true, problems };
}

function checkHookSafety(pluginDir) {
  const hj = path.join(pluginDir, 'hooks', 'hooks.json');
  if (!exists(hj)) return { status: 'n/a', detail: 'no hooks' };
  const problems = [];
  let config;
  try {
    config = JSON.parse(read(hj));
  } catch {
    return { status: 'fail', detail: 'hooks.json is not valid JSON' };
  }
  // Collect referenced scripts via ${CLAUDE_PLUGIN_ROOT}.
  const cmds = JSON.stringify(config).match(/\$\{CLAUDE_PLUGIN_ROOT\}[^"\\]*/g) ?? [];
  const scripts = cmds.map((c) => c.replace('${CLAUDE_PLUGIN_ROOT}', '').replace(/^[\\/]/, ''));
  if (scripts.length === 0) problems.push('hooks.json references no ${CLAUDE_PLUGIN_ROOT} script');
  for (const rel of scripts) {
    const sp = path.join(pluginDir, rel);
    if (!exists(sp)) {
      problems.push(`referenced script missing: ${rel}`);
      continue;
    }
    const src = read(sp);
    for (const [re, label] of HOOK_FORBIDDEN) {
      if (re.test(src)) problems.push(`${rel}: ${label}`);
    }
    problems.push(...analyzeSubprocess(src, rel).problems);
    // Accept exit(0) literally or exit(<var>) where a variable defaults to 0
    // (the `let code = 0; try {...} catch {...} process.exit(code)` pattern).
    if (!/process\.exit\(\s*(?:0|[A-Za-z_$][\w$]*)\s*\)/.test(src))
      problems.push(`${rel}: no unconditional exit(0) fail-safe`);
    if (!/catch/.test(src)) problems.push(`${rel}: no try/catch fail-safe`);
  }
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : {
        status: 'pass',
        detail: `${scripts.length} hook script(s): advisory-only, no network, no fs writes, no credential access, subprocess (if any) limited to constant read-only git commands, fail-safe exit(0)`,
      };
}

function checkAgentToolScope(pluginDir) {
  const files = walk(path.join(pluginDir, 'agents')).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return { status: 'n/a', detail: 'no agents' };
  const problems = [];
  const scopes = [];
  for (const f of files) {
    const fm = frontmatter(read(path.join(pluginDir, 'agents', f)));
    if (!fm) {
      problems.push(`${f}: no frontmatter`);
      continue;
    }
    const tools = fm.tools ?? '';
    if (!tools) {
      problems.push(`${f}: no explicit tools restriction (inherits everything)`);
      continue;
    }
    scopes.push(`${f.replace('.md', '')}: ${tools.replace(/[[\]"]/g, '')}`);
    // Read-only-by-description agents must not carry write tools.
    const readOnlyByName = /audit|analyz|review|scan|report|read-only|checker/i.test(f + (fm.description ?? ''));
    const hasWrite = /"(Write|Edit)"/.test(tools);
    // Agents whose stated job is producing or changing files (hardener, writer,
    // reconciler, migrator...) legitimately carry Write/Edit; only pure
    // analysis agents are barred from them.
    const isRemediator = /reconcil|migrat|remediat|fix|harden|writer|writ(e|ing)|generat|author|apply/i.test(
      f + (fm.description ?? '')
    );
    if (readOnlyByName && hasWrite && !isRemediator) {
      problems.push(`${f}: analysis-type agent declares Write/Edit`);
    }
  }
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : { status: 'pass', detail: `all ${files.length} agent(s) declare explicit least-privilege tools. ${scopes.join(' | ')}` };
}

function checkCommandHygiene(pluginDir) {
  const files = walk(path.join(pluginDir, 'commands')).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return { status: 'n/a', detail: 'no commands' };
  const problems = [];
  for (const f of files) {
    const fm = frontmatter(read(path.join(pluginDir, 'commands', f)));
    if (!fm) problems.push(`${f}: no frontmatter`);
    else if (!fm.description) problems.push(`${f}: no description`);
  }
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : { status: 'pass', detail: `all ${files.length} command(s) carry frontmatter with a description` };
}

function checkSkillStructure(pluginDir) {
  const skillsDir = path.join(pluginDir, 'skills');
  if (!exists(skillsDir)) return { status: 'n/a', detail: 'no skills' };
  const problems = [];
  const entries = listSkillDirs(skillsDir);
  for (const s of entries) {
    const label = s.container ? `${s.container}/${s.name}` : s.name;
    if (s.missing) {
      problems.push(`${label}: missing SKILL.md`);
      continue;
    }
    const sk = path.join(s.dir, 'SKILL.md');
    const fm = frontmatter(read(sk));
    if (!fm?.name || !fm?.description) problems.push(`${label}: SKILL.md missing name/description frontmatter`);
    // Reference files mentioned in the skill must exist.
    const refs = read(sk).match(/references\/[A-Za-z0-9._-]+\.md/g) ?? [];
    for (const r of new Set(refs)) {
      if (!exists(path.join(s.dir, r))) problems.push(`${label}: referenced ${r} missing`);
    }
  }
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : { status: 'pass', detail: `all ${entries.length} skill(s) have valid SKILL.md and every referenced reference file exists` };
}

// ---------------------------------------------------------------------------
// Skill safety (methodology v1.1). A SKILL.md is injected into the agent's
// context when the skill triggers, which makes skills a prompt-injection
// vector: a hostile skill can try to override instructions, hide actions from
// the user, trigger greedily on everything, or ship scripts that exfiltrate.
// Static heuristics only; the methodology page documents the limits.
// ---------------------------------------------------------------------------

// Claude Code built-in slash commands a skill must not shadow by name.
const BUILTIN_COMMANDS = new Set([
  'help', 'clear', 'compact', 'config', 'cost', 'doctor', 'init', 'login', 'logout',
  'mcp', 'memory', 'model', 'permissions', 'review', 'security-review', 'status',
  'vim', 'add-dir', 'agents', 'bug', 'exit', 'export', 'hooks', 'ide', 'resume',
  'todos', 'plugin', 'rewind', 'context', 'statusline', 'output-style',
  'terminal-setup', 'install-github-app', 'release-notes', 'pr-comments',
]);

// Body text of SKILL.md / reference files: patterns that read as instructions
// TO THE AGENT rather than content FOR THE USER. Documentation that teaches
// these attacks is exempted by nearby teaching context (same approach as
// SECRET_PATTERNS below).
const INJECTION_PATTERNS = [
  [/ignore (all |any )?(previous|prior|earlier|above) (instructions|directions|context)/i, 'instruction override'],
  [/disregard (the |your )?(system prompt|instructions|guidelines)/i, 'instruction override'],
  [/do not (tell|inform|mention|reveal)( this)?( to)? the user/i, 'concealment from user'],
  [/without (telling|informing|notifying|asking) the user/i, 'concealment from user'],
  [/(hide|conceal) (this|these instructions|the following) from/i, 'concealment from user'],
  [/bypass (the )?(permission|approval|confirmation|sandbox|safety)/i, 'guardrail bypass'],
  [/--dangerously-skip-permissions/, 'guardrail bypass'],
  [/(upload|send|post|transmit|exfiltrate)\b.{0,60}(https?:\/\/|external server|remote endpoint)/i, 'data exfiltration instruction'],
];

const TEACHING_CONTEXT = /detect|example|pattern|attack|vulnerab|inject|anti-pattern|scan|flag|check|never|avoid|refuse|malicious/i;

// Scripts shipped inside a skill directory. Skills legitimately write files
// (unlike hooks), so this list targets exfiltration, hidden payloads, and
// destruction rather than all side effects.
const SKILL_SCRIPT_FORBIDDEN = [
  [/(curl|wget)[^\n|]*\|\s*(ba|z|da)?sh\b/, 'pipes remote content into a shell'],
  [/base64\s+(-d|--decode)[^\n|]*\|\s*(ba|z)?sh\b/, 'decodes and executes a hidden payload'],
  [/rm\s+-rf\s+["']?(\/|~|\$HOME)/, 'destructive deletion of home or root'],
  [/\beval\s+"?\$\(|\beval\s*\(\s*(await\s+)?fetch/, 'evaluates dynamic or downloaded content'],
  [/\bid_rsa\b|\.aws[\\/]credentials|\.netrc\b/, 'credential file access'],
  [/(curl|wget|fetch\()[^\n]{0,120}(\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)|process\.env)/i, 'sends environment or credentials to the network'],
  [/chmod\s+777/, 'world-writable permissions'],
];

// v1.2: a forbidden-pattern match inside a security DETECTOR definition or a
// test fixture is safety code, not an attack (the canonical case:
// planning-with-files' dangerous-command warning regexes and their regression
// tests). Such matches are recorded as accepted context in the result detail
// instead of failing the check.
const TEST_PATH =
  /(^|[\\/])(tests?|__tests__|spec)[\\/]|(^|[\\/])test_[^\\/]+$|[._-](test|spec)\.[a-z]+$/i;
const DETECTOR_CONTEXT =
  /detect|dangerous|forbidden|deny|blocklist|block list|warn|pattern|regex|rule|guard|sanitiz|validat/i;

// A regex literal on the match's own line marks detector code (the match is
// the pattern being defined, or its inline comment) regardless of wording.
const REGEX_LITERAL_LINE = /\/(?:[^/\\\n]|\\.)+\/[a-z]*\s*,?/;

function classifyScriptMatch(rel, body, matchIndex) {
  if (TEST_PATH.test(rel)) return 'test-fixture';
  const lineStart = body.lastIndexOf('\n', matchIndex) + 1;
  const lineEnd = body.indexOf('\n', matchIndex);
  const line = body.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  if (REGEX_LITERAL_LINE.test(line)) return 'detector';
  const win = body.slice(Math.max(0, matchIndex - 300), matchIndex + 300);
  if (DETECTOR_CONTEXT.test(win)) return 'detector';
  return null;
}

// v1.2: skills live either at skills/<name>/SKILL.md or in a container layout
// skills/<container>/<variant>/SKILL.md (e.g. i18n variant packs). Returns the
// actual skill directories in both layouts; a dir with neither its own
// SKILL.md nor variant SKILL.mds is reported as missing.
function listSkillDirs(skillsDir) {
  const out = [];
  for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = path.join(skillsDir, e.name);
    if (exists(path.join(dir, 'SKILL.md'))) {
      out.push({ name: e.name, dir });
      continue;
    }
    const variants = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((v) => v.isDirectory() && exists(path.join(dir, v.name, 'SKILL.md')));
    if (variants.length) {
      for (const v of variants) out.push({ name: v.name, dir: path.join(dir, v.name), container: e.name });
    } else {
      out.push({ name: e.name, dir, missing: true });
    }
  }
  return out;
}

function checkSkillSafety(pluginDir) {
  const skillsDir = path.join(pluginDir, 'skills');
  if (!exists(skillsDir)) return { status: 'n/a', detail: 'no skills' };
  const problems = [];
  // The plugin's own commands, so a skill cannot shadow them either.
  const ownCommands = new Set(
    walk(path.join(pluginDir, 'commands'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, '').split('/').pop())
  );
  const accepted = []; // v1.2: matches classified as detector/test context
  const entries = listSkillDirs(skillsDir).filter((s) => !s.missing);
  for (const s of entries) {
    const label = s.container ? `${s.container}/${s.name}` : s.name;
    const sk = path.join(s.dir, 'SKILL.md');
    const src = read(sk);
    const fm = frontmatter(src) ?? {};

    // -- Name discipline: matches directory, safe charset, shadows nothing.
    if (fm.name && fm.name !== s.name)
      problems.push(`${label}: frontmatter name "${fm.name}" != directory name`);
    if (fm.name && !/^[a-z0-9-]+$/.test(fm.name))
      problems.push(`${label}: name must be lowercase alphanumeric with hyphens`);
    const skillName = fm.name || s.name;
    if (BUILTIN_COMMANDS.has(skillName))
      problems.push(`${label}: shadows built-in Claude Code command "/${skillName}"`);
    if (ownCommands.has(skillName))
      problems.push(`${label}: shadows this plugin's own command "/${skillName}"`);

    // -- Trigger honesty: a description that claims everything triggers on
    //    everything, hijacking context on unrelated requests.
    const desc = fm.description ?? '';
    if (desc && desc.length < 20) problems.push(`${label}: description too thin to scope the trigger`);
    if (/always (use|invoke|apply|load) (this|the) skill|\bon every (request|message|task|prompt)\b|for (all|every) (task|request|message)s?\b|regardless of (the )?(task|topic|request)/i.test(desc))
      problems.push(`${label}: greedy trigger: description claims all requests`);

    // -- Injection patterns in every markdown file the skill ships.
    for (const f of walk(s.dir).filter((f) => f.endsWith('.md'))) {
      const body = read(path.join(s.dir, f));
      for (const [re, label2] of INJECTION_PATTERNS) {
        const m = body.match(re);
        if (m && !TEACHING_CONTEXT.test(body.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120))) {
          problems.push(`${label}/${f}: ${label2} ("${m[0].slice(0, 60)}")`);
        }
      }
    }

    // -- Script safety for everything executable the skill ships. Matches in
    //    detector definitions or test fixtures are recorded, not failed.
    for (const f of walk(s.dir).filter((f) => /\.(sh|bash|zsh|mjs|js|cjs|ts|py|rb|ps1)$/.test(f))) {
      const body = read(path.join(s.dir, f));
      for (const [re, label2] of SKILL_SCRIPT_FORBIDDEN) {
        const m = body.match(re);
        if (!m) continue;
        const ctx = classifyScriptMatch(f, body, m.index);
        if (ctx) accepted.push(`${label}/${f}: ${label2} [accepted: ${ctx}]`);
        else problems.push(`${label}/${f}: ${label2}`);
      }
    }
  }
  const acceptedNote = accepted.length
    ? `; ${accepted.length} pattern match(es) accepted in detector/test context: ${accepted.join(' | ')}`
    : '';
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') + acceptedNote }
    : {
        status: 'pass',
        detail: `all ${entries.length} skill(s): no command shadowing, scoped triggers, no injection patterns, no unsafe scripts${acceptedNote}`,
      };
}

// A "real" private key has a base64 body after the header; a bare header line
// in documentation (teaching detection patterns) is not a leak.
const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key', 'all'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'API secret key', 'all'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token', 'all'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\s]{40,}/, 'private key', 'all'],
  [/\bpassword\s*=\s*["'][^"']{6,}["']/i, 'hardcoded password', 'code'],
];

function checkNoSecrets(pluginDir) {
  const hits = [];
  for (const f of walk(pluginDir)) {
    if (!/\.(md|json|mjs|js|cjs|ts|py|sh|yaml|yml)$/.test(f)) continue;
    const isDoc = f.endsWith('.md');
    const src = read(path.join(pluginDir, f));
    for (const [re, label, scope] of SECRET_PATTERNS) {
      if (scope === 'code' && isDoc) continue; // docs may teach the anti-pattern
      // Only flag when the match is not in an obvious example context.
      const m = src.match(re);
      if (m && !/example|placeholder|redact|xxxx|your[-_]/i.test(src.slice(Math.max(0, m.index - 80), m.index + 80))) {
        hits.push(`${f}: ${label}`);
      }
    }
  }
  return hits.length
    ? { status: 'fail', detail: hits.join('; ') }
    : { status: 'pass', detail: 'no credentials or secrets in any plugin file' };
}

function checkDocs(pluginDir) {
  const rd = path.join(pluginDir, 'README.md');
  if (!exists(rd)) return { status: 'fail', detail: 'no README.md' };
  const src = read(rd);
  const problems = [];
  if (!/\/plugin install /.test(src)) problems.push('README has no install command');
  if (src.length < 500) problems.push('README too thin to document the plugin');
  return problems.length
    ? { status: 'fail', detail: problems.join('; ') }
    : { status: 'pass', detail: 'README documents purpose, installation, and usage' };
}

// ---------------------------------------------------------------------------

const CHECKS = [
  ['manifest-integrity', 'Manifest integrity', checkManifestIntegrity],
  ['hook-safety', 'Hook safety', checkHookSafety],
  ['agent-tool-scope', 'Agent tool scopes', checkAgentToolScope],
  ['command-hygiene', 'Command hygiene', checkCommandHygiene],
  ['skill-structure', 'Skill structure', checkSkillStructure],
  ['skill-safety', 'Skill safety', checkSkillSafety],
  ['no-secrets', 'No secrets', checkNoSecrets],
  ['docs', 'Documentation', checkDocs],
];

function runChecks(pluginDir, entry) {
  const checks = [];
  let ok = true;
  for (const [id, title, fn] of CHECKS) {
    const r = exists(pluginDir) ? fn(pluginDir, entry) : { status: 'fail', detail: 'plugin dir missing' };
    checks.push({ id, title, ...r });
    if (r.status === 'fail') ok = false;
  }
  return { ok, checks };
}

// ---------------------------------------------------------------------------
// Externally-hosted plugins, verified at a pinned commit.
// The pin (repo + commit + path) lives in .claude-plugin/external-pins.json;
// we clone exactly that commit and run the same checks. The resulting badge
// vouches for THAT commit; the drift watchdog flags when the repo moves past it.
// ---------------------------------------------------------------------------

const git = (cmd, opts = {}) =>
  execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 120000, ...opts }).trim();

function validatePin(name, pin) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(pin.repo ?? '')) return `${name}: pin.repo must be "owner/repo"`;
  if (!/^[0-9a-f]{7,40}$/i.test(pin.commit ?? '')) return `${name}: pin.commit must be a git SHA`;
  const p = pin.path ?? '.';
  if (p.includes('..') || path.isAbsolute(p)) return `${name}: pin.path must be a relative path inside the repo`;
  return null;
}

function verifyExternal(entry, pin) {
  const repoUrl = `https://github.com/${pin.repo}.git`;
  let headCommit = null;
  try {
    headCommit = git(`ls-remote ${repoUrl} HEAD`).split(/\s+/)[0] || null;
  } catch {
    /* offline / repo gone: current-ness unknown */
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-verify-'));
  try {
    git('init -q', { cwd: tmp });
    git(`remote add origin ${repoUrl}`, { cwd: tmp });
    git(`fetch -q --depth 1 origin ${pin.commit}`, { cwd: tmp });
    git('checkout -q FETCH_HEAD', { cwd: tmp });
    const dir = path.join(tmp, pin.path ?? '.');
    const { ok, checks } = runChecks(dir, entry);
    return { ok, checks, headCommit, current: headCommit ? headCommit === pin.commit : null };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const ciMode = args.includes('--ci');
const target = args.find((a) => !a.startsWith('--'));

// ---------------------------------------------------------------------------
// Standalone mode: verify ANY plugin directory (external authors, pre-submission).
//   node scripts/verify-plugins.mjs /path/to/your-plugin
// Same checks the registry runs; exit code 0 = verification-ready (CI-friendly).
// ---------------------------------------------------------------------------
if (target) {
  const pluginDir = path.resolve(target);
  console.log(`Sigistry verification (methodology v${METHODOLOGY_VERSION})`);
  console.log(`Plugin: ${pluginDir}\n`);
  const { ok, checks } = runChecks(pluginDir, null);
  for (const c of checks) {
    const tag = c.status === 'pass' ? 'PASS' : c.status === 'n/a' ? ' n/a' : 'FAIL';
    console.log(`${tag}  ${c.title}`);
    console.log(`      ${c.detail}`);
  }
  console.log(
    ok
      ? '\nVerification-ready. Submit via PR (see CONTRIBUTING.md) to get listed and earn the badge.'
      : '\nNot yet verification-ready. Fix the FAIL items above and re-run.'
  );
  process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Registry mode: verify every marketplace.json plugin.
// Default: write verified.json.  --ci: write nothing; fail on any failure or
// on a committed verified.json that no longer matches reality (stale badge).
// ---------------------------------------------------------------------------
const marketplace = JSON.parse(read(path.join(ROOT, '.claude-plugin', 'marketplace.json')));
const result = {
  $comment: 'Generated by scripts/verify-plugins.mjs. Source of truth for sigistry.com/badge/<id>.svg. Do not edit by hand.',
  methodologyVersion: METHODOLOGY_VERSION,
  methodologyUrl: 'https://sigistry.com/verification',
  generated: new Date().toISOString(),
  plugins: {},
};

const pinsPath = path.join(ROOT, '.claude-plugin', 'external-pins.json');
const pins = exists(pinsPath) ? JSON.parse(read(pinsPath)).plugins ?? {} : {};

// Carry forward firstSeen (the date a plugin first entered the registry) from
// the committed verified.json; new plugins get today. Backfilled once from git
// history when the field was introduced.
const prevVerifiedPath = path.join(ROOT, '.claude-plugin', 'verified.json');
const prevPlugins = exists(prevVerifiedPath) ? JSON.parse(read(prevVerifiedPath)).plugins ?? {} : {};
const firstSeenOf = (name) => prevPlugins[name]?.firstSeen ?? result.generated.slice(0, 10);

let failures = 0;
for (const entry of marketplace.plugins) {
  const date = result.generated.slice(0, 10);

  // Externally-hosted listings (object source: git URL / github repo).
  // With a commit pin: clone that exact commit and verify it, "verified at
  // commit". Without a pin: "listed", never verified, we cannot vouch for
  // code we neither host nor pin.
  if (typeof entry.source !== 'string') {
    const pin = pins[entry.name];
    if (!pin) {
      result.plugins[entry.name] = {
        status: 'listed',
        hosting: 'external',
        version: entry.version,
        date,
        firstSeen: firstSeenOf(entry.name),
        checks: [],
        note: 'Hosted externally with no commit pin; listed but not verified.',
      };
      console.log(`LISTED    ${entry.name} (external, no pin)`);
      continue;
    }
    const pinErr = validatePin(entry.name, pin);
    if (pinErr) {
      result.plugins[entry.name] = { status: 'failed', hosting: 'external', version: entry.version, date, firstSeen: firstSeenOf(entry.name), checks: [], note: pinErr };
      failures++;
      console.log(`FAILED    ${entry.name}\n          - invalid pin: ${pinErr}`);
      continue;
    }
    try {
      const { ok, checks, headCommit, current } = verifyExternal(entry, pin);
      const status = !ok ? 'failed' : current === false ? 'stale' : 'verified';
      result.plugins[entry.name] = {
        status,
        hosting: 'external',
        repo: pin.repo,
        commit: pin.commit,
        path: pin.path ?? '.',
        headCommit,
        version: entry.version,
        date,
        firstSeen: firstSeenOf(entry.name),
        checks,
      };
      if (!ok) failures++;
      const tag = status === 'verified' ? 'VERIFIED' : status === 'stale' ? 'STALE   ' : 'FAILED  ';
      console.log(`${tag}  ${entry.name} (external @${pin.commit.slice(0, 7)}${current === false ? ', repo HEAD has moved on' : ''})`);
      for (const c of checks.filter((c) => c.status === 'fail')) console.log(`          - ${c.title}: ${c.detail}`);
    } catch (e) {
      result.plugins[entry.name] = {
        status: 'failed',
        hosting: 'external',
        repo: pin.repo,
        commit: pin.commit,
        version: entry.version,
        date,
        firstSeen: firstSeenOf(entry.name),
        checks: [],
        note: `could not fetch pinned commit: ${String(e.message ?? e).slice(0, 200)}`,
      };
      failures++;
      console.log(`FAILED    ${entry.name} (external: could not fetch pinned commit)`);
    }
    continue;
  }

  const pluginDir = path.join(ROOT, entry.source.replace(/^\.\//, ''));
  const { ok, checks } = runChecks(pluginDir, entry);
  result.plugins[entry.name] = {
    status: ok ? 'verified' : 'failed',
    hosting: 'registry',
    version: entry.version,
    date,
    firstSeen: firstSeenOf(entry.name),
    checks,
  };
  if (!ok) failures++;
  const badge = ok ? 'VERIFIED' : 'FAILED  ';
  console.log(`${badge}  ${entry.name}`);
  for (const c of checks.filter((c) => c.status === 'fail')) console.log(`          - ${c.title}: ${c.detail}`);
}

// Registry consistency (ported from the retired validate-plugins.sh): every
// vendored plugins/<dir> must be listed in marketplace.json. The reverse
// direction (listed but missing on disk) already fails manifest-integrity.
const listedDirs = new Set(
  marketplace.plugins
    .filter((e) => typeof e.source === 'string')
    .map((e) => e.source.replace(/^\.\//, '').replace(/^plugins\//, ''))
);
const pluginsRoot = path.join(ROOT, 'plugins');
const orphanDirs = exists(pluginsRoot)
  ? fs
      .readdirSync(pluginsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !listedDirs.has(d.name))
      .map((d) => d.name)
  : [];
for (const name of orphanDirs) {
  failures++;
  console.log(`FAILED    ${name} (vendored under plugins/ but not listed in marketplace.json)`);
}

const verifiedPath = path.join(ROOT, '.claude-plugin', 'verified.json');

if (ciMode) {
  const stale = [];
  if (exists(verifiedPath)) {
    const committed = JSON.parse(read(verifiedPath));
    const shape = (p) =>
      JSON.stringify([p.status, p.version, p.commit ?? null, (p.checks ?? []).map((c) => [c.id, c.status])]);
    for (const [name, fresh] of Object.entries(result.plugins)) {
      const old = committed.plugins?.[name];
      if (!old || shape(old) !== shape(fresh)) stale.push(name);
    }
    for (const name of Object.keys(committed.plugins ?? {})) {
      if (!result.plugins[name]) stale.push(`${name} (removed)`);
    }
  } else {
    stale.push('(verified.json missing)');
  }
  if (failures > 0) console.error(`\nCI: ${failures} plugin(s) fail verification.`);
  if (stale.length > 0)
    console.error(
      `CI: committed verified.json is stale for: ${stale.join(', ')}. Run "node scripts/verify-plugins.mjs" and commit the result.`
    );
  if (failures > 0 || stale.length > 0) process.exit(1);
  console.log('\nCI: all plugins verified and verified.json is current.');
  process.exit(0);
}

fs.writeFileSync(verifiedPath, JSON.stringify(result, null, 2) + '\n');
console.log(`\n${marketplace.plugins.length - failures}/${marketplace.plugins.length} plugins verified. Wrote .claude-plugin/verified.json`);
