/**
 * Golden coverage for the mistake classifier.
 *
 * This file is the reason the test setup exists. `classifyMove` is a port of
 * Lichess's Advice.scala with correction layers stacked on top, each one
 * added after a real game produced a false positive, over nineteen commits and
 * about a month. Every one of those guards is a small conditional that a
 * refactor can silently undo, and the failure mode is not a crash: it is a
 * player being told they blundered when they did not, which is the single
 * fastest way to lose their trust in the report.
 *
 * So the tests below are organised by guard rather than by function. Each one
 * names the layer it protects and pairs a case that trips it with a case that
 * does not, because a threshold test that only checks one side of the threshold
 * passes just as happily when the threshold is deleted.
 *
 * The evaluations are centipawns from White's absolute perspective, which is
 * the contract the classifier expects and the normalization the analysis worker
 * owes it.
 */
import { describe, expect, test } from 'vitest';
import {
  classifyMove,
  gameAccuracy,
  mateWinningChances,
  moveAccuracy,
  moveAccuracyFromEvals,
  povChances,
  winPercent,
  winProbDrop,
} from './lichess-utils.ts';

describe('winPercent', () => {
  test('a dead-equal position is a coin flip', () => {
    expect(winPercent({ cp: 0 })).toBeCloseTo(50, 10);
  });

  test('is symmetric about equality', () => {
    expect(winPercent({ cp: 300 }) + winPercent({ cp: -300 })).toBeCloseTo(100, 10);
  });

  test('rises with the evaluation and saturates rather than exceeding the bounds', () => {
    expect(winPercent({ cp: 100 })).toBeGreaterThan(winPercent({ cp: 50 }));
    expect(winPercent({ cp: 5000 })).toBeLessThanOrEqual(100);
    expect(winPercent({ cp: -5000 })).toBeGreaterThanOrEqual(0);
  });

  test('a forced mate is worth more than any centipawn score', () => {
    expect(winPercent({ mate: 1 })).toBeGreaterThan(winPercent({ cp: 1500 }));
    expect(winPercent({ mate: -1 })).toBeLessThan(winPercent({ cp: -1500 }));
  });

  test('refuses an evaluation that is neither a score nor a mate', () => {
    expect(() => winPercent({})).toThrow();
  });

  test('clamps deep mates: everything beyond mate in 10 scores the same', () => {
    expect(winPercent({ mate: 50 })).toBe(winPercent({ mate: 10 }));
    expect(winPercent({ mate: -50 })).toBe(winPercent({ mate: -10 }));
  });

  test('a mate present in the evaluation wins over any centipawn score', () => {
    expect(winPercent({ cp: 0, mate: 5 })).toBe(winPercent({ mate: 5 }));
  });
});

describe('povChances', () => {
  test('flips the sign for Black rather than re-deriving it', () => {
    expect(povChances('black', { cp: 100 })).toBe(-povChances('white', { cp: 100 }));
    expect(povChances('black', { mate: 3 })).toBe(-povChances('white', { mate: 3 }));
  });
});

describe('mateWinningChances', () => {
  test('a shorter mate is worth more, and the sign mirrors the side delivering it', () => {
    expect(mateWinningChances(1)).toBeGreaterThan(mateWinningChances(5));
    expect(mateWinningChances(5)).toBeGreaterThan(mateWinningChances(10));
    expect(mateWinningChances(-1)).toBeCloseTo(-mateWinningChances(1), 12);
  });

  test('saturates at mate in 10', () => {
    expect(mateWinningChances(50)).toBe(mateWinningChances(10));
    expect(mateWinningChances(-50)).toBe(mateWinningChances(-10));
  });
});

describe('winProbDrop', () => {
  test('is measured from the moving player, so the same swing hurts whoever made it', () => {
    const white = winProbDrop('white', { cp: 100 }, { cp: -100 });
    const black = winProbDrop('black', { cp: -100 }, { cp: 100 });
    expect(white).toBeCloseTo(black, 10);
    expect(white).toBeGreaterThan(0);
  });

  test('an improvement is zero rather than a negative drop', () => {
    expect(winProbDrop('white', { cp: -100 }, { cp: 100 })).toBe(0);
  });

  test('saturates at a full probability swing', () => {
    expect(winProbDrop('white', { cp: 5000 }, { cp: -5000 })).toBeCloseTo(1, 10);
  });
});

describe('classifyMove: guard 1, the engine-noise deadzone', () => {
  /**
   * Two floors folded into one swing-keyed guard. A swing under 55 centipawns
   * is noise anywhere, and near equality (both evals within half a pawn) the
   * sigmoid is steepest, so the floor widens to a full pawn. A sub-pawn swing
   * there is the engine changing its mind about a roughly equal position, and
   * a full-pawn swing is material a coach cares about, so it is classified
   * rather than dropped.
   */
  test('says nothing about a sub-pawn swing near equality', () => {
    expect(classifyMove('white', { cp: 40 }, { cp: -40 })).toBeNull();
  });

  test('drops a swing just under a full pawn near equality', () => {
    expect(classifyMove('white', { cp: 49 }, { cp: -49 })).toBeNull();
  });

  test('classifies a full-pawn swing near equality rather than dropping it', () => {
    expect(classifyMove('white', { cp: 50 }, { cp: -50 })).toEqual({ judgement: 'Mistake' });
  });

  test('classifies a swing once one position leaves the equality window', () => {
    // 91 CP is outside the half-pawn window, so the widened floor does not apply.
    expect(classifyMove('white', { cp: 91 }, { cp: -9 })).not.toBeNull();
  });

  test('ignores a small swing that stays under the raw noise floor', () => {
    expect(classifyMove('white', { cp: 51 }, { cp: -3 })).toBeNull();
  });

  test('classifies a swing one centipawn past the raw noise floor', () => {
    expect(classifyMove('white', { cp: 52 }, { cp: -3 })).not.toBeNull();
  });
});

describe('classifyMove: guard 2, the lowered inaccuracy threshold near equality', () => {
  /**
   * Lichess flags an inaccuracy at a 10 percent win-probability drop. In a
   * near-equal position we flag at 8.5, because that is where real inaccuracies
   * were being missed. Outside the near-equal band the standard threshold
   * applies, which is what makes this a correction rather than a global change.
   */
  test('flags a drop between 8.5 and 10 percent when both sides are near equal', () => {
    expect(classifyMove('white', { cp: 140 }, { cp: 85 })).toEqual({ judgement: 'Inaccuracy' });
  });

  test('says nothing about the same drop from a position already well won', () => {
    expect(classifyMove('white', { cp: 300 }, { cp: 195 })).toBeNull();
  });
});

describe('classifyMove: guard 3a, the blunder floor', () => {
  /**
   * A blunder has to be expensive in centipawns as well as in win probability.
   * Near equality the sigmoid alone can manufacture a 30 percent drop out of
   * well under two pawns, and calling that a blunder is what the floor prevents.
   */
  test('downgrades a large probability drop that cost less than two pawns', () => {
    expect(classifyMove('white', { cp: 80 }, { cp: -80 })).toEqual({ judgement: 'Mistake' });
  });

  test('keeps the blunder when the position actually cost that much', () => {
    expect(classifyMove('white', { cp: 150 }, { cp: -150 })).toEqual({ judgement: 'Blunder' });
  });
});

describe('classifyMove: guard 3b, the inaccuracy upgrade', () => {
  /**
   * The mirror of the floor. A drop short of the mistake threshold that still
   * cost real material is a mistake, not an inaccuracy.
   */
  test('upgrades an inaccuracy that cost more than 90 centipawns', () => {
    expect(classifyMove('white', { cp: 65 }, { cp: -30 })).toEqual({ judgement: 'Mistake' });
  });

  test('leaves an inaccuracy alone when the material cost stays under the bar', () => {
    expect(classifyMove('white', { cp: 51 }, { cp: -39 })).toEqual({ judgement: 'Inaccuracy' });
  });
});

describe('classifyMove: guard 4, advantage leniency', () => {
  /**
   * A player who was winning before the move and is still winning after it did
   * not make an inaccuracy worth telling them about. Both halves are required,
   * so a move that gives away most of a winning position is still flagged.
   */
  test('says nothing when White was winning before and is winning after', () => {
    expect(classifyMove('white', { cp: 300 }, { cp: 160 })).toBeNull();
  });

  test('applies to Black by the mirrored thresholds', () => {
    expect(classifyMove('black', { cp: -300 }, { cp: -160 })).toBeNull();
  });

  test('still flags a move that hands most of the advantage back', () => {
    expect(classifyMove('white', { cp: 155 }, { cp: 75 })).toEqual({ judgement: 'Inaccuracy' });
  });
});

describe('classifyMove: mate transitions', () => {
  /**
   * Mate transitions are decided before any centipawn threshold, because a
   * position with a forced mate in it has no meaningful evaluation to subtract.
   */
  test('walking into a forced mate from an equal position is a blunder', () => {
    expect(classifyMove('white', { cp: 0 }, { mate: -3 })).toEqual({
      judgement: 'Blunder',
      mateEvent: 'MateCreated',
    });
  });

  test('walking into mate from an already lost position is judged more gently', () => {
    expect(classifyMove('white', { cp: -1000 }, { mate: -3 })).toEqual({
      judgement: 'Mistake',
      mateEvent: 'MateCreated',
    });
    expect(classifyMove('white', { cp: -2000 }, { mate: -3 })).toEqual({
      judgement: 'Inaccuracy',
      mateEvent: 'MateCreated',
    });
  });

  test('throwing away a forced mate is a blunder when the position becomes ordinary', () => {
    expect(classifyMove('white', { mate: 2 }, { cp: 300 })).toEqual({
      judgement: 'Blunder',
      mateEvent: 'MateLost',
    });
  });

  test('throwing away a forced mate matters less when the position is still won', () => {
    expect(classifyMove('white', { mate: 2 }, { cp: 2000 })).toEqual({
      judgement: 'Inaccuracy',
      mateEvent: 'MateLost',
    });
  });

  test('reads mate signs from the moving player, not from White', () => {
    expect(classifyMove('black', { cp: 0 }, { mate: 3 })).toEqual({
      judgement: 'Blunder',
      mateEvent: 'MateCreated',
    });
  });

  test('the gentleness floors are strict inequalities', () => {
    // Exactly -800 CP is not "below -800", so it stays a Blunder; one
    // centipawn further crosses into Mistake, and -1500/-1501 split Mistake
    // from Inaccuracy the same way.
    expect(classifyMove('white', { cp: -800 }, { mate: -3 })).toEqual({
      judgement: 'Blunder',
      mateEvent: 'MateCreated',
    });
    expect(classifyMove('white', { cp: -801 }, { mate: -3 })).toEqual({
      judgement: 'Mistake',
      mateEvent: 'MateCreated',
    });
    expect(classifyMove('white', { cp: -1500 }, { mate: -3 })).toEqual({
      judgement: 'Mistake',
      mateEvent: 'MateCreated',
    });
    expect(classifyMove('white', { cp: -1501 }, { mate: -3 })).toEqual({
      judgement: 'Inaccuracy',
      mateEvent: 'MateCreated',
    });
  });

  test('losing a mate to a position where the opponent has one is still MateLost', () => {
    // The mover's mate vanished and the opponent's appeared — the MateLost
    // disjunct fires with no centipawn score to compare against.
    expect(classifyMove('white', { mate: 1 }, { mate: -1 })).toEqual({
      judgement: 'Blunder',
      mateEvent: 'MateLost',
    });
    expect(classifyMove('black', { mate: -1 }, { mate: 1 })).toEqual({
      judgement: 'Blunder',
      mateEvent: 'MateLost',
    });
  });

  test('the mate-lost floors mirror the created ones', () => {
    expect(classifyMove('white', { mate: 2 }, { cp: 800 })).toEqual({
      judgement: 'Blunder',
      mateEvent: 'MateLost',
    });
    expect(classifyMove('white', { mate: 2 }, { cp: 801 })).toEqual({
      judgement: 'Mistake',
      mateEvent: 'MateLost',
    });
    expect(classifyMove('white', { mate: 2 }, { cp: 1500 })).toEqual({
      judgement: 'Mistake',
      mateEvent: 'MateLost',
    });
    expect(classifyMove('white', { mate: 2 }, { cp: 1501 })).toEqual({
      judgement: 'Inaccuracy',
      mateEvent: 'MateLost',
    });
  });

  test('a deepening forced loss against the mover is not flagged', () => {
    // Both evaluations are mates against White: no centipawn guard applies and
    // the sigmoid is saturated, so there is nothing meaningful to report.
    expect(classifyMove('white', { mate: -5 }, { mate: -1 })).toBeNull();
    expect(classifyMove('black', { mate: 5 }, { mate: 1 })).toBeNull();
  });

  test('escaping a forced loss by ordinary means is not flagged', () => {
    // The opponent's mate disappears into a dead-equal score: an improvement.
    expect(classifyMove('white', { mate: -3 }, { cp: 0 })).toBeNull();
  });
});

describe('moveAccuracyFromEvals', () => {
  test("reads the evaluation from the moving player's side", () => {
    // Black turning equality into a two-pawn lead is a perfect move; giving a
    // two-pawn lead back costs exactly what it would cost White mirrored.
    expect(moveAccuracyFromEvals('black', { cp: 0 }, { cp: -200 })).toBe(100);
    expect(moveAccuracyFromEvals('white', { cp: 0 }, { cp: 200 })).toBe(100);
    expect(moveAccuracyFromEvals('black', { cp: -200 }, { cp: 0 })).toBeLessThan(50);
    expect(moveAccuracyFromEvals('white', { cp: 200 }, { cp: 0 })).toBe(
      moveAccuracyFromEvals('black', { cp: -200 }, { cp: 0 }),
    );
  });
});

describe('classifyMove: a good move is not a mistake', () => {
  test('says nothing when the position improved for the mover', () => {
    expect(classifyMove('white', { cp: -200 }, { cp: 200 })).toBeNull();
    expect(classifyMove('black', { cp: 200 }, { cp: -200 })).toBeNull();
  });
});

describe('moveAccuracy', () => {
  test('a move that does not lose win probability is perfect', () => {
    expect(moveAccuracy(50, 50)).toBe(100);
    expect(moveAccuracy(50, 70)).toBe(100);
  });

  test('falls as the loss grows, and never leaves the 0 to 100 range', () => {
    const small = moveAccuracy(60, 55);
    const large = moveAccuracy(60, 20);
    expect(small).toBeGreaterThan(large);
    expect(large).toBeGreaterThanOrEqual(0);
    expect(small).toBeLessThanOrEqual(100);
  });

  test('clamps to 0 when the whole game is given away', () => {
    expect(moveAccuracy(100, 0)).toBe(0);
  });
});

describe('gameAccuracy', () => {
  test('attributes a swing to the player who moved when Black starts', () => {
    // With Black to move first, the evals go 15 (after Black's move) then
    // -600 (after White's reply): White dropped from +0.15 to lost, so White
    // scores 8.4 while Black is perfect.
    expect(gameAccuracy('black', [15, -600])).toEqual({ white: 8.4, black: 100 });
  });
  test('refuses to score a game too short to say anything about', () => {
    expect(gameAccuracy('white', [])).toBeNull();
    expect(gameAccuracy('white', [20])).toBeNull();
  });

  test('scores a steady game highly for both players', () => {
    const flat = Array.from({ length: 40 }, () => 15);
    const result = gameAccuracy('white', flat);
    expect(result).not.toBeNull();
    expect(result!.white).toBeGreaterThan(90);
    expect(result!.black).toBeGreaterThan(90);
  });

  test('scores the player who threw the game away lower than the one who did not', () => {
    // White drifts from equal to lost across the second half of the game.
    const collapsing = Array.from({ length: 40 }, (_, i) => (i < 20 ? 15 : 15 - (i - 19) * 90));
    const result = gameAccuracy('white', collapsing);
    expect(result).not.toBeNull();
    expect(result!.white).toBeLessThan(result!.black);
  });
});
