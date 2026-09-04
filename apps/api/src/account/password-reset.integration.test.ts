/**
 * ST-065. Password recovery, exercised end to end against a real PostgreSQL
 * with a fake mailer: a reset request for a real and an unknown email answer
 * identically and only the real one mails; the mailed token sets a working
 * password exactly once; a tampered or expired token is refused; and a
 * signed-in user changes their own password. The reset request and the reset
 * itself are rate-limited in a second describe below.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { verification } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { Mailer } from './mailer.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'fresh horse battery staple';
const EMAIL = 'alice@example.com';

const resets: Array<{ to: string; resetUrl: string }> = [];
const mailer: Mailer = {
  sendConsentNotice() {
    return Promise.resolve();
  },
  sendPasswordReset(input) {
    resets.push(input);
    return Promise.resolve();
  },
  async sendNudge() {},
};

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  resets.length = 0;
});

function app() {
  return createApp({ db: harness.db, auth: createAuth(harness.db, { mailer }) });
}

async function signUp(email = EMAIL): Promise<void> {
  const res = await app().request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: email.split('@')[0], email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
}

async function signIn(email: string, password: string): Promise<Response> {
  return app().request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function signInCookie(email: string, password: string): Promise<string> {
  const res = await signIn(email, password);
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  return setCookie as string;
}

async function requestReset(email: string): Promise<Response> {
  return app().request('/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

async function resetPassword(token: string, newPassword: string): Promise<Response> {
  return app().request('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newPassword, token }),
  });
}

function lastResetToken(): string {
  const { resetUrl } = resets[resets.length - 1]!;
  return resetUrl.slice(resetUrl.lastIndexOf('/') + 1);
}

describe('password recovery', () => {
  test('a request for a known email mails a link that sets a working password once', async () => {
    await signUp();
    const request = await requestReset(EMAIL);
    expect(request.status).toBe(200);
    expect(resets).toHaveLength(1);
    expect(resets[0]!.to).toBe(EMAIL);

    const reset = await resetPassword(lastResetToken(), NEW_PASSWORD);
    expect(reset.status).toBe(200);

    // The new password signs in; the old one does not.
    expect((await signIn(EMAIL, NEW_PASSWORD)).status).toBe(200);
    expect((await signIn(EMAIL, PASSWORD)).status).toBe(401);

    // A replay of the same token is refused: single-use.
    expect((await resetPassword(lastResetToken(), 'another password 123')).status).toBe(400);
  });

  test('a request for an unknown email answers identically and mails nothing', async () => {
    const request = await requestReset('nobody@example.com');
    expect(request.status).toBe(200);
    expect(resets).toHaveLength(0);
  });

  test('a tampered token is refused', async () => {
    await signUp();
    await requestReset(EMAIL);
    expect((await resetPassword('tampered-token', NEW_PASSWORD)).status).toBe(400);
  });

  test('an expired token is refused', async () => {
    await signUp();
    await requestReset(EMAIL);
    const token = lastResetToken();
    await harness.db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `reset-password:${token}`));
    expect((await resetPassword(token, NEW_PASSWORD)).status).toBe(400);
  });

  test('a signed-in user changes their own password', async () => {
    await signUp();
    const cookie = await signInCookie(EMAIL, PASSWORD);
    const res = await app().request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect((await signIn(EMAIL, NEW_PASSWORD)).status).toBe(200);
    expect((await signIn(EMAIL, PASSWORD)).status).toBe(401);
  });

  test('changing the password requires the current password', async () => {
    await signUp();
    const cookie = await signInCookie(EMAIL, PASSWORD);
    const res = await app().request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: 'wrong password', newPassword: NEW_PASSWORD }),
    });
    expect(res.status).not.toBe(200);
  });

  test('changing the password without a session is refused', async () => {
    await signUp();
    const res = await app().request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
    });
    expect(res.status).toBe(401);
  });
});

describe('the password-reset rate limits', () => {
  test('the reset request is rate-limited', async () => {
    // The limit is production-only by default; the story's test opts in with
    // the same knobs ST-021 uses, stubbed per-test so the flow above runs
    // unthrottled.
    vi.stubEnv('SIGN_IN_RATE_LIMIT_ENABLED', 'true');
    vi.stubEnv('SIGN_IN_RATE_LIMIT_MAX', '3');
    vi.stubEnv('SIGN_IN_RATE_LIMIT_WINDOW_SECONDS', '60');
    try {
      for (let i = 0; i < 3; i++) {
        expect((await requestReset(EMAIL)).status).toBe(200);
      }
      expect((await requestReset(EMAIL)).status).toBe(429);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('the reset itself is rate-limited', async () => {
    vi.stubEnv('SIGN_IN_RATE_LIMIT_ENABLED', 'true');
    vi.stubEnv('SIGN_IN_RATE_LIMIT_MAX', '3');
    vi.stubEnv('SIGN_IN_RATE_LIMIT_WINDOW_SECONDS', '60');
    try {
      for (let i = 0; i < 3; i++) {
        // A bad token is refused 400, but each attempt still counts toward the
        // limit, so the fourth is throttled before the token is even read.
        expect((await resetPassword('bad-token', NEW_PASSWORD)).status).toBe(400);
      }
      expect((await resetPassword('bad-token', NEW_PASSWORD)).status).toBe(429);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
