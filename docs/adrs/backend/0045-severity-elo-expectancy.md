# 0045. Weight mistake severity by the opponent's Elo expectancy

* Status: accepted
* Date: 2026-09-09
* Builds on: [ADR-0032](0032-performance-rating-leak.md)

## Context

Every ranking a player sees — the report's weakness ordering, each
weakness's evidence rows, and the game review's mistake list — has ranked
purely on raw engine eval swing (`cpLoss`) or the rating-leak conversion
ADR-0032 already settled (`halfPointsLost`). Neither signal accounts for
who was on the other side of the board. A queen hang against a 2200 who
finds the punishment every time is a different mistake, in practical
terms, from the same queen hang against a 1400 who might let it go. ST-149
found no competitor contextualizes severity by opponent strength, and the
data already exists: every game row carries `whiteElo`/`blackElo` from the
PGN header, and `leak.ts` already derives the opponent's Elo from the
player's colour for other purposes.

The rating-leak arithmetic itself is out of scope. `crossedResultBoundary`
and `halfPointsLost` are the defensible, already-shipped numbers a coach
reads (ADR-0032); this change touches only ordering — which weakness ranks
first, which evidence row shows first, which game-review mistake tops the
list (ST-149 AC#1, AC#2, AC#3).

## Decision

Add one pure function, `severityWeight(opponentElo: number | null)`, in a
new `apps/api/src/analysis/severity.ts`, and multiply it into whichever
magnitude a call site already ranks by:

```
SEVERITY_REFERENCE_ELO = 1500
SEVERITY_ELO_SCALE = 400
weight = 2 / (1 + 10 ** ((1500 - opponentElo) / 400))
```

This is twice the standard Elo expected-score curve anchored at 1500. Two
properties make it the right shape for this problem:

- At `opponentElo === 1500` the weight is exactly 1, so every game against
  a roughly "average" opponent (the rating most federations hand a new
  player) ranks exactly as it does today. Today's ranking is the
  regression anchor, not an arbitrary baseline.
- The curve is monotonic in `opponentElo` alone: a stronger opponent
  always weighs a mistake at least as heavily as a weaker one, with no
  additional parameters. In particular, the 1500 anchor is fixed, not a
  season or per-player average, so no call site needs to compute or plumb
  an `avgOpponentElo` — `evidence.ts`, `leak.ts`, and `get-game.ts` don't
  otherwise track one, and threading one through three call sites for a
  ranking-only feature was rejected as needless plumbing.

`opponentElo === null` (no Elo header on either side) returns
`{ weight: 1, isFallback: true }`: raw eval swing, unchanged, with the
caller responsible for saying so rather than the formula fabricating a
rating (ST-149 AC#4). `weightedSeverity(magnitude, opponentElo)` wraps
`severityWeight` and returns `magnitude * weight`.

The formula multiplies two different magnitudes depending on where it is
used, but is never itself a new stored figure:

- **Group ranking** (`leak.ts`): weight × `halfPointsLost`, summed per
  group, to rank weaknesses and pick evidence-group order (AC#2). This is
  the only place summing happens; `scoreLeaks` sorts on this weighted sum
  first, falling back to the existing `halfPointsLost`/`kind`/`key`
  tie-breakers.
- **Per-mistake ordering** (`evidence.ts`, `get-game.ts`): weight ×
  `cpLoss`, one mistake at a time (AC#2 evidence-row order, AC#3 game
  review). Most mistakes never cross a result boundary and carry
  `halfPointsLost = 0`, so `cpLoss` is the only signal every mistake row
  has to weight by.

`halfPointsLost`, `ratingLeak`, and `cpLoss` themselves are never
recomputed or rewritten by this change — `severityWeightedHalfPoints` is a
sort key that is explicitly dropped before `report/compose.ts` serializes
`ComposedWeakness`, and a single game's mistakes stay in chronological
order (`asc(mistake.ply)`) since severity-weighting one game's mistakes by
its one opponent Elo is a constant multiplier that cannot change their
relative order. The game review's severity view is a second,
severity-sorted list (`MistakeList`) beside the existing chronological
`Notation`, not a reorder of the canonical mistake array.

The API's `Mistake` schema gains two additive fields, `opponentElo:
number | null` and `severity: number`, so the game review can show the
opponent's rating beside each mistake's cost (AC#3) without a second
round-trip.

## Alternatives considered

### Per-player or per-season average-opponent baseline

Anchor the expected-score curve to the player's own average opponent Elo
(a season or all-time average) instead of the fixed constant 1500.

- Pros: a theoretically tighter reference point — "punching above your
  own average" is arguably more meaningful than "punching above 1500" for
  a player far from that band.
- Cons: requires computing and threading an `avgOpponentElo` into three
  call sites (`leak.ts`, `evidence.ts`, `get-game.ts`) that don't
  otherwise compute one, recomputed as more games are added, and gives
  every player a moving target that makes the ranking harder to explain
  ("why did this reorder? nothing about this game changed") rather than
  easier.
- Rejected: the fixed anchor buys a pure, parameter-free function and a
  ranking that only moves when a mistake or its game's Elo data changes,
  which the honest-answer goal in ST-149's security assessment favours
  over a marginally tighter fit.

### Linear or bucketed severity multiplier instead of the Elo expectancy curve

Multiply by a simple linear scale (e.g. `opponentElo / 1500`) or discrete
rating bands (e.g. `+50%` above 1800, `-50%` below 1200) instead of the
logistic expected-score curve.

- Pros: simpler to explain in one sentence; no exponentiation.
- Cons: a linear scale has no principled zero point or ceiling and
  diverges without bound at high Elo; discrete bands introduce
  hard-to-justify cliff edges (a mistake against a 1799 and an 1801
  opponent should not weight differently by 50%) and a second set of
  magic numbers to pin with golden tests instead of the two constants a
  well-known rating-system curve already needs.
- Rejected: the Elo expected-score curve is a formula already familiar
  from chess ratings themselves, bounded between 0 and 2, and needs only
  the two named constants this decision introduces.

### Reordering the game review's canonical mistake list instead of adding a second list

Sort `get-game.ts`'s `mistakes` array itself by severity, rather than
keeping it chronological and adding a separate `MistakeList` component.

- Pros: no new component, no new section in the review screen.
- Cons: `game-review-route.tsx`'s `initialPlyIndex()` and other chronological
  assumptions throughout the review screen depend on `mistakes[0]` being
  the game's first mistake in ply order, not its worst; reordering the
  canonical array would silently break "start review at the first
  mistake" into "start review at the worst mistake," a behavior change
  AC#3 never asked for.
- Rejected: AC#3's real content is the opponent-rating display and a
  severity-labelled ordering, not a reorder of the chronological source
  of truth. A second, purpose-built list satisfies the acceptance
  criterion without disturbing existing chronological behavior.

## Consequences

- Report weakness ranking, evidence-row ordering within a weakness, and
  the game review's new `MistakeList` all order by the same two named
  constants, pinned by golden tests in `severity.test.ts` (identical
  `cpLoss` at 2200 outranks 1400; exactly 1500 returns weight 1; `null`
  returns `isFallback: true` and `weightedSeverity === magnitude`;
  monotonicity across an Elo ladder) plus cross-checks in `leak.test.ts`
  and `evidence.test.ts` that the SQL-computed weight and the TypeScript
  `severityWeight` agree on the same rows.
- `halfPointsLost`, `ratingLeak`, `cpLoss`, and occurrence/game counts —
  every number a coach actually reads — are unchanged; only which
  weakness or mistake surfaces first can move.
- Games missing either Elo header rank exactly as they did before this
  change (`weight = 1`), and the game review says so explicitly
  ("Opponent rating unknown") rather than showing a fabricated number.
- Adding a per-player or per-season baseline later, if ever justified, is
  an additive change to `severityWeight`'s signature — the fixed 1500
  anchor does not need to be un-shipped, only extended.
