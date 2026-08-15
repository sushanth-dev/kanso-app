/**
 * ST-026. Whether a mistake crossed a result boundary, and the half-points it
 * cost the player.
 *
 * F9 is deliberately narrow: only a swing that changed the expected result
 * counts, meaning a win turned into a draw or a draw into a loss. A swing that
 * stayed inside a winning or a losing position costs nothing, however large in
 * centipawns, because the player went on to win anyway and the number must not
 * overstate. It never extrapolates from positions the player won.
 *
 * The rule is stated here, in one place, because it is a number a coach will
 * argue with, and a boundary constant buried in an aggregation is a defect. The
 * evaluation-to-winning-chances conversion is the same sigmoid the classifier
 * uses (`povChances` in ../chess/lichess-utils.ts), so no second definition of
 * an evaluation is introduced.
 *
 * - A position is a win at winning chances >= {@link WIN_CHANCES} (75% win
 *   probability), a loss at chances <= {@link LOSS_CHANCES} (25%), and a draw
 *   between them.
 * - Half-points lost is the drop in the result-category score (win 1, draw 0.5,
 *   loss 0): win to draw 0.5, draw to loss 0.5, win to loss 1.0. An improving
 *   move loses nothing.
 */

import { povChances, type Color, type EvalScore } from '../chess/lichess-utils.ts';

/** A position is a win at or above this winning chance (75% win probability). */
export const WIN_CHANCES = 0.5;

/** A position is a loss at or below this winning chance (25% win probability). */
export const LOSS_CHANCES = -0.5;

type Result = 'win' | 'draw' | 'loss';

/** The score a result is worth, in points: a win is 1, a draw half a point. */
const RESULT_SCORE: Record<Result, number> = { win: 1, draw: 0.5, loss: 0 };

function resultFor(chances: number): Result {
  if (chances >= WIN_CHANCES) return 'win';
  if (chances <= LOSS_CHANCES) return 'loss';
  return 'draw';
}

/**
 * The F9 verdict for one move: whether the swing crossed a result boundary and
 * the half-points lost. `before` and `after` are the evals around the mover's
 * move, from the mover's own perspective once `povChances` is applied.
 */
export function boundaryOutcome(
  movingColor: Color,
  before: EvalScore,
  after: EvalScore,
): { crossedResultBoundary: boolean; halfPointsLost: number } {
  const dropped =
    RESULT_SCORE[resultFor(povChances(movingColor, before))] -
    RESULT_SCORE[resultFor(povChances(movingColor, after))];
  const halfPointsLost = Math.max(0, dropped);
  return { crossedResultBoundary: halfPointsLost > 0, halfPointsLost };
}
