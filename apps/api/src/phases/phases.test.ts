/**
 * ST-025. The pure scoring: phase zero-fill and ordering, and the time-trouble
 * reported / refusal cases.
 *
 * No database, no clock, so the decisions a coach sees are pinned without a
 * server. The query side is covered by the integration test.
 */
import { describe, expect, test } from 'vitest';
import {
  MIN_CLOCKED_GAMES,
  MIN_TROUBLE_MOVES,
  TROUBLE_CLOCK_MS,
  scorePhases,
  scoreTimeTrouble,
  type PhaseCount,
  type TimeTroubleCounts,
} from './phases.ts';

function count(
  phase: PhaseCount['phase'],
  totalLoss: number,
  games: number,
  mistakes: number,
): PhaseCount {
  return { phase, totalLoss, games, mistakes };
}

describe('scorePhases', () => {
  test('a player with no analysed games is refused, not answered', () => {
    expect(scorePhases({ completeGames: 0, counts: [] })).toEqual({
      kind: 'not_enough_evidence',
    });
  });

  test('returns all three phases in fixed order, zero-filling empty ones', () => {
    const result = scorePhases({
      completeGames: 5,
      counts: [count('middlegame', 800, 4, 12)],
    });
    expect(result).toEqual({
      kind: 'ok',
      phases: [
        { phase: 'opening', totalCpLoss: 0, games: 0 },
        { phase: 'middlegame', totalCpLoss: 800, games: 4 },
        { phase: 'endgame', totalCpLoss: 0, games: 0 },
      ],
      mistakeCount: 12,
    });
  });

  test('mistakeCount is the total mistakes, independent of phase order', () => {
    const result = scorePhases({
      completeGames: 5,
      counts: [count('endgame', 100, 1, 2), count('opening', 200, 2, 3)],
    });
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.mistakeCount).toBe(5);
    expect(result.phases.map((p) => p.phase)).toEqual(['opening', 'middlegame', 'endgame']);
  });
});

describe('scoreTimeTrouble', () => {
  const counts: TimeTroubleCounts = {
    clockedGames: 5,
    troubleMoves: 20,
    troubleMistakes: 8,
    calmMoves: 60,
    calmMistakes: 12,
    fromMove: 22,
  };

  test('the tournament stream is unavailable, with the reason', () => {
    expect(scoreTimeTrouble('tournament', counts)).toEqual({
      status: 'unavailable',
      reason: 'not_online',
    });
  });

  test('no clocked games is no_clock_data', () => {
    expect(scoreTimeTrouble('online', { ...counts, clockedGames: 0 })).toEqual({
      status: 'unavailable',
      reason: 'no_clock_data',
    });
  });

  test('too few clocked games refuses rather than reports', () => {
    expect(scoreTimeTrouble('online', { ...counts, clockedGames: 2 })).toEqual({
      status: 'unavailable',
      reason: 'not_enough_evidence',
    });
  });

  test('too few trouble moves refuses rather than reports', () => {
    expect(scoreTimeTrouble('online', { ...counts, troubleMoves: 5 })).toEqual({
      status: 'unavailable',
      reason: 'not_enough_evidence',
    });
  });

  test('reports the rates and the move number once the evidence holds', () => {
    expect(scoreTimeTrouble('online', counts)).toEqual({
      status: 'reported',
      clockedGames: 5,
      fromMove: 22,
      troubleMoves: 20,
      troubleMistakeRate: 0.4,
      calmMoves: 60,
      calmMistakeRate: 0.2,
    });
  });

  test('the thresholds are the numbers the story decided', () => {
    expect(TROUBLE_CLOCK_MS).toBe(30_000);
    expect(MIN_CLOCKED_GAMES).toBe(3);
    expect(MIN_TROUBLE_MOVES).toBe(10);
  });
});
