/**
 * ST-021. The sign-in path is rate-limited: repeated failed attempts are
 * throttled, and a valid sign-in succeeds once the window has passed.
 *
 * This runs through the real better-auth handler against a real PostgreSQL,
 * because the rate limiter is a request-phase hook on the same routes the
 * sign-in flow uses. The limit itself lives in better-auth's in-memory store,
 * not the database, but the sign-in it guards resolves the account through the
 * adapter, so there is nothing to exercise without one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from './app.ts';
import { createAuth } from './auth.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from './db/test-harness.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'alice@example.com';
const MAX_ATTEMPTS = 3;
const WINDOW_SECONDS = 60;

beforeAll(async () => {
  // The limit is production-only by default; the story's test opts in and
  // turns the knobs down so the failure loop is short.
  vi.stubEnv('SIGN_IN_RATE_LIMIT_ENABLED', 'true');
  vi.stubEnv('SIGN_IN_RATE_LIMIT_MAX', String(MAX_ATTEMPTS));
  vi.stubEnv('SIGN_IN_RATE_LIMIT_WINDOW_SECONDS', String(WINDOW_SECONDS));
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

function app() {
  return createApp({
    db: harness.db,
    auth: createAuth(harness.db, {
      mailer: { async sendConsentNotice() {}, async sendPasswordReset() {} },
    }),
  });
}

async function signUp(): Promise<void> {
  const a = app();
  const res = await a.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'alice', email: EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
}

async function signIn(email: string, password: string) {
  const a = app();
  return a.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('the sign-in rate limit', () => {
  test('refuses the attempt after the threshold, then accepts a valid sign-in after the window', async () => {
    // Only the clock is faked, not the timers: the rate limiter reads
    // `Date.now()`, and an integration test must leave the real timers alone
    // for the database driver.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await signUp();

      // The first N failures are let through as normal wrong-password 401s.
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const res = await signIn(EMAIL, 'wrong password');
        expect(res.status).toBe(401);
      }

      // The next attempt is refused before the password is even checked: 429,
      // not 401, so a throttled source cannot tell an account from a typo.
      const refused = await signIn(EMAIL, 'wrong password');
      expect(refused.status).toBe(429);

      // The limit is keyed by the source, not the email, so a throttled
      // probe for a missing account is refused identically: no enumeration.
      const probe = await signIn('nobody@example.com', 'whatever');
      expect(probe.status).toBe(429);

      // Once the window rolls over, a correct password is accepted again.
      vi.advanceTimersByTime((WINDOW_SECONDS + 1) * 1000);
      const ok = await signIn(EMAIL, PASSWORD);
      expect(ok.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
