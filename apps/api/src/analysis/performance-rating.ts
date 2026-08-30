/**
 * ST-026. The conversion from half-points lost to rating points, through
 * performance rating.
 *
 * F9 says the leak is converted "through performance rating on half-points
 * actually lost", and a number a coach can dismiss costs us the coach. So the
 * conversion is the standard performance-rating (Elo logistic) formula computed
 * against the season's actual rated opponents, not a flat "points per
 * half-point" constant: the marginal value of a half-point grows near a perfect
 * or a zero score, and a flat constant gets that wrong exactly where a coach
 * would check. The decision is recorded in ADR-0032.
 *
 * - `performanceRating(score) = R + 400 * log10(score / (N - score))`, with a
 *   zero score mapped to `R - 800` and a perfect score to `R + 800`.
 * - The leak for one weakness is `performanceRating(S + H) - performanceRating(S)`,
 *   where `H` is that weakness's half-points lost, clamped so `S + H <= N`. When
 *   `S + H > N` the weakness claims more half-points than the season has room
 *   for, the clamp maps the recovered score to a perfect season, and the leak is
 *   the whole season's deficit. That case is flagged `saturated` so the report
 *   can state the floor rather than a bare number (ST-036).

/** A season is one rolling year, matching ST-023's import default. */
export const SEASON_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/** Fewer rated games than this in a stream refuses rather than estimates. ST-096 moved this from 10. */
export const MIN_RATED_GAMES = 6;

/** The zero/perfect score edge cap, in rating points. Standard for the formula. */
const PERFECT_SCORE_CAP = 800;

/** The Elo logistic scale constant. */
const ELO_SCALE = 400;

export interface SeasonBaseline {
  games: number;
  score: number;
  avgOpponentElo: number;
}

/** The performance rating for a score over a season of rated games. */
export function performanceRating(score: number, games: number, avgOpponentElo: number): number {
  if (score <= 0) return avgOpponentElo - PERFECT_SCORE_CAP;
  if (score >= games) return avgOpponentElo + PERFECT_SCORE_CAP;
  const p = score / games;
  return avgOpponentElo + ELO_SCALE * Math.log10(p / (1 - p));
}

/** The leak for one weakness: the rating cost, and whether that cost is a floor. */
export interface LeakEstimate {
  /** Rating points the weakness costs over the season. */
  ratingLeak: number;
  /**
   * True when the weakness's half-points exceed the room the season has left
   * (`score + halfPointsLost > games`). The recovered score clamps to a perfect
   * season, so the leak is the whole season's deficit rather than a marginal
   * cost, and reads as a floor rather than a figure.
   */
  saturated: boolean;
}

/** Rating points one weakness costs: the season rating with and without its half-points. */
export function leakForWeakness(baseline: SeasonBaseline, halfPointsLost: number): LeakEstimate {
  const saturated = baseline.score + halfPointsLost > baseline.games;
  const actual = performanceRating(baseline.score, baseline.games, baseline.avgOpponentElo);
  const recovered = performanceRating(
    Math.min(baseline.score + halfPointsLost, baseline.games),
    baseline.games,
    baseline.avgOpponentElo,
  );
  return { ratingLeak: Math.round(recovered - actual), saturated };
}
