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
});
