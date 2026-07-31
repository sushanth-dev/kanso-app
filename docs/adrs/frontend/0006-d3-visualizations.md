# 0006. Use D3 for data visualization

* Status: accepted
* Date: 2026-07-31
* Builds on: [ADR-0004](0004-tailwind-4-consumes-tokens.md)

## Context

The product leans on data graphics: the evaluation bar, an evaluation
graph over the course of a game, and progress views for players, coaches,
and parents. Some of these need real values in JavaScript rather than
styled markup, which is why the token build already emits TypeScript
constants alongside CSS. The alternatives were a charting library such as
Chart.js or Recharts, hand-written SVG, or D3.

## Decision

Use D3.js (version 7.9.0 at the time of writing). D3 is a toolkit for
binding data to the DOM rather than a fixed set of chart types, so it
covers the chess-specific graphics a charting library does not shape
easily, and it renders plain SVG that our semantic tokens can style.

Two constraints come with it. D3 drives the SVG structure (scales, axes,
paths); React keeps owning the surrounding UI, and the two do not fight
over the same nodes. And every chart reads its colors, type, and spacing
from the semantic token tier through the generated TypeScript constants,
never a hardcoded value. A chart is still an interface, so it meets the
same accessibility floor: meaning never travels by hue alone, and every
graphic has a text alternative.

## Consequences

One new runtime dependency, more expressive than a charting library and
with a steeper learning curve in return. Hand-written SVG is avoided for
anything data-driven. Because charts consume tokens like any other
component, a theme change reaches the graphics with no extra work, and the
red-green evaluation-bar mistake is ruled out by the same contrast
enforcement as the rest of the app.
