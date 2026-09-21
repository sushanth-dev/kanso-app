import { afterEach, describe, expect, test, vi } from 'vitest';
import { safeProperties } from './analytics.ts';

const posthogMocks = vi.hoisted(() => ({
  init: vi.fn<(token: string, config?: Record<string, unknown>) => void>(),
  capture: vi.fn<(event: string, properties?: Record<string, unknown>) => void>(),
  set_config: vi.fn<(config?: Record<string, unknown>) => void>(),
}));

vi.mock('posthog-js', () => ({ default: posthogMocks }));

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * ST-176. The module reads its key and decides its capture posture at import time,
 * so a test that wants to see either one loads a fresh copy with the key it needs
 * rather than reading the copy the static import above already evaluated.
 */
async function loadAnalytics(): Promise<typeof import('./analytics.ts')> {
  vi.resetModules();
  posthogMocks.init.mockClear();
  posthogMocks.capture.mockClear();
  posthogMocks.set_config.mockClear();
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key');
  return import('./analytics.ts');
}

describe('init', () => {
  test('starts with the automatic capture off, so the gate fails shut', async () => {
    await loadAnalytics();

    expect(posthogMocks.init).toHaveBeenCalledOnce();
    const [, config] = posthogMocks.init.mock.calls[0]!;
    expect(config?.autocapture).toBe(false);
    expect(config?.capture_pageview).toBe(false);
    expect(config?.capture_exceptions).toBe(false);
    expect(config?.disable_session_recording).toBe(true);
    expect(config?.disable_surveys).toBe(true);
    // Feature flags are configuration the app reads, not data it collects, so
    // they stay on: switching them off takes the announcement bar down.
    expect(config?.advanced_disable_feature_flags).toBeUndefined();
  });

  test('never initialises without a key', async () => {
    vi.resetModules();
    posthogMocks.init.mockClear();
    posthogMocks.set_config.mockClear();
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const analytics = await import('./analytics.ts');

    expect(posthogMocks.init).not.toHaveBeenCalled();
    // And no caller can switch the suite on through a module that never started.
    analytics.enableAnalyticsSuite();
    expect(posthogMocks.set_config).not.toHaveBeenCalled();
  });

  test('leaves the capture off until an allowed account asks for it', async () => {
    await loadAnalytics();

    expect(posthogMocks.set_config).not.toHaveBeenCalled();
  });
});

describe('enableAnalyticsSuite', () => {
  test('turns on the ADR-0038 suite, page views included', async () => {
    const analytics = await loadAnalytics();
    analytics.enableAnalyticsSuite();

    expect(posthogMocks.set_config).toHaveBeenCalledOnce();
    const [config] = posthogMocks.set_config.mock.calls[0]!;
    expect(config?.autocapture).toBe(true);
    expect(config?.capture_exceptions).toBe(true);
    expect(config?.disable_session_recording).toBe(false);
    expect(config?.disable_surveys).toBe(false);
    // 'history_change' and not true: plain true sends the entry page view but
    // leaves the SDK's history monitoring stopped, losing every later one.
    expect(config?.capture_pageview).toBe('history_change');
  });

  test('is a no-op the second time', async () => {
    const analytics = await loadAnalytics();
    analytics.enableAnalyticsSuite();
    analytics.enableAnalyticsSuite();

    expect(posthogMocks.set_config).toHaveBeenCalledOnce();
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

  test('drops every key a game or a child could leak through', () => {
    expect(
      safeProperties({ pgn: '1. e4', fen: 'f', name: 'Mina', email: 'e', analysis: 'a' }),
    ).toEqual({});
  });
});
