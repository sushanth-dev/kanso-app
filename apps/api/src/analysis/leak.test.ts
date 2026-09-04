/**
 * ST-026. The pure scoring over leak rows: conversion application and ordering.
 *
 * No database, no clock. The conversion itself is pinned in
 * performance-rating.test.ts; here the scorer's contract is pinned: every group
 * gets a rating leak, and the order is cost, not row count.
 */
import { describe, expect, test } from 'vitest';
import { scoreLeaks } from './leak.ts';

const midTable = { games: 20, score: 10, avgOpponentElo: 1500 };

describe('scoreLeaks', () => {
  test('converts each weakness half-points to rating points', () => {
    const leaks = scoreLeaks(midTable, [
      {
        kind: 'opening',
        key: 'B22',
        label: 'Sicilian, Alapin',
        eco: 'B22',
        halfPointsLost: 2,
        occurrences: 4,
        gamesAffected: 3,
      },
      {
        kind: 'motif',
        key: 'hanging_piece',
        label: 'Hanging piece',
        eco: null,
        halfPointsLost: 1,
        occurrences: 2,
        gamesAffected: 2,
      },
    ]);
    expect(leaks).toEqual([
      {
        kind: 'opening',
        key: 'B22',
        label: 'Sicilian, Alapin',
        eco: 'B22',
        halfPointsLost: 2,
        occurrences: 4,
        gamesAffected: 3,
        ratingLeak: 70,
        saturated: false,
      },
      {
        kind: 'motif',
        key: 'hanging_piece',
        label: 'Hanging piece',
        eco: null,
        halfPointsLost: 1,
        occurrences: 2,
        gamesAffected: 2,
        ratingLeak: 35,
        saturated: false,
      },
    ]);
  });

  test('orders worst first by half-points, not by row count', () => {
    const leaks = scoreLeaks(midTable, [
      {
        kind: 'motif',
        key: 'many',
        label: 'Many',
        eco: null,
        halfPointsLost: 0.5,
        occurrences: 100,
        gamesAffected: 50,
      },
      {
        kind: 'opening',
        key: 'one',
        label: 'One',
        eco: 'one',
        halfPointsLost: 1,
        occurrences: 1,
        gamesAffected: 1,
      },
    ]);
    expect(leaks.map((l) => l.key)).toEqual(['one', 'many']);
  });

  test('equal costs order by kind, then by key', () => {
    // The tie-break is deterministic so the report's order never shuffles
    // between renders.
    const leaks = scoreLeaks(midTable, [
      {
        kind: 'phase',
        key: 'endgame',
        label: 'Endgame',
        eco: null,
        halfPointsLost: 1,
        occurrences: 1,
        gamesAffected: 1,
      },
      {
        kind: 'motif',
        key: 'missed_check',
        label: 'Missed check',
        eco: null,
        halfPointsLost: 1,
        occurrences: 1,
        gamesAffected: 1,
      },
      {
        kind: 'opening',
        key: 'C10',
        label: 'French',
        eco: 'C10',
        halfPointsLost: 1,
        occurrences: 1,
        gamesAffected: 1,
      },
      {
        kind: 'opening',
        key: 'B22',
        label: 'Alapin',
        eco: 'B22',
        halfPointsLost: 1,
        occurrences: 1,
        gamesAffected: 1,
      },
    ]);
    expect(leaks.map((l) => `${l.kind}/${l.key}`)).toEqual([
      'motif/missed_check',
      'opening/B22',
      'opening/C10',
      'phase/endgame',
    ]);
  });

  test('a season with no weakness groups scores to an empty report', () => {
    expect(scoreLeaks(midTable, [])).toEqual([]);
  });

  test('saturation carries through the conversion', () => {
    // More half-points claimed than the season has room for: the floor flag
    // must survive scoring, not just the estimate.
    const [leak] = scoreLeaks({ games: 12, score: 6, avgOpponentElo: 1500 }, [
      {
        kind: 'phase',
        key: 'middlegame',
        label: 'Middlegame',
        eco: null,
        halfPointsLost: 8.5,
        occurrences: 9,
        gamesAffected: 5,
      },
    ]);
    expect(leak!.saturated).toBe(true);
    expect(leak!.ratingLeak).toBe(800);
  });
});
