/**
 * ST-026. The performance-rating conversion, pinned against the worked examples
 * from the implementation plan.
 *
 * No database, no clock. These are the numbers a coach will check, so they are
 * the numbers tested.
 */
import { describe, expect, test } from 'vitest';
import {
  leakForWeakness,
  MIN_RATED_GAMES,
  performanceRating,
  SEASON_WINDOW_MS,
} from './performance-rating.ts';

describe('performanceRating', () => {
  test('a 50% score is the average opponent rating', () => {
    expect(performanceRating(10, 20, 1500)).toBeCloseTo(1500, 5);
  });

  test('a 90% score rates above the opposition', () => {
    // 1500 + 400 * log10(18/2) = 1500 + 400 * log10(9) = 1881.70.
    expect(performanceRating(18, 20, 1500)).toBeCloseTo(1881.7, 1);
  });

  test('a perfect score caps at the average plus 800', () => {
    expect(performanceRating(20, 20, 1500)).toBe(2300);
  });

  test('a zero score caps at the average minus 800', () => {
    expect(performanceRating(0, 20, 1500)).toBe(700);
  });
});

describe('leakForWeakness', () => {
  const midTable = { games: 20, score: 10, avgOpponentElo: 1500 };
  const nearPerfect = { games: 20, score: 18, avgOpponentElo: 1500 };

  test('the worked example: 2 half-points at mid-table is 70 points', () => {
    expect(leakForWeakness(midTable, 2)).toEqual({ ratingLeak: 70, saturated: false });
  });

  test('the worked example: 1 half-point near a perfect season is 130 points', () => {
    expect(leakForWeakness(nearPerfect, 1)).toEqual({ ratingLeak: 130, saturated: false });
  });

  test('the same half-point costs more near the edges than at mid-table', () => {
    expect(leakForWeakness(midTable, 1).ratingLeak).toBeLessThan(
      leakForWeakness(nearPerfect, 1).ratingLeak,
    );
  });

  test('clamps the recovered score to a perfect season', () => {
    // 3 half-points would push 18 past 20; both 2 and 3 clamp to a perfect 20.
    expect(leakForWeakness(nearPerfect, 3).ratingLeak).toBe(
      leakForWeakness(nearPerfect, 2).ratingLeak,
    );
  });

  test('flags a weakness that exceeds the season room as saturated', () => {
    // ST-036's case: 8.5 half-points on a 6-of-12 season clamps to a perfect
    // score, so the leak is the whole deficit and reads as a floor.
    expect(leakForWeakness({ games: 12, score: 6, avgOpponentElo: 1500 }, 8.5)).toEqual({
      ratingLeak: 800,
      saturated: true,
    });
  });

  test('the exact boundary is not saturated', () => {
    // H fills the remaining room exactly: a perfect season, a real cost, not
    // an over-counted floor.
    expect(leakForWeakness(nearPerfect, 2).saturated).toBe(false);
  });

  test('the constants are the numbers the story decided', () => {
    expect(MIN_RATED_GAMES).toBe(10);
    expect(SEASON_WINDOW_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });
});
