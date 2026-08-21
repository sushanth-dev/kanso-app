/**
 * ST-015. The account read model: the signed-in user and the one player they
 * are.
 *
 * The sprint's question is answered in `auth.integration.test.ts`; this suite
 * exercises the two Account routes against a real session and a real
 * PostgreSQL, so the isolation the claim rule promises is visible from the
 * account endpoints themselves.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';

import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const EMAIL_A = 'alice@example.com';
const EMAIL_B = 'bob@example.com';

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

describe('the signed-in user and their player', () => {
  test('/me carries the account identity and the auto-created player', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();

    const me = await a.request('/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      userId: string;
      email: string;
      name: string;
      tier: string;
      player: {
        id: string;
        displayName: string;
        fideRating: number | null;
        lichessUsername: string | null;
      };
    };
    expect(meBody.email).toBe(EMAIL_A);
    expect(meBody.name).toBe('alice');
    expect(meBody.tier).toBe('free');
    expect(meBody.player.displayName).toBe('alice');
    expect(meBody.player.fideRating).toBeNull();
    expect(meBody.player.lichessUsername).toBeNull();
  });

  test('a second user’s player is absent from the first user’s /me', async () => {
    const aliceCookie = await signIn(EMAIL_A);
    const bobCookie = await signIn(EMAIL_B);
    const a = app();

    const bobMe = await a.request('/me', { headers: { cookie: bobCookie } });
    const bobPlayer = ((await bobMe.json()) as { player: { id: string } }).player;

    const me = await a.request('/me', { headers: { cookie: aliceCookie } });
    const meBody = (await me.json()) as { player: { id: string } };
    expect(meBody.player.id).not.toBe(bobPlayer.id);
  });

  test('PATCH /me updates the signed-in user’s own player', async () => {
    const aliceCookie = await signIn(EMAIL_A);
    const bobCookie = await signIn(EMAIL_B);
    const a = app();

    // Alice updates her own player.
    const alice = await a.request('/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      body: JSON.stringify({ fideRating: 2000, lichessUsername: 'alice-new' }),
    });
    expect(alice.status).toBe(200);
    const aliceBody = (await alice.json()) as {
      displayName: string;
      fideRating: number;
      lichessUsername: string;
    };
    expect(aliceBody.fideRating).toBe(2000);
    expect(aliceBody.lichessUsername).toBe('alice-new');
    expect(aliceBody.displayName).toBe('alice');

    // Bob's PATCH /me touches only Bob's own player; Alice's change is untouched.
    const bob = await a.request('/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      body: JSON.stringify({ fideRating: 1200 }),
    });
    expect(bob.status).toBe(200);
    const bobBody = (await bob.json()) as {
      displayName: string;
      fideRating: number;
      lichessUsername: string | null;
    };
    expect(bobBody.fideRating).toBe(1200);
    expect(bobBody.displayName).toBe('bob');
    expect(bobBody.lichessUsername).toBeNull();

    const me = await a.request('/me', { headers: { cookie: aliceCookie } });
    const meBody = (await me.json()) as {
      player: { fideRating: number; lichessUsername: string };
    };
    expect(meBody.player.fideRating).toBe(2000);
    expect(meBody.player.lichessUsername).toBe('alice-new');
  });

  test('the account routes answer 401 with no cookie', async () => {
    const a = app();
    const me = await a.request('/me');
    expect(me.status).toBe(401);

    const update = await a.request('/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fideRating: 1500 }),
    });
    expect(update.status).toBe(401);
  });
});
