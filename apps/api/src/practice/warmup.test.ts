import { describe, expect, test, vi } from 'vitest';
import { createApp } from '../app.ts';
import { assembleWarmup, WARMUP_SIZE } from './assemble.ts';

describe('assembleWarmup unit behavior', () => {
  test('WARMUP_SIZE is 5', () => {
    expect(WARMUP_SIZE).toBe(5);
  });

  test('assembleWarmup selects puzzles within [rating - 300, rating] and records reviewLevel 0', async () => {
    const insertedAttempts: Record<string, unknown>[] = [];
    const mockPuzzles = [
      { lichessId: 'p1', fen: 'fen1', moves: 'e2e4', rating: 1350 },
      { lichessId: 'p2', fen: 'fen2', moves: 'd2d4', rating: 1400 },
      { lichessId: 'p3', fen: 'fen3', moves: 'c2c4', rating: 1450 },
      { lichessId: 'p4', fen: 'fen4', moves: 'g1f3', rating: 1500 },
      { lichessId: 'p5', fen: 'fen5', moves: 'b1c3', rating: 1380 },
    ];

    const mockDb = {
      select: vi.fn((_fields) => ({
        from: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => [
                {
                  catalogueId: 'cat-1',
                  title: 'Tactical alertness',
                  key: 'tactical_alertness',
                },
              ]),
            })),
          })),
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => [{ motif: 'fork' }]),
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => [{ motif: 'fork' }]),
              })),
            })),
          })),
          where: vi.fn(() => ({
            limit: vi.fn(() => [{ fideRating: 1600 }]),
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => mockPuzzles),
            })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((rows: unknown) => {
          insertedAttempts.push(...(rows as Record<string, unknown>[]));
          return {
            onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          };
        }),
      })),
    } as unknown as Parameters<typeof assembleWarmup>[0];

    const result = await assembleWarmup(mockDb, 'player-1', undefined, 'tournament');
    expect(result).not.toBe('pool_empty');
    if (result !== 'pool_empty') {
      expect(result.puzzles).toHaveLength(5);
      expect(result.rating).toBe(1600);
      expect(result.focusTitle).toBe('Tactical alertness');
      expect(insertedAttempts).toHaveLength(5);
      for (const attempt of insertedAttempts) {
        expect(attempt.reviewLevel).toBe(0);
        expect(attempt.attempts).toBe(0);
        expect(attempt.playerId).toBe('player-1');
      }
    }
  });
});

describe('POST /practice/warmup route authentication', () => {
  test('returns 401 when unauthenticated', async () => {
    const app = createApp();
    const res = await app.request('/practice/warmup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});
