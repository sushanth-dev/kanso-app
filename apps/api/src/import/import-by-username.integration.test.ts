/**
 * ST-023. Importing games by username, end to end against a real PostgreSQL,
 * with the provider fetch stubbed behind the `gameFetcher` seam.
 *
 * The fake returns captured-response-shaped games, so the parse, validate, and
 * store path is exercised for real while no outbound call is made. The unit
 * tests cover the fetch modules; this file covers what happens to the games
 * once they are in the door.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app.ts';
import { player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { GameFetcher } from './game-fetcher.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

const sessionFor = (userId: string) => () => ({ userId });

const gameFetcher = {
  chesscom: vi.fn<GameFetcher['chesscom']>(),
  lichess: vi.fn<GameFetcher['lichess']>(),
};

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  gameFetcher.chesscom.mockReset();
  gameFetcher.lichess.mockReset();
});

async function seedPlayer(displayName = 'Sushanth Kamabathula'): Promise<string> {
  await harness.db
    .insert(user)
    .values([
      { id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true },
      { id: OTHER, name: 'Other', email: 'other@example.com', emailVerified: true },
    ])
    .onConflictDoNothing();
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: OWNER, displayName })
    .returning({ id: player.id });
  return row!.id;
}

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
    gameFetcher,
  });
}

async function importByUsername(userId: string | null, playerId: string, body: unknown) {
  return app(userId).request(`/players/${playerId}/imports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A single online game whose `[White]` is the username, so the side resolves. */
function onlineGame(externalId: string, username: string) {
  return {
    externalId,
    pgn: `[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2026.08.01"]\n[White "${username}"]\n[Black "opponent"]\n[Result "1-0"]\n[TimeControl "180"]\n\n1. e4 {[%clk 0:03:00]} e5 {[%clk 0:02:59]} 2. Nf3 {[%clk 0:02:58]}`,
  };
}

/** A game with an illegal move, so the parse boundary rejects it. */
const malformedGame = {
  externalId: 'bad-game',
  pgn: '[Event "Broken"]\n[Site "Chess.com"]\n[White "onlinekid"]\n[Black "opponent"]\n[Result "*"]\n\n1. e4 e9',
};

describe('POST /players/{playerId}/imports (username)', () => {
  test('imports chesscom games as online, tagged with source and external id', async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.chesscom.mockResolvedValue({
      ok: true,
      games: [onlineGame('172385979790', 'onlinekid')],
    });

    const res = await importByUsername(OWNER, playerId, {
      source: 'chesscom',
      username: 'onlinekid',
      stream: 'online',
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as {
      source: string;
      stream: string;
      gamesFound: number;
      gamesImported: number;
    };
    expect(job.source).toBe('chesscom');
    expect(job.stream).toBe('online');
    expect(job.gamesFound).toBe(1);
    expect(job.gamesImported).toBe(1);

    const rows = await harness.sql`
      SELECT source, stream, external_id, has_clock_data, player_color FROM game WHERE player_id = ${playerId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('chesscom');
    expect(rows[0]!.stream).toBe('online');
    expect(rows[0]!.external_id).toBe('172385979790');
    expect(rows[0]!.has_clock_data).toBe(true);
    expect(rows[0]!.player_color).toBe('white');

    const jobs = await harness.sql`SELECT username FROM import_job WHERE player_id = ${playerId}`;
    expect(jobs[0]!.username).toBe('onlinekid');
  });

  test('imports lichess games the same way', async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.lichess.mockResolvedValue({
      ok: true,
      games: [onlineGame('kAdOQKeh', 'onlinekid')],
    });

    const res = await importByUsername(OWNER, playerId, {
      source: 'lichess',
      username: 'onlinekid',
      stream: 'online',
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as { source: string; gamesImported: number };
    expect(job.source).toBe('lichess');
    expect(job.gamesImported).toBe(1);

    const [row] =
      await harness.sql`SELECT source, external_id FROM game WHERE player_id = ${playerId}`;
    expect(row!.source).toBe('lichess');
    expect(row!.external_id).toBe('kAdOQKeh');
  });

  test('re-importing the same period reports zero new games without duplicating', async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.chesscom.mockResolvedValue({
      ok: true,
      games: [onlineGame('172385979790', 'onlinekid')],
    });
    const body = { source: 'chesscom', username: 'onlinekid', stream: 'online' };

    await importByUsername(OWNER, playerId, body);
    const res = await importByUsername(OWNER, playerId, body);
    expect(res.status).toBe(202);
    const job = (await res.json()) as { gamesFound: number; gamesImported: number };
    expect(job.gamesFound).toBe(1);
    expect(job.gamesImported).toBe(0);

    const rows = await harness.sql`SELECT id FROM game WHERE player_id = ${playerId}`;
    expect(rows).toHaveLength(1);
  });

  test('rejects one malformed game and keeps the rest', async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.chesscom.mockResolvedValue({
      ok: true,
      games: [onlineGame('good-game', 'onlinekid'), malformedGame],
    });

    const res = await importByUsername(OWNER, playerId, {
      source: 'chesscom',
      username: 'onlinekid',
      stream: 'online',
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as {
      gamesFound: number;
      gamesImported: number;
      gamesRejected: number;
    };
    expect(job.gamesFound).toBe(2);
    expect(job.gamesImported).toBe(1);
    expect(job.gamesRejected).toBe(1);

    const rows = await harness.sql`SELECT external_id FROM game WHERE player_id = ${playerId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.external_id).toBe('good-game');
  });

  test('answers 422 when the username does not resolve', async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.chesscom.mockResolvedValue({ ok: false, code: 'username_not_found' });

    const res = await importByUsername(OWNER, playerId, {
      source: 'chesscom',
      username: 'no_such_account',
      stream: 'online',
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'username_not_found' });
  });

  test('answers 502 when the provider is unreachable', async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.lichess.mockResolvedValue({ ok: false, code: 'upstream_error' });

    const res = await importByUsername(OWNER, playerId, {
      source: 'lichess',
      username: 'onlinekid',
      stream: 'online',
    });
    expect(res.status).toBe(502);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'upstream_error' });
  });

  test('answers 202 with zero found for a resolving username with no games in the period', async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.chesscom.mockResolvedValue({ ok: true, games: [] });

    const res = await importByUsername(OWNER, playerId, {
      source: 'chesscom',
      username: 'onlinekid',
      stream: 'online',
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as { gamesFound: number; gamesImported: number };
    expect(job.gamesFound).toBe(0);
    expect(job.gamesImported).toBe(0);
  });

  test('threads the explicit since to the fetcher', async () => {
    const playerId = await seedPlayer();
    gameFetcher.lichess.mockResolvedValue({ ok: true, games: [] });

    await importByUsername(OWNER, playerId, {
      source: 'lichess',
      username: 'onlinekid',
      stream: 'online',
      since: '2025-01-01',
    });
    expect(gameFetcher.lichess).toHaveBeenCalledWith('onlinekid', new Date('2025-01-01'), 20);
  });

  test('answers 429 once the daily online cap is reached', async () => {
    const playerId = await seedPlayer('Test Player');
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      externalId: `g${i}`,
      pgn: `[Event "Live Chess"]\n[Site "https://lichess.org/g${i}"]\n[Date "2026.08.01"]\n[White "onlinekid"]\n[Black "opponent"]\n[Result "1-0"]\n[TimeControl "180"]\n\n1. e4 {[%clk 0:03:00]} e5 {[%clk 0:02:59]} 2. Nf3 {[%clk 0:02:58]}`,
    }));
    gameFetcher.lichess.mockResolvedValue({ ok: true, games: twenty });

    const first = await importByUsername(OWNER, playerId, {
      source: 'lichess',
      username: 'onlinekid',
      stream: 'online',
    });
    expect(first.status).toBe(202);

    const second = await importByUsername(OWNER, playerId, {
      source: 'lichess',
      username: 'onlinekid',
      stream: 'online',
    });
    expect(second.status).toBe(429);
    expect((await second.json()) as { code: string }).toMatchObject({ code: 'daily_import_cap' });
    expect(gameFetcher.lichess).toHaveBeenCalledTimes(1);
  });

  test("bounds the fetch to the day's remaining allowance", async () => {
    const playerId = await seedPlayer('Test Player');
    gameFetcher.lichess.mockResolvedValue({ ok: true, games: [onlineGame('g0', 'onlinekid')] });
    await importByUsername(OWNER, playerId, {
      source: 'lichess',
      username: 'onlinekid',
      stream: 'online',
    });

    gameFetcher.lichess.mockResolvedValue({ ok: true, games: [] });
    await importByUsername(OWNER, playerId, {
      source: 'lichess',
      username: 'onlinekid',
      stream: 'online',
    });

    expect(gameFetcher.lichess).toHaveBeenLastCalledWith('onlinekid', expect.any(Date), 19);
  });

  test('answers 403 when the session has no claim', async () => {
    const playerId = await seedPlayer('Test Player');
    const res = await importByUsername(OTHER, playerId, {
      source: 'chesscom',
      username: 'onlinekid',
      stream: 'online',
    });
    expect(res.status).toBe(403);
    expect(gameFetcher.chesscom).not.toHaveBeenCalled();
  });
});
