/**
 * ST-015. The account read model: the signed-in user, and the players they
 * play as and pay for.
 *
 * The sprint's question is answered in `auth.integration.test.ts`; this suite
 * exercises the three Account routes against a real session and a real
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

describe('the signed-in user and their players', () => {
  test('a created player shows up in /me, and /me carries the account identity', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();

    const created = await a.request('/players', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        displayName: 'Alice Player',
        fideRating: 1800,
        lichessUsername: 'alice-lichess',
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      id: string;
      displayName: string;
      fideRating: number;
      lichessUsername: string;
    };
    expect(createdBody.displayName).toBe('Alice Player');
    expect(createdBody.fideRating).toBe(1800);
    expect(createdBody.lichessUsername).toBe('alice-lichess');

    const me = await a.request('/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      userId: string;
      email: string;
      name: string;
      tier: string;
      players: Array<{ id: string }>;
    };
    expect(meBody.email).toBe(EMAIL_A);
    expect(meBody.name).toBe('alice');
    expect(meBody.tier).toBe('free');
    expect(meBody.players.map((p) => p.id)).toContain(createdBody.id);
  });

  test('a second user’s player is absent from the first user’s /me', async () => {
    const aliceCookie = await signIn(EMAIL_A);
    const bobCookie = await signIn(EMAIL_B);
    const a = app();

    const bobPlayer = await a.request('/players', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      body: JSON.stringify({ displayName: 'Bob Player' }),
    });
    expect(bobPlayer.status).toBe(201);
    const bobId = ((await bobPlayer.json()) as { id: string }).id;

    const me = await a.request('/me', { headers: { cookie: aliceCookie } });
    const meBody = (await me.json()) as { players: Array<{ id: string }> };
    expect(meBody.players.map((p) => p.id)).not.toContain(bobId);
  });

  test('a foreign player is refused on PATCH with 403, and the owner can update their own', async () => {
    const aliceCookie = await signIn(EMAIL_A);
    const bobCookie = await signIn(EMAIL_B);
    const a = app();

    const alicePlayer = await a.request('/players', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      body: JSON.stringify({ displayName: 'Alice Player' }),
    });
    expect(alicePlayer.status).toBe(201);
    const aliceId = ((await alicePlayer.json()) as { id: string }).id;

    // Bob is refused: 403, not 404, so the id cannot be enumerated.
    const foreign = await a.request(`/players/${aliceId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      body: JSON.stringify({ fideRating: 2000 }),
    });
    expect(foreign.status).toBe(403);

    // Alice can update her own player, and the change is reflected.
    const own = await a.request(`/players/${aliceId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      body: JSON.stringify({ fideRating: 2000, lichessUsername: 'alice-new' }),
    });
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as { fideRating: number; lichessUsername: string };
    expect(ownBody.fideRating).toBe(2000);
    expect(ownBody.lichessUsername).toBe('alice-new');
  });

  test('all three account routes answer 401 with no cookie', async () => {
    const a = app();
    const me = await a.request('/me');
    expect(me.status).toBe(401);

    const create = await a.request('/players', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Nobody' }),
    });
    expect(create.status).toBe(401);

    const update = await a.request('/players/00000000-0000-0000-0000-000000000000', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fideRating: 1500 }),
    });
    expect(update.status).toBe(401);
  });

  test('POST /players rejects an invalid body with 400', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();
    const res = await a.request('/players', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ displayName: '' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_request');
  });
});
