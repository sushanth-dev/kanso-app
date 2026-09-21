/**
 * ST-015. The account read model: the signed-in user and the one player they
 * are.
 *
 * The sprint's question is answered in `auth.integration.test.ts`; this suite
 * exercises the Account routes against a real session and a real PostgreSQL, so
 * the isolation the claim rule promises is visible from the account endpoints
 * themselves.
 *
 * ST-164 adds the probe that answers whether anybody is signed in at all. It is
 * here beside `/me` because the two are deliberately different: every case that
 * `/me` answers 401, the probe answers 200.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';

import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { actionItem, player, puzzle, puzzleAttempt, report } from '../db/schema.ts';
import { session, user } from '../db/auth-schema.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const EMAIL_A = 'alice@example.com';
const EMAIL_B = 'bob@example.com';
/** The session cookie name better-auth issues with the `kanso` prefix. */
const SESSION_COOKIE = 'kanso.session_token';

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
      mailer: { async sendConsentNotice() {}, async sendPasswordReset() {}, async sendNudge() {} },
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

/**
 * ST-176. Whether the PostHog suite's automatic capture may run for this session.
 * It rides `/me` rather than a route of its own, so this is the whole client-facing
 * surface of the age gate.
 */
async function suiteAllowed(a: ReturnType<typeof app>, cookie: string): Promise<boolean> {
  const res = await a.request('/me', { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { analyticsSuiteAllowed: boolean }).analyticsSuiteAllowed;
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
      analyticsSuiteAllowed: boolean;
      player: {
        id: string;
        displayName: string;
        fideRating: number | null;
        lichessUsername: string | null;
      };
    };
    expect(meBody.email).toBe(EMAIL_A);
    expect(meBody.name).toBe('alice');
    expect(meBody.tier).toBe('beginner');
    // ST-176. This account never stated an age, so the suite's automatic capture
    // is off. It is also the answer every account created before the gate existed
    // gets, because the gate reads the row rather than anything recorded at
    // sign-up.
    expect(meBody.analyticsSuiteAllowed).toBe(false);
    expect(meBody.player.displayName).toBe('alice');
    expect(meBody.player.fideRating).toBeNull();
    expect(meBody.player.lichessUsername).toBeNull();
  });

  test('ST-176: the analytics gate reads the account as it is now, not as it was at sign-up', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();

    expect(await suiteAllowed(a, cookie)).toBe(false);

    // Stating an age after the fact lifts the gate, which is why an account
    // created before the gate existed needs no backfill: the row is read each
    // time rather than anything recorded at creation.
    await harness.db.update(user).set({ dateOfBirth: '2000-06-01' }).where(eq(user.email, EMAIL_A));

    expect(await suiteAllowed(a, cookie)).toBe(true);
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

  test('PATCH /me rejects a display name another account already holds', async () => {
    const aliceCookie = await signIn(EMAIL_A);
    await signIn(EMAIL_B);
    const a = app();

    // Alice takes the name "bob" that Bob's player already holds.
    const res = await a.request('/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      body: JSON.stringify({ displayName: 'bob' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('username_taken');
    expect(body.message).toBe('That username is already taken.');

    // Alice's own name is unchanged.
    const me = await a.request('/me', { headers: { cookie: aliceCookie } });
    const meBody = (await me.json()) as { player: { displayName: string } };
    expect(meBody.player.displayName).toBe('alice');
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

describe('DELETE /account', () => {
  test('a wrong password answers 403 and deletes nothing', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();

    const res = await a.request('/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ password: 'not the password' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('wrong_password');

    const me = await a.request('/me', { headers: { cookie } });
    expect(me.status).toBe(200);
  });

  test('the right password deletes the account and everything its player owns', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();

    const me = await a.request('/me', { headers: { cookie } });
    const { userId, player: playerView } = (await me.json()) as {
      userId: string;
      player: { id: string };
    };

    // Chess history worth cascading: a pool puzzle, a report, an action item
    // from it, and one drilled attempt, all under the one player.
    await harness.db.insert(puzzle).values({
      lichessId: 'testPuzzle',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: 'e2e4 e7e5',
      rating: 1500,
      themes: ['hangingPiece'],
    });
    const [reportRow] = await harness.db
      .insert(report)
      .values({ playerId: playerView.id, stream: 'tournament', gamesCovered: 6 })
      .returning({ id: report.id });
    await harness.db.insert(actionItem).values({
      playerId: playerView.id,
      kind: 'phase',
      groupKey: 'phase:endgame',
      resourceIndex: 0,
      tier: 'beginner',
      resource: "Silman's Complete Endgame Course",
      label: 'Endgame',
    });
    await harness.db.insert(puzzleAttempt).values({
      playerId: playerView.id,
      puzzleId: 'testPuzzle',
      kind: 'phase',
      groupKey: 'phase:endgame',
      attempts: 1,
      solved: true,
    });

    // Sign-up already opens a session and sign-in adds another; what matters
    // is that both die with the account.
    const before = await harness.db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(before.length).toBeGreaterThanOrEqual(1);

    const res = await a.request('/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(204);

    // The session died with the account, so the old cookie is worthless.
    const after = await a.request('/me', { headers: { cookie } });
    expect(after.status).toBe(401);

    const users = await harness.db.select().from(user).where(eq(user.email, EMAIL_A));
    expect(users.length).toBe(0);
    expect(
      (await harness.db.select().from(player).where(eq(player.id, playerView.id))).length,
    ).toBe(0);
    expect(
      (await harness.db.select().from(report).where(eq(report.id, reportRow!.id))).length,
    ).toBe(0);
    expect((await harness.db.select().from(actionItem)).length).toBe(0);
    expect((await harness.db.select().from(puzzleAttempt)).length).toBe(0);
    // The pool puzzle is shared by every player, so it survives.
    expect((await harness.db.select().from(puzzle)).length).toBe(1);
  });
});

describe('the session probe', () => {
  test('answers 200 with signedIn false when nobody is signed in', async () => {
    const a = app();

    const res = await a.request('/session');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: false });
  });

  test('answers 200 with signedIn true when a session cookie is present', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();

    const res = await a.request('/session', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true });
  });

  test('a forged cookie is answered 200, not the 401 /me gives it', async () => {
    const a = app();
    const cookie = `${SESSION_COOKIE}=forged-token-that-is-not-a-real-session`;

    const probe = await a.request('/session', { headers: { cookie } });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toEqual({ signedIn: false });

    const me = await a.request('/me', { headers: { cookie } });
    expect(me.status).toBe(401);
  });

  test('an expired session drops back to signedIn false rather than failing', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();
    expect(await (await a.request('/session', { headers: { cookie } })).json()).toEqual({
      signedIn: true,
    });

    await harness.db.update(session).set({ expiresAt: new Date(Date.now() - 1000) });

    const res = await a.request('/session', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: false });
  });

  test('the body carries nothing but signedIn, so it names no account', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();

    const res = await a.request('/session', { headers: { cookie } });
    expect(Object.keys((await res.json()) as Record<string, unknown>)).toEqual(['signedIn']);
  });
});
