/**
 * The pure scoring of the round-decay aggregation. The query is covered against
 * a real PostgreSQL in round-decay.integration.test.ts; this covers what needs
 * no database: the too-thin threshold, the zero-loss round, and the
 * deterministic round order.
 */
import { describe, expect, test } from 'vitest';
import { scoreRoundDecay, type RoundCount } from './round-decay.ts';

function row(
  round: number,
  games: number,
  opts: { mistakes?: number; totalLoss?: number; playerMoves?: number } = {},
): RoundCount {
  return {
    round,
    games,
    mistakes: opts.mistakes ?? 0,
    totalLoss: opts.totalLoss ?? 0,
    playerMoves: opts.playerMoves ?? games * 40,
  };
}

describe('scoreRoundDecay', () => {
  test('refuses a tournament with fewer than two rounds', () => {
    expect(scoreRoundDecay([])).toEqual({ kind: 'not_enough_evidence' });
    expect(scoreRoundDecay([row(1, 3)])).toEqual({ kind: 'not_enough_evidence' });
  });

  test('refuses a tournament where any round has fewer than three games', () => {
    expect(scoreRoundDecay([row(1, 3), row(2, 2)])).toEqual({
      kind: 'not_enough_evidence',
    });
  });

  test('divides total loss by player moves, clean moves included', () => {
    const result = scoreRoundDecay([
      row(1, 3, { mistakes: 2, totalLoss: 300, playerMoves: 100 }),
      row(2, 3, { mistakes: 1, totalLoss: 50, playerMoves: 50 }),
    ]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.rounds[0]!.lossPerMove).toBe(3);
    expect(result.rounds[1]!.lossPerMove).toBe(1);
  });

  test('a round with games but no mistakes scores zero, not absent', () => {
    const result = scoreRoundDecay([row(1, 3), row(2, 3)]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.rounds.map((r) => r.lossPerMove)).toEqual([0, 0]);
  });

  test('orders by round number, not by which round has the most games', () => {
    const result = scoreRoundDecay([row(3, 9), row(1, 3), row(2, 4)]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.rounds.map((r) => r.round)).toEqual([1, 2, 3]);
  });

  test('a round with no moves yields a null loss rather than a division by zero', () => {
    const result = scoreRoundDecay([
      row(1, 3, { totalLoss: 0, playerMoves: 0 }),
      row(2, 3, { totalLoss: 0, playerMoves: 0 }),
    ]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.rounds.map((r) => r.lossPerMove)).toEqual([null, null]);
  });

  test('carries the evidence counts through to each round', () => {
    const result = scoreRoundDecay([row(1, 3, { mistakes: 5 }), row(2, 4, { mistakes: 0 })]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.rounds[0]).toMatchObject({ round: 1, games: 3, mistakes: 5 });
    expect(result.rounds[1]).toMatchObject({ round: 2, games: 4, mistakes: 0 });
    expect(result.roundCount).toBe(2);
  });
});
