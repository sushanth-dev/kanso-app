/**
 * ST-026. The result-boundary rule, pinned so the win/draw/loss thresholds
 * cannot drift unnoticed.
 *
 * No database, no clock, no engine. The worked positions use centipawn values
 * whose winning chances fall on the intended side of the threshold; the sigmoid
 * is `povChances` from lichess-utils.ts and is pinned by its own tests, so
 * these assert the category mapping over it rather than re-deriving the curve.
 */
import { describe, expect, test } from 'vitest';
import { boundaryOutcome, LOSS_CHANCES, WIN_CHANCES } from './result-boundary.ts';

// White-absolute centipawns and the winning chance each maps to: +400 is a win
// (~0.92), +150 is still a win (~0.54), +50 is a draw (~0.20), -50 is a draw
// (~-0.20), -150 is still a loss (~-0.54), -400 is a loss (~-0.92).
const WINNING = { cp: 400 };
const STILL_WINNING = { cp: 150 };
const DRAWISH = { cp: 50 };
const STILL_LOSING = { cp: -150 };
const LOSING = { cp: -400 };

describe('boundaryOutcome', () => {
  test('win to draw costs half a point', () => {
    expect(boundaryOutcome('white', WINNING, DRAWISH)).toEqual({
      crossedResultBoundary: true,
      halfPointsLost: 0.5,
    });
  });

  test('draw to loss costs half a point', () => {
    expect(boundaryOutcome('white', DRAWISH, LOSING)).toEqual({
      crossedResultBoundary: true,
      halfPointsLost: 0.5,
    });
  });

  test('win to loss costs a full point', () => {
    expect(boundaryOutcome('white', WINNING, LOSING)).toEqual({
      crossedResultBoundary: true,
      halfPointsLost: 1,
    });
  });

  test('a large swing inside a winning position costs nothing', () => {
    expect(boundaryOutcome('white', WINNING, STILL_WINNING)).toEqual({
      crossedResultBoundary: false,
      halfPointsLost: 0,
    });
  });

  test('a swing inside a losing position costs nothing', () => {
    expect(boundaryOutcome('white', LOSING, STILL_LOSING)).toEqual({
      crossedResultBoundary: false,
      halfPointsLost: 0,
    });
  });

  test('an improving move costs nothing', () => {
    expect(boundaryOutcome('white', DRAWISH, WINNING)).toEqual({
      crossedResultBoundary: false,
      halfPointsLost: 0,
    });
  });

  test('the thresholds apply from black perspective too', () => {
    // Black winning is negative white cp, so black's win-to-draw is -400 to -50.
    expect(boundaryOutcome('black', { cp: -400 }, { cp: -50 })).toEqual({
      crossedResultBoundary: true,
      halfPointsLost: 0.5,
    });
  });

  test('a mate score is a win or a loss, not a centipawn number', () => {
    expect(boundaryOutcome('white', { mate: 2 }, { cp: 0 })).toEqual({
      crossedResultBoundary: true,
      halfPointsLost: 0.5,
    });
  });

  test('the boundary constants are the numbers the story decided', () => {
    expect(WIN_CHANCES).toBe(0.5);
    expect(LOSS_CHANCES).toBe(-0.5);
  });
});
