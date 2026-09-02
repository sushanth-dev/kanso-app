/**
 * ST-111. The feedback endpoint against a real session and a real PostgreSQL:
 * one stored message per submission, 401 without a session, the Zod bound,
 * and the account-deletion cascade taking the messages with the account.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { feedback } from '../db/schema.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const EMAIL_A = 'alice@example.com';

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

/** The app with the real better-auth handler and the real session reader. */
function app() {
  return createApp({
    db: harness.db,
    auth: createAuth(harness.db, {
      mailer: { async sendConsentNotice() {}, async sendPasswordReset() {} },
    }),
  });
}

/** Sign up and sign in, returning the session cookie header value. */
async function signIn(email: string): Promise<string> {
  const a = app();
  await a.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: email.split('@')[0], email, password: PASSWORD }),
  });
  const res = await a.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  return setCookie as string;
}

describe('POST /feedback', () => {
  test('stores one message against the session account', async () => {
    const cookie = await signIn(EMAIL_A);
    const res = await app().request('/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: 'The report page loads slowly for me.' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; createdAt: string };
    expect(body.id).toBeTruthy();
    expect(body.createdAt).toBeTruthy();

    const [row] = await harness.db.select().from(feedback).where(eq(feedback.id, body.id));
    expect(row).toBeTruthy();
    expect(row!.message).toBe('The report page loads slowly for me.');
  });

  test('401 without a session', async () => {
    const res = await app().request('/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'An anonymous thought.' }),
    });
    expect(res.status).toBe(401);
    const rows = await harness.db.select().from(feedback);
    expect(rows).toHaveLength(0);
  });

  test('refuses an empty and an over-long message', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();

    const empty = await a.request('/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: '   ' }),
    });
    expect(empty.status).toBe(400);

    const overlong = await a.request('/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: 'x'.repeat(2001) }),
    });
    expect(overlong.status).toBe(400);

    const rows = await harness.db.select().from(feedback);
    expect(rows).toHaveLength(0);
  });

  test('deleting the account deletes the messages through the cascade', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();
    const stored = await a.request('/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: 'Keep the drills coming.' }),
    });
    expect(stored.status).toBe(201);

    const deleted = await a.request('/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(deleted.status).toBe(204);

    const rows = await harness.db.select().from(feedback);
    expect(rows).toHaveLength(0);
  });
});
