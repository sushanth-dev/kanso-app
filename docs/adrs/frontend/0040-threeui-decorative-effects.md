# 0040. Use ThreeUI for decorative effects on non-board surfaces

* Status: superseded by [ADR-0043](0043-retire-canvas-ui-threeui-awwwards-redesign.md)
* Date: 2026-08-26
* Builds on: [ADR-0017](0017-canvas-ui-effects.md), [ADR-0005](0005-astryx-primitives.md)

## Context

ADR-0017 settled decorative motion on a closed list of surfaces through
Canvas UI, and ST-085 (sprint 14) built a lightweight 2D `AmbientCanvas`
with one motif per route. That solved the problem the reader named - the
canvas effects were invisible - but the result is deliberately modest: a
faint 2D ambient that reads as atmosphere, not as a product moment.

Sushanth wants a few non-board surfaces to carry something richer. The
settings page and the landing page are the named candidates. The board
routes stay untouched: the board is the brightest object on its screens
per DESIGN.md, and a heavy WebGL effect behind it would fight the piece
contrast commitments. The effect is wanted where there is no board to
protect - the account surfaces and the marketing front door.

ThreeUI (threeui.com) is an open-source library of copy-ready Three.js
components: procedural 3D hero sections, WebGL backgrounds, UI effects,
icons, and motion. The Community tier is free, MIT-licensed (no Commons
Clause), and ships as the `@designcodeio/threeui` npm package. `three` is
already a dependency (ADR-0017's stack, ST-064), so ThreeUI adds no new
rendering runtime.

The alternatives were writing the richer effects by hand in raw Three.js,
or keeping the 2D ambient everywhere. Hand-writing 3D scenes is exactly
the work ADR-0017 rejected as "not a reasonable use of the time" for the
original atmosphere, and it is more expensive now that the bar is a
distinct product moment rather than a faint backdrop. Keeping the 2D
ambient everywhere leaves the two named surfaces without the richness
Sushanth asked for.

## Decision

Use ThreeUI Community components for decorative effects. The landing page
keeps its own `WarpFieldBackground` tunnel. Every other surface - the
authenticated shell and the auth surfaces - carries the same
`RibbonFieldBackground`, a shared 3D particle-field core (`three-scene.ts`)
ported to the shared `three` and restyled to the semantic tokens per
ADR-0004. The shared core uses a perspective camera, so near particles are
larger and move faster than far ones, giving a real depth cue rather than a
flat full-screen shader, and it is interactive: the pointer repels particles
within a radius and pulls the camera into a subtle parallax. The WarpField
tunnel carries the same pointer parallax. Keeping one background across the
non-landing surfaces keeps the pages calm and consistent. The
`@designcodeio/threeui` package is never installed from npm; the components
are vendored by hand into `apps/web/src/components/threeui/` so the shared
`three` stays the one rendering runtime.
* Every effect honors `prefers-reduced-motion` (one static frame), is
  `aria-hidden`, degrades to a static fallback where WebGL is
  unavailable, and is measured on a mid-range phone before it ships,
  exactly as ADR-0017 already requires.
* The effect never carries information, never wraps a control, and never
  gates an interaction. Removing every ThreeUI component leaves the
  application working and reading the same.

This extends ADR-0017 rather than supersedes it. The Canvas UI list remains
as the fallback identity where WebGL is unavailable; ThreeUI carries the
non-landing surfaces with one shared background.

## Consequences

* **No new dependency.** The two ThreeUI components are vendored by hand
  and ported to the shared `three`, so `package.json` is unchanged. The
  upstream package's bundled three copies (`three128`, `three165`) are
  never installed, and nothing is covered by `npm audit` beyond the
  existing tree. Each vendored component is a real bundle cost and must
  earn its place against the measured-before-ship rule.
* **The COPPA boundary is untouched.** Effects are decorative and local;
  no game data, no child identity, and no network call to a third party
  (ADR-0030, ADR-0038).
* **One background across the non-landing surfaces.** The authenticated
  shell and auth surfaces share the same `RibbonFieldBackground`, so the
  pages stay calm and consistent and the content stays the brightest
  object. The landing keeps its own WarpField tunnel.
* **The list is closed and grows by decision.** Changing the background
  on a surface is a new decision recorded here, not a judgement call at
  implementation time, matching ADR-0017's closed-list rule.
