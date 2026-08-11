# 0025. Use TanStack Table for tabular data

* Status: accepted
* Date: 2026-08-11
* Builds on: [ADR-0005](0005-astryx-primitives.md)

## Context

The app has several general-purpose tables: game history with columns
for opponent, result, opening, and date; tournament standings with rank
and tiebreak scores; and the move list in analysis view. These need
sorting, pagination, column resizing, and selection -- behavior that is
tedious to build correctly and harder to build accessibly. The
chess-specific components (board, eval bar, puzzle card) are already
in-house per ADR-0005, but those are not tables.

The alternatives were building tables from scratch on Astryx primitives,
or adopting a full table component library like AG Grid or MUI DataGrid.

## Decision

Adopt TanStack Table (v9) for tabular data. TanStack Table is headless:
it provides sorting, filtering, pagination, column visibility, and
selection as hooks, and renders no markup. The table's appearance is
built on Astryx primitives and semantic tokens, the same stack as every
other surface, so a table reads as part of the product rather than as an
embedded third-party widget.

AG Grid and MUI DataGrid were rejected because they ship their own DOM,
their own styling system, and their own accessibility model. Matching
either to the semantic token tier is ongoing work, and the result is a
table that looks foreign and fights the design system. TanStack Table
owns the behavior and leaves the rendering to us, which is the same split
ADR-0005 already chose for primitives.

## Consequences

One new runtime dependency. Table behavior -- sorting, pagination,
selection -- is handled once and reused across every table view, and the
markup stays ours so tokens and keyboard behavior are consistent with the
rest of the app. The cost is that a headless library leaves the rendering
to us: each table view writes its own row and cell markup against the
hook's state. That is more code than dropping in a finished component,
and it is the right tradeoff, because a finished component is the thing
that drifts from the design system.
