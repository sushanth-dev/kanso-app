# 0036. Verify a focus over a rolling window of games

* Status: accepted
* Date: 2026-08-16
* Builds on: [ADR-0032](0032-performance-rating-leak.md)

## Context

F12 closes the focus loop: a player commits to one focus, and the system
verifies whether it is improving. The verification is the number a parent is
shown, so it carries the same stakes as ST-026's performance-rating conversion,
which ADR-0032 records rather than burying in a helper. ST-032 computes four
focuses from stored games and reports a trend over a rolling window per stream.
Four things about that window are choices, not implementation details: what the
window is measured in, how the baseline is chosen, the minimum evidence below
which the honest answer is a refusal, and what separates a trend from noise.

## Decision

* The window is a count of analysed games, not calendar time:
  `FOCUS_WINDOW_GAMES = 10`. It originally matched ST-026's `MIN_RATED_GAMES`
  so the report and the focus held the same bar; ST-096 moved the report's
  floor to six while the focus deliberately keeps the stronger ten-game bar,
  because a per-half trend needs the larger sample even when a report does not.
* The baseline is two equal windows split at `focus.startedAt`: the 10 most
  recent analysed games in the stream since the commitment against the 10 most
  recent before it.
* The online window counts blitz games only (ST-040). Bullet, rapid, and
  classical online games are excluded before the window splits: bullet is too
  fast to reflect understanding, and rapid and classical have no volume. The
  online stream measures only the opening and endgame focuses
  (`opening_repertoire_results` and `converting_won_positions`);
  `tactical_alertness` is tournament-only and `time_management` is retired.
* Minimum evidence is a stream floor (10 games per half) plus a per-focus floor
  that reuses the existing constants (`MIN_CLOCKED_GAMES`, `MIN_TROUBLE_MOVES`)
  or names a new one. Below either, the trend is `insufficient_evidence` with
  `windowGames` still stated, never zero-filled.
* The trend is a fixed per-focus effect size, all four units "higher is
  better". `improving` when `currentValue - baselineValue >= threshold`,
  `declining` at `<= -threshold`, `flat` between. The thresholds are: tactical
  alertness `0.10`, converting won positions `0.10`, opening repertoire results
  `0.25` points per game, time management `3` moves.

## Alternatives considered

### A calendar-time window

* Pros: matches the "one month" the player committed to.
* Cons: a player who plays one tournament a month has an empty window in the off
  month and a window that crosses the commitment boundary unpredictably. A game
  count is comparable across streams and activity levels.
* Rejected.

### "Everything before the focus started" as the baseline

* Pros: uses all available history.
* Cons: a long history dilutes the baseline into a career average, washing out a
  real improvement. Two equal windows compare like with like.
* Rejected.

### A relative trend threshold (percentage change)

* Pros: unit-agnostic.
* Cons: undefined when the baseline is zero, and a percentage says nothing about
  how much a parent can act on. A fixed effect size in the focus's own unit is
  the number a coach can argue with, and it is a named constant pinned by tests.
* Rejected.

### A statistical-significance test for the trend

* Pros: the principled answer to noise.
* Cons: needs a distribution model per focus that does not exist at 12 games,
  and the minimum-evidence floors already refuse below the sample size that
  would support one. Deferred, not forgotten: the fixed threshold is the
  deliberate simplification and the upgrade path if a coach later argues with
  the flat/improving boundary.
* Deferred.

## Consequences

* Four units collapse to one number per stream per focus, because
  `FocusMeasurement` carries one `currentValue` and one `unit`. The opening
  repertoire reports average score per game, not the per-ECO breakdown the
  story's table gestures at; that breakdown cannot fit the shape and is out of
  scope.
* The four constants and the trend rule are named and pinned by unit tests,
  following `analysis/phase.ts` and `analysis/result-boundary.ts`.
* `insufficient_evidence` is a first-class answer with `windowGames` stated,
  never zero-filled, so a thin verdict is visibly thin.
* On the online stream, only blitz games and only the opening and endgame
  focuses produce a number. `time_management`, previously online-only, loses
  its stream and is retired from the catalogue; `tactical_alertness` is
  tournament-only. The window size and floor are unchanged.
* On the real data (12 analysed tournament games, zero online), the expected
  answer today is zero of eight focus-and-stream combinations producing a
  number. That is the finding, not a defect: the loop refuses honestly until the
  evidence is there.
