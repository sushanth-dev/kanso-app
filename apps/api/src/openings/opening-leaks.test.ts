/**
 * The scoring, threshold, and banding, tested with no database. The query that
 * feeds it is covered in opening-leaks.integration.test.ts against real tables.
 */
import { describe, expect, test } from 'vitest';
import { scoreOpenings, type OpeningCount } from './opening-leaks.ts';

const count = (over: Partial<OpeningCount> & { eco: string }): OpeningCount => ({
  openingName: null,
  games: 2,
  mistakes: 2,
  ...over,
});

describe('scoreOpenings', () => {
  test('leak score is mistakes per game', () => {
    const { leaks } = scoreOpenings([count({ eco: 'B10', games: 4, mistakes: 6 })]);
    expect(leaks[0].leakScore).toBe(1.5);
  });

  test('ranks openings by leak score, worst first', () => {
    const { leaks } = scoreOpenings([
      count({ eco: 'A00', games: 2, mistakes: 1 }), // 0.5
      count({ eco: 'B10', games: 2, mistakes: 4 }), // 2.0
      count({ eco: 'C50', games: 2, mistakes: 2 }), // 1.0
    ]);
    expect(leaks.map((l) => l.eco)).toEqual(['B10', 'C50', 'A00']);
  });

  test('breaks ties on ECO so equal scores rank the same every time', () => {
    const { leaks } = scoreOpenings([
      count({ eco: 'C50', games: 2, mistakes: 2 }),
      count({ eco: 'A00', games: 3, mistakes: 3 }),
    ]);
    expect(leaks.map((l) => l.eco)).toEqual(['A00', 'C50']);
  });

  test('withholds openings below the two-game threshold and counts them', () => {
    const { leaks, withheld } = scoreOpenings([
      count({ eco: 'B10', games: 2, mistakes: 3 }),
      count({ eco: 'A00', games: 1, mistakes: 5 }),
    ]);
    expect(leaks.map((l) => l.eco)).toEqual(['B10']);
    expect(withheld).toBe(1);
  });

  test('an opening with exactly two games clears the threshold', () => {
    const { leaks, withheld } = scoreOpenings([count({ eco: 'B10', games: 2, mistakes: 0 })]);
    expect(leaks).toHaveLength(1);
    expect(withheld).toBe(0);
  });

  describe('bands', () => {
    const bandOf = (games: number, mistakes: number) =>
      scoreOpenings([count({ eco: 'B10', games, mistakes })]).leaks[0].band;

    test('above 1.5 is high', () => expect(bandOf(2, 4)).toBe('high')); // 2.0
    test('below 0.5 is low', () => expect(bandOf(4, 1)).toBe('low')); // 0.25
    test('between is neutral', () => expect(bandOf(2, 2)).toBe('neutral')); // 1.0

    test('the boundaries themselves are neutral, not their bands', () => {
      expect(bandOf(2, 3)).toBe('neutral'); // exactly 1.5
      expect(bandOf(2, 1)).toBe('neutral'); // exactly 0.5
    });
  });

  test('no openings gives an empty ranking and nothing withheld', () => {
    expect(scoreOpenings([])).toEqual({ leaks: [], withheld: 0 });
  });
});
