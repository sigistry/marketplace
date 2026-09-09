# Responsive Design Kit

Audit and fix a website's mobile responsiveness straight from its source code, and do it without breaking the desktop layout that already works.

Most responsiveness tools either crawl a live URL and hand you a screenshot, or they blindly inject media queries and hope. Responsive Design Kit reads your actual source (HTML, CSS, and framework components), tells you exactly what will break on a phone and why, and then applies fixes that are scored by how risky they are, safe ones automatically, desktop-affecting ones only after you say yes.

It runs entirely inside Claude Code, on your own machine, before you deploy. No live URL, no hosted dashboard, no signup.

## Why the risk score matters

Retrofitting responsiveness is dangerous for one reason: touching layout CSS to help mobile can silently break desktop. So every finding carries a **blast radius**:

- **Additive** — the fix does nothing to your current desktop render and only acts on small screens or on overflow (viewport tag, capping image width, a table scroll wrapper). Safe.
- **Mobile-only** — the fix lives inside a `max-width` media query, so desktop is untouched by construction. Safe.
- **Shared** — the fix changes a value at every breakpoint (a fixed `width` becoming `max-width`). Usually right, but visible on desktop, so review it.
- **Structural** — the fix reflows the layout or changes markup (a fixed grid becoming fluid, a table restacked into cards). Needs review and device testing.

`/responsive-fix` runs conservative by default: it applies only the Additive and Mobile-only changes on its own, and proposes everything else for your explicit approval. Protecting the desktop view is the whole point.

## What it checks

- **Viewport & scaling** — the viewport meta tag (the master switch for mobile), and zoom-blocking anti-patterns like `user-scalable=no`
- **Horizontal overflow** — fixed pixel widths, `100vw` + padding, `nowrap`, unbroken strings, oversized media, the usual scrollbar culprits
- **Fluid layout & units** — hardcoded `px` widths where `%`/`max-width`/`clamp()` belong
- **Images & media** — `max-width: 100%`, aspect ratio, and `srcset` so phones do not download desktop-sized files
- **Breakpoints** — whether they exist, cover the right ranges, and follow a consistent mobile-first or desktop-first approach
- **Flex & grid** — non-wrapping rows, the `min-width: auto` overflow trap, fixed-column grids that never collapse
- **Tables** — wide tables without a scroll wrapper or a stacking strategy
- **Touch targets** — controls under ~44x44px, cramped spacing, and hover-only interactions with no touch path
- **Typography & inputs** — sub-16px text and the iOS input zoom it triggers
- **Viewport units & fixed positioning** — `100vh` vs mobile browser chrome, overlapping sticky headers

It is framework-aware: React/Next, Vue/Nuxt, Svelte, Astro, Tailwind, Bootstrap, CSS modules, and styled-components / Emotion.

## Commands

- **`/responsive-audit <path>`** — a read-only, scored assessment. Every issue comes with a severity and a blast radius, ordered so the safe quick wins sit at the top.
- **`/responsive-fix <path>`** — applies the safe fixes as reviewable diffs and proposes the risky ones for confirmation. Conservative by default; thorough mode on request.

Plus a **`responsive-design-expert`** skill that loads on demand when you ask responsive or mobile-first questions, breakpoint strategy, fluid layout, touch targets, and the blast-radius method for changing layout safely.

## Install

```
/plugin marketplace add sigistry/marketplace
/plugin install responsive-design-kit@sigistry
```

Then run it on your project:

```
/responsive-audit ./src
/responsive-fix ./src
```

## The honest limits

This is static source analysis: it finds the large majority of real responsiveness problems before you deploy, the same way a linter finds bugs without running your app. It complements, but does not replace, testing on a real device or emulator, some issues only surface at a specific viewport width with real content. The audit always names the viewports worth checking live.

## Verification

Like everything in the Sigistry catalog, Responsive Design Kit is [verified](https://sigistry.com/plugin/responsive-design-kit) against an eight-check methodology, safe commands, a scoped skill, no secrets, honest manifest, and free and open source under MIT.
