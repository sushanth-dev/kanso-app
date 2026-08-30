# 0032. Convert half-points lost to rating points through performance rating

* Status: accepted
* Date: 2026-08-15
* Builds on: [ADR-0018](0018-ai-explanation-layer.md)

## Context

F9 defines the report's ranking currency: a weakness is worth the rating points
it costs the player over a season, counting only evaluation swings that crossed
a result boundary. ST-026 implements the boundary rule mechanically; the
conversion from half-points lost to rating points is a modelling choice with no
precedent in the codebase, and it is the one figure in the report a coach will
argue with.

Two facts decide the choice. The schema already stores the player's colour and
the opponents' Elo per game (`white_elo`, `black_elo`), so the conversion can
be computed against the season's actual opposition rather than a reference
nobody chose. And F9's wording is "performance rating", which is a named
formula, not a loose "points per half-point" figure.

## Decision

The leak is the standard performance-rating (Elo logistic) formula computed
against the season's rated opponents:

- `performanceRating(score) = R + 400 * log10(score / (N - score))`, where `N`
  is the number of rated games, `score` is the player's score in points, and
  `R` is the average opponent rating. A zero score maps to `R - 800` and a
  perfect score to `R + 800`.
- The leak for one weakness is `performanceRating(S + H) - performanceRating(S)`,
  where `H` is that weakness's half-points lost, clamped so `S + H <= N`.
- When `S + H > N` the weakness claims more half-points than the season has
  room for, so the clamp maps the recovered score to a perfect season and the
  leak is the whole season's deficit, `performanceRating(N) - performanceRating(S)`,
  flagged `saturated` and read as a floor rather than a marginal cost. Worked
  example: the sprint-7 season `N = 12`, `S = 6`, `H = 8.5` clamps to a perfect
  score, so the leak is `R + 800 - R = 800`, the whole deficit rather than the
  cost of 8.5 half-points.

The leak is computed over rated games only: a game whose opponent Elo is
missing, whose result is undecided, or whose colour is unknown is not part of
the season, because a performance rating against unknown opposition is a number
from nothing. A season with fewer than six rated games refuses rather than
estimates. ST-096 moved the floor from ten to six, the size of a typical
junior tournament (five to nine classical games), so one tournament can
produce a report on its own.

## Alternatives considered

### A flat points-per-half-point constant

A fixed value, for example 40 rating points per point lost, applied linearly.

- Pros: one line, and the number is easy to explain.
- Cons: the marginal value of a half-point grows near a perfect or a zero
  score, and a flat constant is wrong exactly where a coach would check. This
  is the "constant nobody can defend" F9 warns about.
- Rejected.

### A per-game Elo K-factor

Attribute each boundary crossing to its own game's opponent and apply
`K * (expected - actual)` per game.

- Pros: more precise per game than a season average.
- Cons: it needs a K-factor choice, which reintroduces a constant, and it does
  not match F9's "performance rating" wording.
- Rejected.

### A bound below the perfect score

Cap the recovered score at `N - 1`, one game below perfect, so the leak stays a
finite point estimate inside the region where the formula measures a cost.

- Pros: keeps a single figure, and the number is less dramatic.
- Cons: the bound is a third arbitrary input, which is exactly what this record
  set out to avoid. The only arguable inputs were meant to be the season window
  and the minimum-game threshold. The saturated value is the whole season's
  deficit, a real cost, and stating it as a floor is more honest than
  redefining it under a new constant.
- Rejected in favour of flagging the saturation (ST-036).

## Consequences

- The leak is the number a coach reads, and it is now derived from a named,
  documented formula rather than a helper that happened to ship.
- The 400 and the 800 are the Elo scale constant and its perfect-score cap,
  both standard, so the only arguable inputs are the season window and the
  minimum-game threshold, each a named constant in
  `analysis/performance-rating.ts`.
- A weakness whose half-points exceed the room the season has left is flagged
  `saturated` and reported as a floor. This is a consequence of the clamp and
  the 800 cap, documented rather than patched: the season window and the
  minimum-game threshold remain the only arguable inputs.
- A game without an opponent Elo is excluded from the season. A player whose
  season is mostly unrated games sees a refusal rather than an estimate, which
  is the honest answer but reads as sparse for uploads that drop the Elo tags.
