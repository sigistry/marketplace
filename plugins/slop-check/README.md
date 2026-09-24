# slop-check

Make prose read like a person wrote it. `slop-check` reviews and drafts writing so it does not carry the tells of AI-generated text: cliché clusters, promotional register, formulaic structure, and em-dash or emoji overuse. It reports each issue with a concrete rewrite, and it can apply the same principles while Claude drafts, so the first version comes out clean.

It is a craft tool. The goal is a genuine voice that fits the piece. It has nothing to do with fooling AI detectors, and it ignores detector scores by design.

## What it catches

- **Cliché vocabulary** (delve, leverage, tapestry, robust, seamless, pivotal), flagged by density rather than a single use.
- **Stock phrases** ("it is important to note," "in today's fast-paced world," "plays a crucial role").
- **Structural patterns**: negative parallelisms ("not just X, but Y"), copula avoidance ("serves as" for "is"), rule-of-three padding, and the rigid intro-three-points-conclusion shape.
- **Register**: promotional adjectives, over-hedging, and vague authority ("experts argue" with nothing cited).
- **Formatting**: em dashes standing in for other punctuation, decorative emoji, bold on everything, Title Case headings, divider lines, smart quotes where ASCII is expected.
- **Rhythm**: uniform sentence length, paragraph after paragraph.
- **LLM leftovers**: "as an AI," knowledge-cutoff disclaimers, stray citation fragments.

The one rule behind all of it: no single feature proves text is AI-written. The tell is a cluster, plus a flat register and a rigid shape. `slop-check` weighs concentration and context, not lone hits, so it does not mangle good writing that happens to use one em dash.

## Install

```
/plugin marketplace add sigistry/marketplace
/plugin install slop-check@sigistry
```

## Usage

The plugin is a single skill, so it works two ways.

**Manual.** Point it at a file or a passage:

```
/slop-check:audit path/to/article.md
```

It reads the target, lists each tell as `location — pattern — why — rewrite`, orders findings by severity, and offers a cleaned version of the worst paragraph. It stays advisory: it does not edit the file unless you ask.

**Automatic.** Because the skill's description covers writing and editing prose, Claude loads it on its own when it recognizes that it is drafting a README, a blog post, release notes, or marketing copy, and it applies the principles as it writes.

## House style

By default the review uses judgment: it flags clusters and register, and leaves a well-placed em dash or emoji alone. For zero-tolerance contexts, a strict house style is documented in the skill (no spaced em dashes, no decorative emoji, ASCII quotes, sentence-case headings). If your project states its own style, that wins.

## Layout

```
slop-check/
  .claude-plugin/plugin.json
  skills/audit/SKILL.md       the principles and review flow
  skills/audit/reference.md   the full catalog, with examples and rewrites
  README.md
```

## License

MIT
