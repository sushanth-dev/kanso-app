# 0026. Use TanStack Virtual for long list rendering

* Status: accepted
* Date: 2026-08-11
* Builds on: [ADR-0025](0025-tanstack-table-tabular-data.md)

## Context

Some lists in the app grow long enough that rendering every row harms the
page: a player's full game history can reach hundreds of games, a
tournament's move-by-move feed can reach thousands of entries, and the
analysis move list for a deep game can exceed a hundred ply. Rendering all
of them at once degrades scroll performance and memory on mid-range
phones, the device the design system targets.

The alternatives were a hand-rolled windowing implementation or
react-window.

## Decision

Adopt TanStack Virtual for list virtualization. Like TanStack Table, it
is headless: it computes which rows are visible given a scroll position
and container size, and the rendering stays ours. It integrates with
TanStack Table so a table that needs virtualization -- the game history
view at scale -- turns it on without changing its column or row markup.

react-window was rejected because it renders its own structure and
assumes a fixed row height, which the move list does not have (variations
and comments expand rows). A hand-rolled windowing implementation is
correct but is exactly the kind of behavior that is easy to get wrong on
edge cases -- scroll restoration, dynamic heights, and resize -- and that
a mature library has already solved.

## Consequences

One new runtime dependency (~4 KB gzip). Long lists render only their
visible rows, so scroll stays smooth on the devices that need it most.
The cost is that virtualization adds a layer of indirection: a row that
is off-screen is not in the DOM, which means anything that relies on the
row existing -- keyboard focus, scroll-to-move, find-in-page -- must go
through the virtualizer's `scrollToIndex` rather than a DOM query. That
is a real constraint, and it is cheaper than the performance cost of
rendering thousands of nodes.
