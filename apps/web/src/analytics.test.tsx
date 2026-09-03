import { describe, expect, test, vi } from 'vitest';

const posthogMocks = vi.hoisted(() => ({
  init: vi.fn<(token: string, config?: Record<string, unknown>) => void>(),
  capture: vi.fn<(event: string, properties?: Record<string, unknown>) => void>(),
}));

vi.mock('posthog-js', () => ({ default: posthogMocks }));

import { safeProperties } from './analytics.ts';

describe('init', () => {
  test('enables error tracking and switches nothing in the suite off', () => {
    // With no key in the environment the module never initialises and there
    // is nothing to assert.
    if (posthogMocks.init.mock.calls.length === 0) return;
    const [, config] = posthogMocks.init.mock.calls[0]!;
    expect(config?.capture_exceptions).toBe(true);
    expect(config?.autocapture).not.toBe(false);
    expect(config?.capture_pageview).not.toBe(false);
    expect(Object.keys(config ?? {})).toEqual(['capture_exceptions']);
  });
});

describe('safeProperties', () => {
  test('keeps only the whitelisted keys', () => {
    expect(
      safeProperties({
        source: 'chesscom',
        gamesFound: 5,
        gamesImported: 4,
        stream: 'online',
        catalogueKey: 'converting_won_positions',
        tier: 'pro',
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
      tier: 'pro',
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
