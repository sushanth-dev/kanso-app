/**
 * ST-149. Mistake severity normalized by the opponent's strength.
 *
 * Raw eval swing (`cpLoss`, `halfPointsLost`) ranks mistakes today, and that
 * arithmetic does not change (ADR-0032 settled the leak's own currency). What
 * this adds is a weight: the same blunder against a higher-rated opponent was
 * more realistically punishable, so it should rank first. The weight is twice
 * the standard Elo expected-score curve, anchored at 1500 - the rating most
 * federations hand a new player as "average" - so a mistake against exactly
 * 1500 gets weight 1, identical to today's unweighted ranking. Anchoring on a
 * fixed constant rather than a per-player season baseline means this is a
 * function of the opponent's Elo alone, with nothing to thread into call
 * sites that don't already compute a season baseline.
 */

/** The Elo "average player" anchor: weight 1 at this opponent rating. */
export const SEVERITY_REFERENCE_ELO = 1500;

/** The Elo logistic scale constant, same as `performance-rating.ts`'s. */
export const SEVERITY_ELO_SCALE = 400;

export interface SeverityWeight {
  /** The multiplier to apply to a mistake's raw magnitude. */
  weight: number;
  /** True when there was no opponent Elo to weight by; `weight` is 1. */
  isFallback: boolean;
}

/**
 * Twice the standard Elo expected-score formula against the 1500 anchor. A
 * missing opponent Elo (no PGN header) falls back to a neutral weight rather
 * than fabricating a rating (AC#4).
 */
export function severityWeight(opponentElo: number | null): SeverityWeight {
  if (opponentElo === null) return { weight: 1, isFallback: true };
  const exponent = (SEVERITY_REFERENCE_ELO - opponentElo) / SEVERITY_ELO_SCALE;
  return { weight: 2 / (1 + 10 ** exponent), isFallback: false };
}

/** A mistake's opponent-weighted severity: its raw magnitude times the weight. */
export function weightedSeverity(magnitude: number, opponentElo: number | null): number {
  return magnitude * severityWeight(opponentElo).weight;
}

/** The opponent's Elo, read from a game row's stored player colour. */
export function opponentEloOf(row: {
  playerColor: 'white' | 'black' | null;
  whiteElo: number | null;
  blackElo: number | null;
}): number | null {
  if (row.playerColor === 'white') return row.blackElo;
  if (row.playerColor === 'black') return row.whiteElo;
  return null;
}
