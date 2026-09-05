/**
 * ST-120. The gap series, end to end against a real PostgreSQL.
 *
 * The series reads the stored snapshot - the fake fetcher proves this read
 * never calls the platforms - and the tournament partition: online games with
 * Elo headers never put a point on the line.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { game, player, tournament } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { RatingFetcher } from './rating-fetcher.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const OWNER = 'owner@example.com';

const requested: Array<{ platform: string; username: string }> = [];
const canned: { chesscom: number | null; lichess: number | null } = {
  chesscom: null,
  lichess: null,
};

type SeriesBody = {
  playerId: string;
  platform: 'chesscom' | 'lichess' | null;
  onlineRating: number | null;
  points: Array<{
    tournamentId: string;
    name: string;
    date: string;
    rating: number;
    gap: number | null;
  }>;
  skippedTournaments: number;
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
  return createApp({
    db: harness.db,
    auth: createAuth(harness.db, {
      mailer: { async sendConsentNotice() {}, async sendPasswordReset() {}, async sendNudge() {} },
    }),
    ratingFetcher,
  });
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

async function ownPlayer(
  ownerUserId: string,
  values: Partial<typeof player.$inferInsert> = {},
): Promise<string> {
  const [row] = await harness.db
    .select({ id: player.id })
    .from(player)
    .where(eq(player.ownerUserId, ownerUserId))
    .limit(1);
  if (Object.keys(values).length > 0) {
    await harness.db.update(player).set(values).where(eq(player.id, row!.id));
  }
  return row!.id;
}

async function addTournament(
  playerId: string,
  name: string,
  startedAt: Date | null,
): Promise<string> {
  const [row] = await harness.db
    .insert(tournament)
    .values({ playerId, name, key: name.toLowerCase(), startedAt })
    .returning({ id: tournament.id });
  return row!.id;
}

async function addGame(
  playerId: string,
  tournamentId: string | null,
  stream: 'tournament' | 'online',
  fields: Partial<typeof game.$inferInsert> = {},
): Promise<void> {
  await harness.db.insert(game).values({
    playerId,
    tournamentId,
    stream,
    source: 'pgn_upload',
    pgnHash: `hash-${crypto.randomUUID()}`,
    pgn: '[Event "t"]\n\n1. e4 e5 1-0',
    result: '1-0',
    analysisStatus: 'pending',
    ...fields,
  });
}

async function series(cookie: string): Promise<{ res: Response; body: SeriesBody }> {
  const res = await app().request('/transfer-gap/series', { headers: { cookie } });
  return { res, body: (await res.json()) as SeriesBody };
}

describe('the transfer gap series', () => {
  test('one point per dated, rated tournament, sorted, with the gap against the snapshot', async () => {
    canned.chesscom = 1900;

    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await ownPlayer(owner, {
      chesscomUsername: 'onlinekid',
      chesscomRating: 1900,
      ratingFetchedAt: new Date(),
    });

    const spring = await addTournament(playerId, 'Spring Open', new Date('2026-03-14T09:00:00Z'));
    const autumn = await addTournament(playerId, 'Autumn Open', new Date('2026-09-05T09:00:00Z'));
    // Spring: the player sits white at 1300.
    await addGame(playerId, spring, 'tournament', {
      playerColor: 'white',
      whiteElo: 1300,
      blackElo: 1350,
      playedAt: new Date('2026-03-14T10:00:00Z'),
    });
    // Autumn: the player sits black at 1500 - the player-side read follows colour.
    await addGame(playerId, autumn, 'tournament', {
      playerColor: 'black',
      whiteElo: 1480,
      blackElo: 1500,
      playedAt: new Date('2026-09-05T10:00:00Z'),
    });

    const { res, body } = await series(cookie);
    expect(res.status).toBe(200);
    expect(body.platform).toBe('chesscom');
    expect(body.onlineRating).toBe(1900);
    expect(body.points).toEqual([
      {
        tournamentId: spring,
        name: 'Spring Open',
        date: '2026-03-14T09:00:00.000Z',
        rating: 1300,
        gap: 600,
      },
      {
        tournamentId: autumn,
        name: 'Autumn Open',
        date: '2026-09-05T09:00:00.000Z',
        rating: 1500,
        gap: 400,
      },
    ]);
    expect(body.skippedTournaments).toBe(0);
  });

  test('online games never enter the series, whatever their headers claim', async () => {
    canned.chesscom = 1900;

    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await ownPlayer(owner, {
      chesscomUsername: 'onlinekid',
      chesscomRating: 1900,
      ratingFetchedAt: new Date(),
    });

    const only = await addTournament(playerId, 'Spring Open', new Date('2026-03-14T09:00:00Z'));
    await addGame(playerId, only, 'tournament', {
      playerColor: 'white',
      whiteElo: 1300,
      blackElo: 1350,
      playedAt: new Date('2026-03-14T10:00:00Z'),
    });
    await addGame(playerId, null, 'online', {
      playerColor: 'black',
      whiteElo: 9000,
      blackElo: 9100,
      playedAt: new Date('2026-04-01T10:00:00Z'),
    });

    const { body } = await series(cookie);
    expect(body.points).toHaveLength(1);
    expect(body.points[0]!.rating).toBe(1300);
  });

  test('an event whose games carry no player-side Elo, or no date, is counted as skipped', async () => {
    canned.chesscom = 1900;

    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await ownPlayer(owner, {
      chesscomUsername: 'onlinekid',
      chesscomRating: 1900,
      ratingFetchedAt: new Date(),
    });

    const unrated = await addTournament(playerId, 'School Rapid', new Date('2026-02-01T09:00:00Z'));
    await addGame(playerId, unrated, 'tournament', {
      playerColor: null,
      whiteElo: 1300,
      blackElo: 1300,
      playedAt: new Date('2026-02-01T10:00:00Z'),
    });
    const undated = await addTournament(playerId, 'Club Night', null);
    await addGame(playerId, undated, 'tournament', {
      playerColor: 'white',
      whiteElo: 1300,
      blackElo: 1300,
      playedAt: null,
    });

    const { body } = await series(cookie);
    expect(body.points).toEqual([]);
    expect(body.skippedTournaments).toBe(2);
  });

  test('a mid-event rating change reads the rating the player carried out of the event', async () => {
    canned.chesscom = 1900;

    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await ownPlayer(owner, {
      chesscomUsername: 'onlinekid',
      chesscomRating: 1900,
      ratingFetchedAt: new Date(),
    });

    const only = await addTournament(playerId, 'Spring Open', null);
    // Two dated games with different published ratings; the later one wins.
    await addGame(playerId, only, 'tournament', {
      playerColor: 'white',
      whiteElo: 1300,
      blackElo: 1300,
      playedAt: new Date('2026-03-14T10:00:00Z'),
    });
    await addGame(playerId, only, 'tournament', {
      playerColor: 'white',
      whiteElo: 1320,
      blackElo: 1300,
      playedAt: new Date('2026-03-15T10:00:00Z'),
    });

    const { body } = await series(cookie);
    expect(body.points).toHaveLength(1);
    // x falls back to the earliest dated game when the row has no range.
    expect(body.points[0]!.date).toBe('2026-03-14T10:00:00.000Z');
    expect(body.points[0]!.rating).toBe(1320);
    expect(body.points[0]!.gap).toBe(580);
  });

  test('lichess is the platform when chesscom has no rating, and gaps are null before any fetch', async () => {
    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    const playerId = await ownPlayer(owner, {
      chesscomUsername: 'onlinekid',
      lichessUsername: 'onlinekid',
    });

    const only = await addTournament(playerId, 'Spring Open', new Date('2026-03-14T09:00:00Z'));
    await addGame(playerId, only, 'tournament', {
      playerColor: 'white',
      whiteElo: 1300,
      blackElo: 1300,
      playedAt: new Date('2026-03-14T10:00:00Z'),
    });

    // No snapshot stored: platform null, gaps null, ratings still served.
    const first = await series(cookie);
    expect(first.body.platform).toBeNull();
    expect(first.body.onlineRating).toBeNull();
    expect(first.body.points[0]).toMatchObject({ rating: 1300, gap: null });

    // The fetcher has still never been called: the series never fetches.
    expect(requested).toEqual([]);

    await harness.db
      .update(player)
      .set({ lichessRating: 1850, ratingFetchedAt: new Date() })
      .where(eq(player.id, playerId));
    const second = await series(cookie);
    expect(second.body.platform).toBe('lichess');
    expect(second.body.points[0]!.gap).toBe(550);
  });

  test('a player with no tournaments gets an empty series', async () => {
    canned.chesscom = 1900;

    const cookie = await signIn(OWNER);
    const owner = await whoAmI(cookie);
    await ownPlayer(owner, {
      chesscomUsername: 'onlinekid',
      chesscomRating: 1900,
      ratingFetchedAt: new Date(),
    });

    const { res, body } = await series(cookie);
    expect(res.status).toBe(200);
    expect(body.points).toEqual([]);
    expect(body.skippedTournaments).toBe(0);
  });

  test('requires a session, then serves the signed-in player', async () => {
    const noSession = await app().request('/transfer-gap/series');
    expect(noSession.status).toBe(401);

    const cookie = await signIn(OWNER);
    await whoAmI(cookie);
    const { res } = await series(cookie);
    expect(res.status).toBe(200);
  });
});
