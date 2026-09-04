/**
 * The server-side exception seam against a mocked PostHog client.
 *
 * posthog-node owns the wire shape, so this suite pins what we own: the
 * empty-vs-unset config guard, the no-op when unconfigured, and the
 * capture-then-flush ordering the Lambda freeze makes load-bearing. The
 * `VITEST` stub matters because `test:integration` loads `.env` into its
 * workers; without the guard a keyed environment would send during tests.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const posthogClient = vi.hoisted(() => ({
  captureException: vi.fn(),
  flush: vi.fn(async () => {}),
}));

// A regular function, not an arrow: `new PostHog(...)` must construct.
vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function mockPostHog() {
    return posthogClient;
  }),
}));

import { captureApiException, posthogConfigFromEnv } from './analytics.ts';

describe('posthogConfigFromEnv', () => {
  test('reads POSTHOG_KEY', () => {
    expect(posthogConfigFromEnv({ POSTHOG_KEY: 'phc_test' })).toEqual({ apiKey: 'phc_test' });
  });

  test('is null without the key, which is the unconfigured path', () => {
    expect(posthogConfigFromEnv({})).toBeNull();
  });

  test('treats an empty key as unset - the deploy wiring sends one', () => {
    // infra/api.ts interpolates `POSTHOG_KEY: process.env.POSTHOG_KEY ?? ''`,
    // and an empty key must read as unconfigured, exactly as the Z.AI and
    // Resend seams treat theirs.
    expect(posthogConfigFromEnv({ POSTHOG_KEY: '' })).toBeNull();
  });
});

describe('captureApiException', () => {
  beforeEach(() => {
    vi.stubEnv('POSTHOG_KEY', 'phc_test');
    // vitest sets VITEST=true in every worker; the unit suite clears it to
    // reach the client path the integration runs must never take.
    vi.stubEnv('VITEST', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  test('captures under the server id with the context and flushes before returning', async () => {
    const error = new Error('boom');
    await captureApiException(error, { requestId: 'req-1', path: '/games' });
    expect(posthogClient.captureException).toHaveBeenCalledWith(error, 'kanso-api', {
      requestId: 'req-1',
      path: '/games',
    });
    expect(posthogClient.flush).toHaveBeenCalledTimes(1);
  });

  test('is a no-op without a key, so unconfigured deploys send nothing', async () => {
    vi.stubEnv('POSTHOG_KEY', '');
    await captureApiException(new Error('boom'));
    expect(posthogClient.captureException).not.toHaveBeenCalled();
    expect(posthogClient.flush).not.toHaveBeenCalled();
  });
});
