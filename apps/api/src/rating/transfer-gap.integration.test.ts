/**
 * ST-018. The transfer-gap endpoint, end to end against a real PostgreSQL with
 * a fake rating fetcher.
 *
 * The fake records every username it is asked to fetch, so the tests prove the
 * endpoint does not hit the network when it should not, and that the "unknown"
 * answer from upstream is stored as null, never as zero.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { player } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { RatingFetcher } from './rating-fetcher.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const OWNER = 'owner@example.com';
const STRANGER = 'stranger@example.com';

type Platform = 'chesscom' | 'lichess';
const requested: Array<{ platform: Platform; username: string }> = [];
const canned: { chesscom: number | null; lichess: number | null } = {
  chesscom: null,
  lichess: null,
};

type TransferGapBody = {
  playerId: string;
  overTheBoardRating: number | null;
  chesscom: { rating: number | null; gap: number | null };
  lichess: { rating: number | null; gap: number | null };
};

const ratingFetcher: RatingFetcher = {
  chesscom(username) {
    requested.push({ platform: 'chesscom', username });
    return Promise.resolve(canned.chesscom);
  },
  lichess(username) {
    requested.push({ platform: 'lichess', username });
    return Promise.resolve(canned.lichess);
  },
};

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  requested.length = 0;
  canned.chesscom = null;
  canned.lichess = null;
});

function app() {
  return createApp({ db: harness.db, auth: createAuth(harness.db), ratingFetcher });
}

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
  return res.headers.get('set-cookie') as string;
}

async function whoAmI(cookie: string): Promise<string> {
  const res = await app().request('/api/auth/get-session', { headers: { cookie } });
  const body = (await res.json()) as { session: { userId: string } };
  expect(body.session).toBeTruthy();
  return body.session.userId;
}

async function makePlayer(
  ownerUserId: string,
  values: Partial<typeof player.$inferInsert> = {},
): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId, displayName: 'The child', ...values })
    .returning({ id: player.id });
  return row!.id;
}

async function transferGap(cookie: string, playerId: string, refresh = false): Promise<Response> {
  return app().request(`/players/${playerId}/transfer-gap${refresh ? '?refresh=true' : ''}`, {
    headers: { cookie },
  });
}

async function stored(playerId: string) {
  const [row] = await harness.db.select().from(player).where(eq(player.id, playerId)).limit(1);
  return row!;
}

describe('the transfer gap', () => {
  test('fetches, snapshots, and reports the gap against FIDE', async () => {
    canned.chesscom = 1900;
    canned.lichess = 1850;

    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await makePlayer(owner, {
      fideRating: 1300,
      chesscomUsername: 'onlinekid',
      lichessUsername: 'onlinekid',
    });

    const res = await transferGap(cookie, playerId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TransferGapBody;

    expect(body).toEqual({
      playerId,
      overTheBoardRating: 1300,
      chesscom: { rating: 1900, gap: 600 },
      lichess: { rating: 1850, gap: 550 },
    });

    expect(requested).toEqual([
      { platform: 'chesscom', username: 'onlinekid' },
      { platform: 'lichess', username: 'onlinekid' },
    ]);

    const row = await stored(playerId);
    expect(row.chesscomRating).toBe(1900);
    expect(row.lichessRating).toBe(1850);
    expect(row.ratingFetchedAt).not.toBeNull();
  });

  test('falls back to USCF when FIDE is absent', async () => {
    canned.chesscom = 1900;

    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await makePlayer(owner, { uscfRating: 1400, chesscomUsername: 'onlinekid' });

    const res = await transferGap(cookie, playerId);
    const body = (await res.json()) as TransferGapBody;

    expect(body.overTheBoardRating).toBe(1400);
    expect(body.chesscom.gap).toBe(500);
  });

  test('a player with no usernames never calls the fetcher and reports all-null', async () => {
    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await makePlayer(owner, { fideRating: 1300 });

    const res = await transferGap(cookie, playerId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TransferGapBody;

    expect(body).toEqual({
      playerId,
      overTheBoardRating: 1300,
      chesscom: { rating: null, gap: null },
      lichess: { rating: null, gap: null },
    });
    expect(requested).toEqual([]);
  });

  test('an upstream error is stored and reported as null, never zero', async () => {
    canned.chesscom = null; // the fake stands in for an upstream error

    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await makePlayer(owner, { fideRating: 1300, chesscomUsername: 'onlinekid' });

    const res = await transferGap(cookie, playerId);
    const body = (await res.json()) as TransferGapBody;

    expect(body.chesscom).toEqual({ rating: null, gap: null });
    const row = await stored(playerId);
    expect(row.chesscomRating).toBeNull();
    expect(row.ratingFetchedAt).not.toBeNull();
  });

  test('a second view inside the TTL does not re-fetch, and refresh does', async () => {
    canned.chesscom = 1900;

    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await makePlayer(owner, { fideRating: 1300, chesscomUsername: 'onlinekid' });

    await transferGap(cookie, playerId);
    expect(requested).toHaveLength(1);

    await transferGap(cookie, playerId);
    expect(requested).toHaveLength(1);

    await transferGap(cookie, playerId, true);
    expect(requested).toHaveLength(2);
  });

  test('a second user with no claim answers 403 and never fetches', async () => {
    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await makePlayer(owner, { chesscomUsername: 'onlinekid' });

    const stranger = await signIn(STRANGER);
    const res = await transferGap(stranger, playerId);
    expect(res.status).toBe(403);
    expect(requested).toEqual([]);
  });
});
