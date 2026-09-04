/**
 * ST-047. The two-pass swing decision, pure.
 *
 * `positionsToResearch` is the correctness-critical half of the scan: it must
 * flag every ply whose evaluation swung and leave quiet plies alone. These
 * tests pin that with hand-picked evaluations, no engine and no database.
 */
import { describe, expect, test } from 'vitest';
import { positionsToResearch, type SwingPly } from './two-pass.ts';

describe('positionsToResearch', () => {
  test('quiet moves flag nothing', () => {
    const plies: SwingPly[] = [{ movingColor: 'white' }, { movingColor: 'black' }];
    const scores = [{ cp: 100 }, { cp: 110 }, { cp: 100 }];
    expect(positionsToResearch(plies, scores, 0.085)).toEqual([]);
  });

  test('a swing flags both flanks of the swinging ply', () => {
    // Ply 2 is Black's: +0.0 to +5.0 for White is a queen-sized blunder.
    const plies: SwingPly[] = [{ movingColor: 'white' }, { movingColor: 'black' }];
    const scores = [{ cp: 0 }, { cp: 0 }, { cp: 500 }];
    expect(positionsToResearch(plies, scores, 0.085)).toEqual([1, 2]);
  });

  test('a mate transition is a swing', () => {
    const plies: SwingPly[] = [{ movingColor: 'black' }];
    const scores = [{ cp: 0 }, { mate: 1 }];
    expect(positionsToResearch(plies, scores, 0.085)).toEqual([0, 1]);
  });

  test('the epsilon decides the boundary', () => {
    // White's move drops +1.0 to +0.0, a moderate swing, not a blunder.
    const plies: SwingPly[] = [{ movingColor: 'white' }];
    const scores = [{ cp: 100 }, { cp: 0 }];
    expect(positionsToResearch(plies, scores, 0.2)).toEqual([]);
    expect(positionsToResearch(plies, scores, 0.05)).toEqual([0, 1]);
  });

  test('a game with no plies researches nothing', () => {
    expect(positionsToResearch([], [{ cp: 0 }], 0.085)).toEqual([]);
  });

  test('adjacent swings share a flank and stay sorted and unique', () => {
    // Both plies swing; ply 1's after-position is ply 2's before-position, so
    // index 1 must appear once.
    const plies: SwingPly[] = [{ movingColor: 'white' }, { movingColor: 'black' }];
    const scores = [{ cp: 500 }, { cp: 0 }, { cp: 500 }];
    expect(positionsToResearch(plies, scores, 0.085)).toEqual([0, 1, 2]);
  });

  test('the mover improving is not a swing, whichever colour moves', () => {
    // For Black, white-absolute cp falling is Black improving: the drop is
    // computed from the mover's perspective, so this flags nothing.
    const improvingBlack: SwingPly[] = [{ movingColor: 'black' }];
    expect(positionsToResearch(improvingBlack, [{ cp: 500 }, { cp: 0 }], 0.085)).toEqual([]);

    // ...and for White, white-absolute cp rising is White improving.
    const improvingWhite: SwingPly[] = [{ movingColor: 'white' }];
    expect(positionsToResearch(improvingWhite, [{ cp: 0 }, { cp: 500 }], 0.085)).toEqual([]);
  });
});
