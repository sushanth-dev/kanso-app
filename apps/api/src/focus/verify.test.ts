/**
 * ST-032. The window split and the trend rule, with no database.
 *
 * These are the numbers a parent is shown, so the tests pin the boundaries
 * with named constants rather than magic numbers.
 */
import { describe, expect, test } from 'vitest';
import {
  FOCUS_DRILL_KINDS,
  FOCUS_SPECS,
  FOCUS_WINDOW_GAMES,
  gamesToGoFor,
  splitWindow,
  trendFor,
} from './verify.ts';

const SPEC = FOCUS_SPECS['converting_won_positions']!;

describe('trendFor', () => {
  const TIME_SPEC = FOCUS_SPECS['time_management']!;

  test('a null value is a refusal, not a number', () => {
    expect(trendFor(SPEC, null, 0.5)).toBe('insufficient_evidence');
    expect(trendFor(SPEC, 0.5, null)).toBe('insufficient_evidence');
  });

  test('a gap above the threshold is improving', () => {
    expect(trendFor(SPEC, 0.5, 0.7)).toBe('improving');
    expect(trendFor(SPEC, 0.5, 0.3)).toBe('declining');
    expect(trendFor(SPEC, 0.5, 0.55)).toBe('flat');
  });

  test('the boundary itself is a trend, pinned with an integer threshold', () => {
    expect(trendFor(TIME_SPEC, 10, 13)).toBe('improving');
    expect(trendFor(TIME_SPEC, 10, 7)).toBe('declining');
    expect(trendFor(TIME_SPEC, 10, 12)).toBe('flat');
  });
});

describe('gamesToGoFor', () => {
  test('zero is a verdict, and only a verdict', () => {
    expect(gamesToGoFor(0.5, 0.7, FOCUS_WINDOW_GAMES, FOCUS_WINDOW_GAMES)).toBe(0);
  });

  test('the current-half deficit is the distance when the baseline is full', () => {
    expect(gamesToGoFor(null, null, FOCUS_WINDOW_GAMES, 9)).toBe(1);
    expect(gamesToGoFor(null, null, FOCUS_WINDOW_GAMES, 0)).toBe(FOCUS_WINDOW_GAMES);
  });

  test('a thin baseline half is unreachable by importing, so the distance is null', () => {
    expect(gamesToGoFor(null, null, FOCUS_WINDOW_GAMES - 1, 9)).toBeNull();
    expect(gamesToGoFor(null, null, 3, FOCUS_WINDOW_GAMES)).toBeNull();
  });

  test('a scorer refusal under full windows is not a countdown', () => {
    expect(gamesToGoFor(null, null, FOCUS_WINDOW_GAMES, FOCUS_WINDOW_GAMES)).toBeNull();
  });
});
describe('splitWindow', () => {
  const started = new Date('2026-08-01T00:00:00Z');
  const after = (day: number, id: string) => ({
    id,
    playedAt: new Date(`2026-08-${String(day).padStart(2, '0')}T00:00:00Z`),
  });
  const before = (day: number, id: string) => ({
    id,
    playedAt: new Date(`2026-07-${String(day).padStart(2, '0')}T00:00:00Z`),
  });

  test('splits newest games at the focus start, both halves capped', () => {
    // 12 games after the start, 3 before, newest first.
    const games = [
      after(13, 'a1'),
      after(12, 'a2'),
      after(11, 'a3'),
      after(10, 'a4'),
      after(9, 'a5'),
      after(8, 'a6'),
      after(7, 'a7'),
      after(6, 'a8'),
      after(5, 'a9'),
      after(4, 'a10'),
      after(3, 'a11'),
      after(2, 'a12'),
      before(30, 'b1'),
      before(29, 'b2'),
      before(28, 'b3'),
    ];
    const { baselineIds, currentIds } = splitWindow(started, games);
    expect(currentIds).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10']);
    expect(baselineIds).toEqual(['b1', 'b2', 'b3']);
  });

  test('skips games without a date', () => {
    const games = [after(2, 'a1'), { id: 'undated', playedAt: null }, before(2, 'b1')];
    const { baselineIds, currentIds } = splitWindow(started, games);
    expect(currentIds).toEqual(['a1']);
    expect(baselineIds).toEqual(['b1']);
  });

  test('a full window is ten games per half', () => {
    const afterGames = Array.from({ length: FOCUS_WINDOW_GAMES + 5 }, (_, i) =>
      after(20 - i, `a${i}`),
    );
    const beforeGames = Array.from({ length: FOCUS_WINDOW_GAMES + 5 }, (_, i) =>
      before(30 - i, `b${i}`),
    );
    const { baselineIds, currentIds } = splitWindow(started, [...afterGames, ...beforeGames]);
    expect(currentIds).toHaveLength(FOCUS_WINDOW_GAMES);
    expect(baselineIds).toHaveLength(FOCUS_WINDOW_GAMES);
  });
});

describe('FOCUS_DRILL_KINDS', () => {
  test('every catalogue focus names its drill family, so none can skip the map silently', () => {
    expect(Object.keys(FOCUS_DRILL_KINDS).sort()).toEqual(Object.keys(FOCUS_SPECS).sort());
  });
});
