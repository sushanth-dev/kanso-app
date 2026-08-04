/**
 * Golden coverage for the mistake classifier.
 *
 * This file is the reason the test setup exists. `classifyMove` is a port of
 * Lichess's Advice.scala with six correction layers stacked on top, each one
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
  moveAccuracy,
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
});

describe('classifyMove: guard 1, the equality deadzone', () => {
  /**
   * Both evaluations inside a half pawn of equal. The sigmoid is steepest here,
   * so a swing worth nothing turns into a double-digit win-probability drop and
   * the classifier flags a move that no coach would look at twice.
   */
  test('says nothing about a swing between two equal positions', () => {
    expect(classifyMove('white', { cp: 40 }, { cp: -40 })).toBeNull();
  });

  test('the same swing outside the deadzone is still classified', () => {
    // 51 is one centipawn past the guard, and nothing else about the move changed.
    expect(classifyMove('white', { cp: 91 }, { cp: -9 })).not.toBeNull();
  });
});

describe('classifyMove: guard 2, the noise floor', () => {
  /**
   * Under 55 centipawns of movement is the engine changing its mind, not the
   * player changing the game.
   */
  test('ignores a swing smaller than the engine noise floor', () => {
    expect(classifyMove('white', { cp: 51 }, { cp: -3 })).toBeNull();
  });

  test('a swing one centipawn past the floor is classified', () => {
    expect(classifyMove('white', { cp: 52 }, { cp: -3 })).not.toBeNull();
  });
});

describe('classifyMove: guard 3, the lowered inaccuracy threshold near equality', () => {
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

describe('classifyMove: guard 4a, the blunder floor', () => {
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

describe('classifyMove: guard 4b, the inaccuracy upgrade', () => {
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

describe('classifyMove: guard 5, advantage leniency', () => {
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
});

describe('gameAccuracy', () => {
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
