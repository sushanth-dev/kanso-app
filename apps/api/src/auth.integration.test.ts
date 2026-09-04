/**
 * ST-014. The sprint's question, as a test: does the one authorization rule
 * survive a real session?
 *
 * Everything here runs through the real better-auth handler and the real
 * session reader, against a real PostgreSQL. No session is stubbed: users are
 * created by POSTing to `/api/auth/sign-up/email`, signed in through
 * `/api/auth/sign-in/email`, and the cookie better-auth issues is what the
 * guarded endpoints see.
 *
 * The two-real-users test is the reason this story is first in the sprint.
 * `hasPlayerClaim` resolves the `userId` better-auth puts in a session against
 * `player.owner_user_id`. If the id
 * better-auth writes into `user.id` is not the id it puts in the session, the
 * second user reads the first's data. This test is the proof either way.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from './app.ts';
import { createAuth } from './auth.ts';
import { player, tournament } from './db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from './db/test-harness.ts';

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

/** The session cookie name better-auth issues with the `kanso` prefix. */
const SESSION_COOKIE = 'kanso.session_token';
/** The id of the player the sign-up hook created for this account. */
async function playerIdFor(ownerUserId: string): Promise<string> {
  const [row] = await harness.db
    .select({ id: player.id })
    .from(player)
    .where(eq(player.ownerUserId, ownerUserId))
    .limit(1);
  expect(row).toBeTruthy();
  return row!.id;
}

async function seedTournament(playerId: string): Promise<string> {
  const [t] = await harness.db
    .insert(tournament)
    .values({ playerId, name: 'Autumn Open', key: 'autumn open' })
    .returning({ id: tournament.id });
  await harness.sql`
    INSERT INTO game (player_id, tournament_id, stream, source, pgn_hash, pgn, result, analysis_status)
    VALUES (${playerId}, ${t!.id}, 'tournament', 'pgn_upload', ${`hash_${playerId}`}, 'pgn', '1-0', 'pending')
  `;
  return t!.id;
}

describe('a real session', () => {
  test('a guarded endpoint answers 401 with no cookie', async () => {
    const a = app();
    const res = await a.request('/games');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('no_session');
  });

  test('a guarded endpoint answers normally with a valid cookie', async () => {
    const cookie = await signIn(EMAIL_A);
    const a = app();

    const res = await a.request('/games', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { games: unknown[] };
    expect(body.games).toEqual([]);
  });

  test('an expired or tampered session cookie is refused with 401, not 500', async () => {
    const a = app();
    const res = await a.request('/games', {
      headers: { cookie: `${SESSION_COOKIE}=forged-token-that-is-not-a-real-session` },
    });
    expect(res.status).toBe(401);
  });

  test('the sprint question: a second real user is refused the first user’s data with 403', async () => {
    const aliceCookie = await signIn(EMAIL_A);
    const bobCookie = await signIn(EMAIL_B);

    const alice = await whoAmI(aliceCookie);
    const bob = await whoAmI(bobCookie);
    expect(alice.userId).not.toBe(bob.userId);

    const a = app();
    const alicePlayer = await playerIdFor(alice.userId);
    const aliceTournament = await seedTournament(alicePlayer);

    // Bob reads his own player-scoped routes: both 200, empty because Bob has
    // no games or tournaments.
    const bobGames = await a.request('/games', { headers: { cookie: bobCookie } });
    expect(bobGames.status).toBe(200);
    const bobGamesBody = (await bobGames.json()) as { games: unknown[] };
    expect(bobGamesBody.games).toEqual([]);

    const bobTournaments = await a.request('/tournaments', { headers: { cookie: bobCookie } });
    expect(bobTournaments.status).toBe(200);
    const bobTournamentsBody = (await bobTournaments.json()) as { tournaments: unknown[] };
    expect(bobTournamentsBody.tournaments).toEqual([]);

    // Bob cannot name Alice's tournament through the object-scoped route: 403.
    const tournament = await a.request(`/tournaments/${aliceTournament}`, {
      headers: { cookie: bobCookie },
    });
    expect(tournament.status).toBe(403);

    // Alice herself can still read all of it.
    const gamesOk = await a.request('/games', { headers: { cookie: aliceCookie } });
    expect(gamesOk.status).toBe(200);
    const tournamentsOk = await a.request('/tournaments', { headers: { cookie: aliceCookie } });
    expect(tournamentsOk.status).toBe(200);
    const tournamentOk = await a.request(`/tournaments/${aliceTournament}`, {
      headers: { cookie: aliceCookie },
    });
    expect(tournamentOk.status).toBe(200);
  });
});

/** Ask better-auth who the cookie belongs to, and return the user id. */
async function whoAmI(cookie: string): Promise<{ userId: string }> {
  const a = app();
  const res = await a.request('/api/auth/get-session', { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { session: { userId: string } };
  expect(body.session).toBeTruthy();
  return { userId: body.session.userId };
}
