/**
 * The adapter, with no database and no engine.
 *
 * The point of these tests is agreement rather than judgement: the judgement is
 * `classifyMove`'s and is already covered by its own golden tests. So where a
 * verdict is asserted, it is asserted against `classifyMove` called from the
 * test, not against a word typed here. A copy of the expected answer is exactly
 * how the two definitions ST-007 warns about start to drift.
 */
import { describe, expect, test } from 'vitest';
import { classifyMove, type EvalScore } from '../chess/lichess-utils.ts';
import { toMistakeRow, type AnalysedPly } from './to-mistake.ts';

const GAME = '00000000-0000-0000-0000-000000000001';

function ply(overrides: Partial<AnalysedPly> = {}): AnalysedPly {
  return {
    ply: 7,
    moveNumber: 4,
    san: 'Nf3',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    movingColor: 'white',
    evalBefore: { cp: 30 },
    evalAfter: { cp: 20 },
    bestMoveSan: 'd4',
    ...overrides,
  };
}

describe('toMistakeRow', () => {
  test('a move that loses nothing is not a row', () => {
    expect(toMistakeRow(GAME, ply())).toBeNull();
  });

  test('a move with no alternative is not a row, however the evaluation moved', () => {
    // A finished position has no best move. `best_move_san` is not null in the
    // schema and there is nothing the player could have played instead.
    const evals = { evalBefore: { cp: 400 }, evalAfter: { cp: -400 } };
    expect(toMistakeRow(GAME, ply({ ...evals, bestMoveSan: null }))).toBeNull();
    expect(toMistakeRow(GAME, ply(evals))).not.toBeNull();
  });

  test('the judgement is the classifier’s, lower-cased for the enum', () => {
    const before: EvalScore = { cp: 300 };
    const after: EvalScore = { cp: -50 };

    const row = toMistakeRow(GAME, ply({ evalBefore: before, evalAfter: after }));
    const advice = classifyMove('white', before, after);

    expect(advice).not.toBeNull();
    expect(row?.judgement).toBe(advice?.judgement.toLowerCase());
  });

  test('the same swing classifies the same way for Black', () => {
    // White losing 350 centipawns and Black losing 350 centipawns are the same
    // error. A sign handled in one place and not the other shows up here.
    const white = toMistakeRow(
      GAME,
      ply({ movingColor: 'white', evalBefore: { cp: 300 }, evalAfter: { cp: -50 } }),
    );
    const black = toMistakeRow(
      GAME,
      ply({ movingColor: 'black', evalBefore: { cp: -300 }, evalAfter: { cp: 50 } }),
    );

    expect(black?.judgement).toBe(white?.judgement);
    expect(black?.cpLoss).toBe(white?.cpLoss);
    expect(black?.winProbDrop).toBeCloseTo(white?.winProbDrop ?? 0, 5);
  });

  test('centipawn loss is from the mover’s perspective', () => {
    const row = toMistakeRow(GAME, ply({ evalBefore: { cp: 300 }, evalAfter: { cp: -50 } }));
    expect(row?.cpLoss).toBe(350);
  });

  test('a mate thrown away is a row with the mate scores and no invented centipawns', () => {
    const before: EvalScore = { mate: 2 };
    const after: EvalScore = { cp: -120 };

    const row = toMistakeRow(GAME, ply({ evalBefore: before, evalAfter: after }));

    expect(row?.evalBeforeMate).toBe(2);
    expect(row?.evalBeforeCp).toBeNull();
    expect(row?.evalAfterCp).toBe(-120);
    // Mate is not a number of centipawns, so nothing is made up to fill this.
    expect(row?.cpLoss).toBe(0);
    expect(row?.judgement).toBe(classifyMove('white', before, after)?.judgement.toLowerCase());
  });

  test('every row it builds satisfies the columns the schema requires', () => {
    const row = toMistakeRow(
      GAME,
      ply({
        ply: 42,
        moveNumber: 21,
        movingColor: 'black',
        evalBefore: { cp: -400 },
        evalAfter: { cp: 100 },
      }),
    );

    // A row this function returns must never fail an insert, so the not-null
    // columns are checked here rather than discovered by a failing transaction.
    expect(row).toMatchObject({
      gameId: GAME,
      ply: 42,
      moveNumber: 21,
      movingColor: 'black',
      moveSan: 'Nf3',
      bestMoveSan: 'd4',
    });
    expect(typeof row?.fen).toBe('string');
    expect(typeof row?.cpLoss).toBe('number');
    expect(typeof row?.winProbDrop).toBe('number');
    expect(['inaccuracy', 'mistake', 'blunder']).toContain(row?.judgement);
  });

  test('leaves the columns other stories own alone', () => {
    const row = toMistakeRow(GAME, ply({ evalBefore: { cp: 400 }, evalAfter: { cp: -400 } }));

    expect(row?.phase).toBeUndefined();
    expect(row?.crossedResultBoundary).toBeUndefined();
    expect(row?.halfPointsLost).toBeUndefined();
  });

  test('sets the motif from the stored position, or null when none applies', () => {
    // The start-position Nf3/d4 mistake is a quiet positional miss: no motif in
    // the set explains it, so the row records null rather than a forced label.
    const row = toMistakeRow(GAME, ply({ evalBefore: { cp: 400 }, evalAfter: { cp: -400 } }));
    expect(row?.motif).toBeNull();
  });
});
