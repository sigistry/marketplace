<p align="center">
  <a href="https://sigistry.com"><img src="https://sigistry.com/logos/sigi.svg" alt="Sigi, the Sigistry mascot" width="130"></a>
</p>

<h1 align="center">Sigistry</h1>

<p align="center">
  <strong>The verified registry for AI coding agents.</strong><br>
  Security-checked plugins and portable skills: open methodology, machine-readable results, consent-first curation.
</p>

<p align="center">
  <a href="https://sigistry.com/verification"><img src="https://sigistry.com/badge/verified.svg" alt="Verified by Sigistry" height="20"></a>
</p>

<p align="center">
  <a href="https://sigistry.com">Website</a> ·
  <a href="https://sigistry.com/skills">Skills Catalog</a> ·
  <a href="https://sigistry.com/verification">Methodology</a> ·
  <a href="https://sigistry.com/skill-verification">Skill Verification</a> ·
  <a href="https://sigistry.com/claude-plugin-checker">Free Checker</a>
</p>

---

Every listing here passes an **eight-check security methodology** before it ships to anyone: manifest integrity, hook safety, agent tool scopes, command hygiene, skill structure, skill safety, no secrets, and documentation. The checks are [open source](scripts/verify-plugins.mjs), the results are [machine-readable](.claude-plugin/verified.json), and CI re-runs everything on every change; a badge can never silently drift from the code it vouches for.

**Skills are first-class.** A `SKILL.md` is text injected straight into an agent's context, which makes it a prompt-injection surface most directories never screen. Sigistry's [skill-safety check](https://sigistry.com/skill-verification) screens for command shadowing, greedy triggers, injection and concealment language, and unsafe scripts. Verified skills are portable: usable in Claude Code, Claude Desktop, and any of the 60+ agents that read the SKILL.md standard. Browse them at [sigistry.com/skills](https://sigistry.com/skills) or copy one straight from its page.

## Quick start

**In Claude Code**: add the marketplace, install a plugin (its skills load automatically):

```
/plugin marketplace add sigistry/marketplace
/plugin install code-auditor@sigistry
```

**In any MCP client**: connect the read-only catalog server and search plugins and skills in conversation (`search_plugins`, `search_skills`, `get_skill` returns full portable skill source):

```
claude mcp add --transport http sigistry https://sigistry.com/mcp
```

**In any agent at all**: open a skill at [sigistry.com/skills](https://sigistry.com/skills), copy its source, done.

## The registry

Browse the live catalog: always current, always showing verification status:

- **[Plugins](https://sigistry.com/plugins)**: every listing with its per-check audit results
- **[Skills](https://sigistry.com/skills)**: every verified skill, with portable source on each page

The machine-readable truth lives right here in [`marketplace.json`](.claude-plugin/marketplace.json), [`verified.json`](.claude-plugin/verified.json), and [`skills.json`](.claude-plugin/skills.json): agents and CI can consume those directly.

## What's in this repository

| Path | Purpose |
|------|---------|
| [`plugins/`](plugins/) | Vendored plugin source: what verification actually audits |
| [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) | The catalog manifest |
| [`.claude-plugin/verified.json`](.claude-plugin/verified.json) | Machine-readable per-check verification results |
| [`.claude-plugin/skills.json`](.claude-plugin/skills.json) | The skills index (registry + external-by-reference) |
| [`scripts/verify-plugins.mjs`](scripts/verify-plugins.mjs) | The methodology itself: read it, run it, challenge it |
| [`scripts/prescreen-skills.mjs`](scripts/prescreen-skills.mjs) | Standalone pre-screen for external skill repos |

## Get verified

Run the checks yourself before submitting: [in your browser](https://sigistry.com/claude-plugin-checker) against any public repo, or locally:

```
node scripts/verify-plugins.mjs path/to/your-plugin
```

Then see [CONTRIBUTING.md](CONTRIBUTING.md). Vendor into the registry for the strongest tier, or stay in your own repo and get verified at a pinned commit: external listings are indexed **by reference**: no source is copied, your license and provenance stay yours, and delisting removes everything. Listing is consent-first and free; Sigistry is non-commercial and open source.

---

*Sigistry is an independent project and is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. Claude and Claude Code are trademarks of Anthropic, PBC, used here only to identify compatibility.*
