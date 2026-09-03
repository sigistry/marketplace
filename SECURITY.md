# Security Policy

Sigistry's whole value is trust: every vendored plugin passes an
eight-check static verification ([methodology](https://sigistry.com/verification))
plus human review before it ships, and every skill passes the
[skill-safety check](https://sigistry.com/skill-verification) covering command
shadowing, trigger scope, injection language, and script safety. If you find a
way that trust can be broken, we want to know about it.

## Scope

Reports are welcome for any of these:

- **A listed plugin or skill behaving maliciously or unsafely**: hooks that
  phone home, agents with excessive tool scopes, credential harvesting,
  prompt-injection payloads in skills or READMEs, or any difference between
  what a listing says it does and what it does.
- **The verification pipeline**: a plugin or skill construction that passes
  `scripts/verify-plugins.mjs` or CI (`.github/workflows/verify.yml`,
  `verify-drift.yml`) while violating what the checks are supposed to
  guarantee. This includes evasion of the v1.2 detector/test-fixture context
  classification.
- **This repository's scripts and workflows**: anything exploitable in the
  verification, pre-screen, badge-generation, or skills-index tooling,
  including the pinned-commit clone paths for externally hosted listings.
- **sigistry.com and its MCP server** (`https://sigistry.com/mcp`): XSS via
  rendered plugin READMEs or skill pages, badge or verification-state
  spoofing, or issues in the catalog tools (`search_plugins`, `search_skills`,
  `get_skill`, `verify_plugin`), including the paths that serve external skill
  source from author repositories at pinned commits.

## How to Report

**For vulnerabilities, do not open a public issue.**

Either channel is fine:

- GitHub's private vulnerability reporting:
  [Report a vulnerability](https://github.com/Sigistry/marketplace/security/advisories/new)
- Email: [hello@sigistry.com](mailto:hello@sigistry.com?subject=SECURITY) with
  `SECURITY` in the subject line

Both keep the report private while it is triaged and fixed. Please report
privately before disclosing publicly, so users of an affected listing are not
exposed.

For non-sensitive concerns about a listing (broken metadata, misleading
description, stale verification badge), a public issue is fine: use the
"Report a listed plugin" issue template.

## What to Include

- Which plugin, skill, file, or endpoint is affected
- Steps to reproduce, or the specific code path
- What an attacker gains
- For listing reports: the version or commit you inspected

## What to Expect

- Acknowledgment within a few days
- For confirmed listing issues: the verified status is revoked immediately
  (its badge flips to not-verified) while it is investigated, and the listing
  is removed if the issue is confirmed malicious. For externally pinned
  listings, removal also drops the skills-index entries and MCP results;
  nothing is copied, so nothing lingers.
- Credit in the advisory if you want it

## Supported Versions

The registry is a rolling catalog: only the current state of `main` (and the
commit each externally-hosted entry pins via its `git-subdir` source `sha` in
`.claude-plugin/marketplace.json`) is supported.
