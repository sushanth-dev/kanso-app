/**
 * From an evaluated ply to a `mistake` row. Pure: no database, no engine.
 *
 * This is an adapter and not a classifier. `classifyMove` in
 * `../chess/lichess-utils.ts` is the definition of a mistake, carried over in
 * sprint 1 and pinned by golden tests, and ST-007's Notes name two definitions
 * drifting apart as the single largest risk to the whole diagnosis. So no
 * threshold lives in this file. If a number that decides whether a move was bad
 * appears below, it is a bug.
 */
import { classifyMove, winProbDrop, type Color, type EvalScore } from '../chess/lichess-utils.ts';
import type { mistake } from '../db/schema.ts';
import { attributeMotif } from './motif.ts';
import type { Phase } from './phase.ts';
import { boundaryOutcome } from './result-boundary.ts';

export type MistakeInsert = typeof mistake.$inferInsert;

export interface AnalysedPly {
  /** 1-based half-move number, matching `move_ply.ply`. */
  ply: number;
  /** The move number a player would say out loud: ply 1 and 2 are both move 1. */
  moveNumber: number;
  san: string;
  /** The position the move was played from. */
  fenBefore: string;
  movingColor: Color;
  /** The evaluation of `fenBefore`, white-absolute. */
  evalBefore: EvalScore;
  /** The evaluation of the position the move led to, white-absolute. */
  evalAfter: EvalScore;
  /** What the engine wanted played instead, in SAN. */
  bestMoveSan: string | null;
  /** The phase of `fenBefore`, computed by the one rule in `./phase.ts`. */
  phase: Phase;
}

/**
 * Centipawns lost by the mover, or 0 when either side of the comparison is a
 * mate score.
 *
 * A mate is not a number of centipawns, and inventing one, by treating mate as
 * some large constant, would put a made-up figure in a column a coach reads.
 * The judgement still happens: `classifyMove` handles mate transitions itself.
 */
function centipawnsLost(color: Color, before: EvalScore, after: EvalScore): number {
  if (before.cp === undefined || after.cp === undefined) return 0;
  return color === 'white' ? before.cp - after.cp : after.cp - before.cp;
}

/**
 * The row for this ply, or null when the move was not a mistake.
 *
 * Callers pass the player's own plies only. The opening-leak aggregation counts
 * every `mistake` row attached to a game with no filter on which side played
 * it, so a row for the opponent's blunder would make the player's opening look
 * bad for the opponent's error.
 */
export function toMistakeRow(gameId: string, ply: AnalysedPly): MistakeInsert | null {
  // A position with no best move is a finished one: there was no alternative,
  // so there is nothing the player could have done better. `best_move_san` is
  // also `not null` in the schema, and inventing a move to satisfy a column is
  // how a table starts lying.
  if (ply.bestMoveSan === null) return null;

  const advice = classifyMove(ply.movingColor, ply.evalBefore, ply.evalAfter);
  if (advice === null) return null;
  const { crossedResultBoundary, halfPointsLost } = boundaryOutcome(
    ply.movingColor,
    ply.evalBefore,
    ply.evalAfter,
  );

  return {
    gameId,
    ply: ply.ply,
    moveNumber: ply.moveNumber,
    movingColor: ply.movingColor,
    fen: ply.fenBefore,
    moveSan: ply.san,
    bestMoveSan: ply.bestMoveSan,
    evalBeforeCp: ply.evalBefore.cp ?? null,
    evalBeforeMate: ply.evalBefore.mate ?? null,
    evalAfterCp: ply.evalAfter.cp ?? null,
    evalAfterMate: ply.evalAfter.mate ?? null,
    // The classifier speaks in title case and the schema enum is lower case.
    // One mapping, in one place, because the same two spellings appearing in a
    // second file is how the definition of a mistake starts to fork.
    judgement: advice.judgement.toLowerCase() as MistakeInsert['judgement'],
    cpLoss: centipawnsLost(ply.movingColor, ply.evalBefore, ply.evalAfter),
    // Stored from the same helper the classifier judged on, so the number in
    // the row is the number the decision was made with.
    winProbDrop: winProbDrop(ply.movingColor, ply.evalBefore, ply.evalAfter),
    motif: attributeMotif(ply.fenBefore, ply.san, ply.bestMoveSan),
    // ST-025. The phase of the position the move was played from, computed by
    // the one rule in `analysis/phase.ts`.
    phase: ply.phase,
    // F9. The boundary rule lives in `analysis/result-boundary.ts`; this file
    // records its verdict on the evals it already stores.
    crossedResultBoundary,
    halfPointsLost,
  };
}
