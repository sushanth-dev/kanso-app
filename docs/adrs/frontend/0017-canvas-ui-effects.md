# 0017. Use Canvas UI for decorative motion, on named surfaces only

* Status: superseded by [ADR-0043](0043-retire-canvas-ui-threeui-awwwards-redesign.md)
* Date: 2026-08-03
* Builds on: [ADR-0005](0005-astryx-primitives.md)

## Context

The interface layer is settled: Astryx supplies primitive behavior
(ADR-0005), semantic tokens supply appearance (ADR-0004), and D3 draws
the data (ADR-0006). Nothing in that stack produces atmosphere - the
landing page, the post-game result reveal, and the puzzle-streak
celebration are plain, and building shader work by hand for them is not
a reasonable use of the time.

Canvas UI (`canvasui.dev`) is an open-source collection of
html-in-canvas and WebGL components - Blaze, Liquid, Glass, Shatter,
Particle Reveal, VHS, roughly 33 in total. It ships React, Solid,
Preact, Vue, Svelte, and vanilla TypeScript implementations of the same
engine. Distribution is the shadcn model: `npx shadcn@latest add
@canvas-ui/particle-reveal-react` copies source into the repository
rather than adding a package. The license is MIT with a Commons Clause,
which permits commercial use and forbids reselling the components.

The alternatives were writing the effects by hand, using CSS animation
alone, or shipping without them.

## Decision

Adopt Canvas UI for decorative motion on a named, closed list of
surfaces: the marketing landing page, the post-game result reveal, the
puzzle-streak celebration, and the entry surface (sign-in and sign-up).
Adding another surface is a new decision, not a judgment call at
implementation time.

The entry surface joined the list in ST-053 (sprint 12). Sign-up already
rendered a `Clouds` ambient behind the forms; Sushanth chose to keep it
rather than the ADR's default of removal, so the list now names it.

The post-game result reveal joined the built set in ST-061 (sprint 12). The
game-review route reveals the game result through `ParticleReveal`, vendored
like `Clouds`: a still frame under `prefers-reduced-motion`, `aria-hidden`, and
a static fallback where WebGL is unavailable. The puzzle-streak celebration
stays unbuilt because no puzzle surface exists.

Canvas UI does not enter the functional interface. The board, the move
list, the evaluation bar, the puzzle card, and every form control stay
on Astryx primitives and in-house chess components. An effect never
carries information, never wraps a control, and never gates an
interaction: remove every Canvas UI component and the application still
works and still reads the same.

Copied source is treated as our code. It lands in one directory, is
reviewed on arrival like anything else, and is restyled to semantic
tokens rather than left on its own hardcoded colors.

## Consequences

Four surfaces get atmosphere for the cost of copied source rather than
custom shader work. Canvas UI itself is never a dependency - there is
nothing to bump, and equally nothing that upstream will fix for us.
Every copied component is ours to maintain, including its bugs. What a
component does pull in is a real dependency: the CLI installs whatever
each one needs, so the packages a component requires are read off its
docs page and weighed before it is added, not discovered in the lockfile
afterwards.

The costs are real and accepted. WebGL work is GPU and battery
expenditure on a page that is otherwise cheap to render, so each effect
is measured on a mid-range phone before it ships and dropped if it is
not affordable there. Every effect honors `prefers-reduced-motion` by
rendering a still frame, and is `aria-hidden`, because motion that
carries no information must not reach a screen reader. Effects mount
behind a fallback so a machine without WebGL sees the static layout
rather than a hole.

The Commons Clause binds us: we can ship these components inside the
product but cannot redistribute them as components, which rules out
lifting them into any public package of ours. The copied code arrives
outside the token pipeline, and the review that pulls it onto semantic
tokens is the only thing keeping a second, hardcoded palette out of the
repository.
