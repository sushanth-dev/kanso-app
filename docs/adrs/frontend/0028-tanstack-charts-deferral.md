# 0028. Defer TanStack Charts until stable

* Status: accepted
* Date: 2026-08-11
* Builds on: [ADR-0006](0006-d3-visualizations.md)

## Context

ADR-0006 chose D3 for data visualization. TanStack Charts is a newer
entry from the same ecosystem as the Query, Table, Virtual, and Router
decisions recorded alongside this one. It is a TypeScript visualization
grammar built on granular D3 primitives -- not an alternative to D3, but
a layer over it. Its own comparison documentation lists built-in axes,
legends, tooltips, selection, animation, and responsive resize as what it
adds on top of the D3 primitives ADR-0006 already commits to.

The question is whether to adopt TanStack Charts now as a convenience
layer over the D3 foundation, or to stay on raw D3.

## Decision

Defer TanStack Charts. It is pre-alpha at the time of this decision
(v0.11.0, explicitly marked not production-ready). Adopting a pre-alpha
dependency for a product heading to production is not a reasonable risk:
API churn, breaking changes between minor versions, and missing
documentation are the expected state of a pre-alpha library, not
exceptions.

D3 remains the visualization foundation per ADR-0006, unchanged. The
chess-specific graphics -- the evaluation bar, the eval-over-game graph,
the progress views -- are custom compositions where TanStack Charts's
own docs say the default runtime does not cover the work (brush, zoom,
spatial layouts, binning), so even with TanStack Charts adopted we would
drop to raw D3 primitives for the most important graphics.

When TanStack Charts reaches a stable 1.0, revisit this decision. The
value it adds -- built-in tooltips, legends, selection, and resize over
D3 primitives -- is real, and the bundle is smaller than full D3
(37-43 KiB vs ~90 KB) because it is a tree-shakeable grammar. A
superseding ADR at that point would record the adoption.

## Consequences

No new dependency. The charts are built on D3 as ADR-0006 already
decided, and the work TanStack Charts would save -- tooltips, legends,
resize handling -- is written by hand for now. That is more code, and it
is the cost of not building on a pre-alpha library. The decision is
deferred, not closed: when the library is stable, the hand-authored
pieces become candidates for replacement, and a new ADR records it.
