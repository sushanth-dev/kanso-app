# 0043. Retire Canvas UI and ThreeUI for one art-directed design system

* Status: accepted
* Date: 2026-09-05
* Supersedes: [ADR-0017](0017-canvas-ui-effects.md), [ADR-0040](0040-threeui-decorative-effects.md)
* Builds on: [ADR-0031](0031-impeccable-frontend-refinement.md)

## Context

ADR-0017 adopted Canvas UI for decorative motion on a closed list of
surfaces, and ADR-0040 extended the list with ThreeUI's vendored
Three.js components. A code audit for sprint 21 planning found both
records ahead of the code they describe.

Canvas UI's `ParticleReveal` backs three reveals (game review, focus,
report) rather than the one ADR-0017 names, and its "native" path
depends on the `layoutsubtree` html-in-canvas attribute, which is
experimental and unavailable to the large majority of visitors; the
component's real behavior for almost everyone is its non-native
fallback, not the effect the ADR describes. `Clouds`, the component
ADR-0017 names as the sign-up ambient, has zero importers: the entry
surface was migrated to ThreeUI's `WarpField` at some point after ST-053
without the ADR being updated, and `Clouds`/`CloudsVanilla` are now
dead code.

ThreeUI is not decorative trim. `RibbonFieldBackground` mounts inside
`PageFrame`, which `router.tsx` wraps around every authenticated route,
so it is the background for the entire logged-in application, not a
named few surfaces. `WarpFieldBackground` covers the landing page and
both auth routes. ADR-0040 itself gates changing any of this behind a
new decision: "changing the background on a surface is a new decision
recorded here, not a judgment call at implementation time."

Separately, Sushanth decided on 5 September 2026 that the whole
application's visual identity should be replaced, not refined, using
the `build-awwwards-quality-sites` skill: a materially new visual
thesis, typography, color system, imagery, and motion narrative across
every route, marketing and authenticated alike. ADR-0031 requires
exactly this kind of finding to be Sushanth's own decision and its own
record, never something a refinement pass decides on its own. This ADR
is that record.

The alternatives considered were keeping ThreeUI as the background
layer and layering the new identity's typography and color over it, or
keeping Canvas UI's reveals and redesigning everything else around
them. Both were rejected on the same ground: the skill's own rule is
that a WebGL canvas earns its place only when it serves a specific,
justified purpose (spatial depth, texture transition, displacement,
pointer response tied to the art direction) and is never ornamental
background noise. An app-wide ambient particle field is exactly the
case the rule excludes, and Canvas UI's reveal effect is unreliable for
most of the audience regardless of how the rest of the interface looks.

## Decision

Remove Canvas UI and ThreeUI entirely, and adopt the
`build-awwwards-quality-sites` skill's system as the one source of
visual identity and motion across the whole app.

* Delete `ParticleReveal`/`ParticleRevealVanilla` and
  `Clouds`/`CloudsVanilla` (`apps/web/src/components/canvas-ui/`), and
  every import of them.
* Delete `RibbonFieldBackground`, `WarpFieldBackground`, `three-scene.ts`
  (`apps/web/src/components/threeui/`), and `ParallaxPiece`
  (`apps/web/src/components/parallax-piece.tsx`), and every import of
  them.
* Remove the `three` and `@types/three` dependencies. A repository
  search found exactly three importers of `three`, all inside the code
  being deleted; nothing else in the application uses it.
* Going forward, motion is authored with GSAP as the primary system,
  and exactly one smooth-scroll engine (Lenis or Locomotive Scroll,
  decided and recorded in the foundation story that builds the new
  landing page) drives scroll-linked sequences. Three.js returns only
  where a specific surface justifies a custom WebGL effect under the
  skill's own rule; nothing requires it to return at all, and the
  default is that it does not.
* Icon sourcing moves to Solar icons through Iconify for interface
  symbols, per the skill's own rule. How that composes with the
  existing Astryx `Icon` component is a decision for the foundation
  story, not this record.
* ADR-0017 and ADR-0040 are marked superseded by this record rather
  than deleted. Their reasoning about what makes a decorative effect
  safe (`aria-hidden`, a static frame under `prefers-reduced-motion`, a
  fallback where WebGL is unavailable, measured on a mid-range phone
  before it ships, never gating an interaction) is not overturned; it
  carries forward as the bar any future justified Three.js use must
  still clear.

This introduces two new runtime dependencies: GSAP (with its
ScrollTrigger plugin) and one smooth-scroll library. The no-dependency
alternative is hand-writing scroll-linked timelines and easing curves,
which is the same "not a reasonable use of the time" argument ADR-0017
already made once for the effects it replaced; it applies again here at
greater scope. Sushanth approved this directly by naming the skill for
the whole redesign.

## Consequences

The decorative and reveal layer goes to zero between the removal story
merging and the first redesigned surface merging. Every component
removed is `aria-hidden` and both superseded records already state that
removing them leaves the application working and reading the same, so
the app keeps functioning, only plainer, for that window.

`package.json` loses `three` and `@types/three` and gains GSAP and one
scroll engine. `DESIGN.md`'s Motion section, and every `### <surface>`
section naming a Canvas UI or ThreeUI treatment, is rewritten from what
ships, per ADR-0031, rather than left describing removed code.

This is a redesign, not a refinement, so ADR-0031's refine-by-default
posture is deliberately overridden for every surface this initiative
touches. Impeccable's read-critique-audit-update loop and its
`DESIGN.md` discipline continue to apply to what ships; only the
starting assumption (preserve the incumbent identity) changes.

The COPPA boundary is untouched: every effect being removed or added is
decorative and local, with no game data, no child identity, and no
third-party network call (ADR-0030, ADR-0038).
