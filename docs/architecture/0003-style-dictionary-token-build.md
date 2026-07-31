# 0003. Build tokens with Style Dictionary

* Status: accepted
* Date: 2026-07-31
* Builds on: [ADR-0001](0001-dtcg-2025-10-token-format.md), [ADR-0002](0002-commit-tokens-to-repository.md)

## Context

The token files are one source, but the app consumes values in several
forms: CSS custom properties for the interface, TypeScript constants for
code that needs a real value rather than a class name, and JSON for
round-tripping with the design tool. Writing each output by hand
guarantees they drift apart, so something has to generate all of them
from the one source. The alternatives were a hand-written generation
script or a token build tool.

## Decision

Use Style Dictionary, version 5 (5.5.0 at the time of writing). DTCG has
been a first-class input since version 4, so it reads the ADR-0001 files
directly. It generates three outputs: CSS custom properties as the
primary output, TypeScript constants with generated types, and JSON.

One caveat to plan around. Full DTCG 2025.10 support is still open work,
tracked in `amzn/style-dictionary#1590`: the color, border, shadow, and
dimension types are done, but the gradient and duration composite types
and the resolver module are pending. Until that issue closes, gradients
and durations are expressed as primitives rather than DTCG composite
types, with a comment on the token group so the workaround gets cleaned
up later.

## Consequences

One new build dependency, and the generation step runs in CI. The
trade-off is that no output is ever hand-maintained: a token edit
regenerates every consumer at once, so the CSS, the TypeScript, and the
design tool cannot disagree. The composite-type workaround is debt with a
named exit, tracked against the upstream issue.
