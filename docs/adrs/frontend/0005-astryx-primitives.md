# 0005. Use Astryx for interface primitives

* Status: accepted
* Date: 2026-07-31
* Builds on: [ADR-0004](0004-tailwind-4-consumes-tokens.md)

## Context

Buttons, inputs, dialogs, and tooltips share a hard core of behavior:
keyboard interaction, focus management, and ARIA semantics that are easy
to get wrong and expensive to rebuild. Writing that behavior layer by
hand duplicates work that mature libraries have already done and tested.
The alternatives were building primitives in-house or adopting a
different React behavior library.

## Decision

Adopt Astryx (`@astryxdesign/core`), Meta's open-source React component
library, as the primitive layer, themed to the semantic token tier.
Astryx supplies the behavior; the semantic tokens supply the appearance.

The chess-specific components stay ours. The board, the move list, the
evaluation bar, and the puzzle card are built in-house, against the same
semantic tier and the board accessibility rules, from the first commit.

## Consequences

One new runtime dependency, and a boundary that review enforces: a
primitive is themed, never forked, and effort goes to the components
Astryx does not cover. Each Astryx primitive still gets its keyboard
behavior and focus tokens verified in our context, because a library
default is not automatically our token value. The chess components carry
their own accessibility burden, described in the design system working
agreement.
