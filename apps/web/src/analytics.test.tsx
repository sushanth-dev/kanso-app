import { describe, expect, test, vi } from 'vitest';

vi.mock('posthog-js', () => ({
  default: { init: vi.fn(), capture: vi.fn() },
}));

import { safeProperties } from './analytics.ts';

describe('safeProperties', () => {
  test('keeps only the whitelisted keys', () => {
    expect(
      safeProperties({
        source: 'chesscom',
        gamesFound: 5,
        gamesImported: 4,
        stream: 'online',
        catalogueKey: 'converting_won_positions',
        plan: 'monthly',
        pgn: '1. e4 e5',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
        name: 'Mina',
        email: 'mina@example.com',
        playerId: '00000000-0000-4000-8000-000000000001',
        analysis: '{"eval": 0.5}',
      }),
    ).toEqual({
      source: 'chesscom',
      gamesFound: 5,
      gamesImported: 4,
      stream: 'online',
      catalogueKey: 'converting_won_positions',
      plan: 'monthly',
    });
  });

  test('drops every key a game or child could leak through', () => {
    expect(
      safeProperties({
        pgn: '1. e4',
        fen: 'f',
        name: 'Mina',
        email: 'e',
        playerId: 'p',
        analysis: 'a',
      }),
    ).toEqual({});
  });
});
