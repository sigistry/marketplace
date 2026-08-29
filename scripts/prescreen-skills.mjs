// Pre-screen external skill repos against the Sigistry skill-safety patterns
// (mirrors scripts/verify-plugins.mjs checkSkillSafety, adapted to arbitrary
// repo layouts: scans every *.md as potential skill content and every script
// file). Findings only; consent-first means we report, not vendor.
//
// v1.2: forbidden-pattern matches inside security-detector definitions or
// test fixtures are safety code, not attacks - they are classified and
// reported as accepted context instead of flagged (planning-with-files#230).
//
// Usage: node prescreen-skills.mjs path/to/cloned-repo
import fs from 'node:fs';
import path from 'node:path';

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
const TEACHING = /detect|example|pattern|attack|vulnerab|inject|anti-pattern|scan|flag|check|never|avoid|refuse|malicious/i;
const SCRIPT_FORBIDDEN = [
  [/(curl|wget)[^\n|]*\|\s*(ba|z|da)?sh\b/, 'pipes remote content into a shell'],
  [/base64\s+(-d|--decode)[^\n|]*\|\s*(ba|z)?sh\b/, 'decodes and executes hidden payload'],
  [/rm\s+-rf\s+["']?(\/|~|\$HOME)/, 'destructive deletion'],
  [/\beval\s+"?\$\(|\beval\s*\(\s*(await\s+)?fetch/, 'evaluates dynamic/downloaded content'],
  [/\bid_rsa\b|\.aws[\\/]credentials|\.netrc\b/, 'credential file access'],
  [/(curl|wget|fetch\()[^\n]{0,120}(\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)|process\.env)/i, 'sends env/credentials to network'],
  [/chmod\s+777/, 'world-writable permissions'],
];
const GREEDY = /always (use|invoke|apply|load) (this|the) skill|\bon every (request|message|task|prompt)\b|for (all|every) (task|request|message)s?\b|regardless of (the )?(task|topic|request)/i;

const TEST_PATH =
  /(^|[\\/])(tests?|__tests__|spec)[\\/]|(^|[\\/])test_[^\\/]+$|[._-](test|spec)\.[a-z]+$/i;
const DETECTOR_CONTEXT =
  /detect|dangerous|forbidden|deny|blocklist|block list|warn|pattern|regex|rule|guard|sanitiz|validat/i;
const REGEX_LITERAL_LINE = /\/(?:[^/\\\n]|\\.)+\/[a-z]*\s*,?/;
const classify = (rel, body, i) => {
  if (TEST_PATH.test(rel)) return 'test-fixture';
  const ls = body.lastIndexOf('\n', i) + 1;
  const le = body.indexOf('\n', i);
  const line = body.slice(ls, le === -1 ? undefined : le);
  if (REGEX_LITERAL_LINE.test(line)) return 'detector';
  if (DETECTOR_CONTEXT.test(body.slice(Math.max(0, i - 300), i + 300))) return 'detector';
  return null;
};

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const repoDir = process.argv[2];
const findings = [];
const acceptedCtx = [];
let mdCount = 0, scriptCount = 0, skillMdCount = 0;

for (const f of walk(repoDir)) {
  const rel = path.relative(repoDir, f).replace(/\\/g, '/');
  if (/\.md$/i.test(f)) {
    mdCount++;
    if (/SKILL\.md$/i.test(f)) skillMdCount++;
    const body = fs.readFileSync(f, 'utf8');
    const fmDesc = body.match(/^---[\s\S]*?description:\s*(.*)$/m)?.[1] ?? '';
    if (GREEDY.test(fmDesc)) findings.push(`${rel}: greedy trigger in description`);
    for (const [re, label] of INJECTION_PATTERNS) {
      const m = body.match(re);
      if (m && !TEACHING.test(body.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120))) {
        findings.push(`${rel}: ${label} ("${m[0].slice(0, 50)}")`);
      }
    }
  } else if (/\.(sh|bash|zsh|mjs|js|cjs|ts|py|rb|ps1)$/i.test(f)) {
    scriptCount++;
    let body = '';
    try { body = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const [re, label] of SCRIPT_FORBIDDEN) {
      const m = body.match(re);
      if (!m) continue;
      const ctx = classify(rel, body, m.index);
      if (ctx) acceptedCtx.push(`${rel}: ${label} [accepted: ${ctx}]`);
      else findings.push(`${rel}: ${label}`);
    }
  }
}

console.log(`## ${path.basename(repoDir)}: ${skillMdCount} SKILL.md, ${mdCount} md, ${scriptCount} scripts`);
if (findings.length === 0) console.log('   CLEAN under skill-safety patterns');
for (const f of findings.slice(0, 8)) console.log(`   FLAG: ${f}`);
if (findings.length > 8) console.log(`   ...and ${findings.length - 8} more`);
for (const a of acceptedCtx) console.log(`   NOTE: ${a}`);
