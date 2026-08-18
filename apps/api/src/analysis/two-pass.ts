/**
 * ST-047. The two-pass scan, as a pure decision.
 *
 * The first pass evaluates every position at the contract depth. A ply
 * "swings" when the mover's win probability drops by more than the epsilon,
 * and the second pass re-searches both flanks of a swinging ply at a deeper
 * depth. This file holds that decision, kept pure so it unit-tests without an
 * engine or a database.
 */
import { winProbDrop, type Color, type EvalScore } from '../chess/lichess-utils.ts';

/** A ply's mover, the only fact the swing predicate needs. */
export interface SwingPly {
  movingColor: Color;
}

/**
 * The position indices (0-based into the walk's `positions`) to re-search:
 * both flanks of every swinging ply.
 *
 * `scores` has one more entry than `plies`: `scores[p - 1]` is the position
 * before ply `p`, and `scores[p]` the position after it.
 */
export function positionsToResearch(
  plies: SwingPly[],
  scores: EvalScore[],
  epsilon: number,
): number[] {
  const flagged = new Set<number>();
  for (let p = 1; p <= plies.length; p++) {
    const before = scores[p - 1]!;
    const after = scores[p]!;
    if (winProbDrop(plies[p - 1]!.movingColor, before, after) > epsilon) {
      flagged.add(p - 1);
      flagged.add(p);
    }
  }
  return [...flagged].sort((a, b) => a - b);
}
