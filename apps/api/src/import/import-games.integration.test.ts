import { readFileSync } from 'node:fs';
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

/** A session for a given user id; presence and identity, nothing more. */
const sessionFor = (userId: string) => () => ({ userId });

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

async function seedPlayer(displayName = 'Sushanth Kamabathula'): Promise<string> {
  await harness.db
    .insert(user)
    .values([
      {
        id: OWNER,
        name: 'Owner',
        email: 'owner@example.com',
        emailVerified: true,
      },
      {
        id: OTHER,
        name: 'Other',
        email: 'other@example.com',
        emailVerified: true,
      },
    ])
    .onConflictDoNothing();
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: OWNER, displayName })
    .returning({ id: player.id });
  return row.id;
}

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

async function upload(userId: string | null, playerId: string, body: unknown) {
  return app(userId).request(`/players/${playerId}/imports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await harness.reset();
});

describe('POST /players/{playerId}/imports (pgn_upload)', () => {
  test('imports every game in a multi-game file, tagged with the request stream', async () => {
    const playerId = await seedPlayer('Test Player');
    const res = await upload(OWNER, playerId, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('multi-game.pgn'),
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as {
      gamesFound: number;
      gamesImported: number;
      stream: string;
    };
    expect(job.stream).toBe('tournament');
    expect(job.gamesFound).toBe(3);
    expect(job.gamesImported).toBe(3);

    const rows = await harness.sql`SELECT stream FROM game WHERE player_id = ${playerId}`;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.stream === 'tournament')).toBe(true);
  });

  test('stores the tournament tags, with null for what the PGN omits', async () => {
    const playerId = await seedPlayer();
    await upload(OWNER, playerId, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('round-board.pgn'),
    });
    const [row] = await harness.sql`
      SELECT round, board, event, eco FROM game WHERE player_id = ${playerId}`;
    expect(row.round).toBe(3);
    expect(row.board).toBe(32);
    expect(row.event).toBe('Team Championship');
    expect(row.eco).toBeNull();
  });

  test('sets has_clock_data truthfully', async () => {
    const playerId = await seedPlayer('Test Player');
    await upload(OWNER, playerId, {
      source: 'pgn_upload',
      stream: 'online',
      pgn: fixture('with-clock.pgn'),
    });
    const [row] = await harness.sql`SELECT has_clock_data FROM game WHERE player_id = ${playerId}`;
    expect(row.has_clock_data).toBe(true);
  });

  test('decides player_color by exact name match, null when it cannot', async () => {
    const playerId = await seedPlayer('Sushanth Kamabathula');
    await upload(OWNER, playerId, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('clean-tournament.pgn'),
    });
    const [row] = await harness.sql`SELECT player_color FROM game WHERE player_id = ${playerId}`;
    expect(row.player_color).toBe('white');

    const otherId = await seedPlayer('Nobody Here');
    await upload(OWNER, otherId, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('clean-tournament.pgn'),
    });
    const [row2] = await harness.sql`SELECT player_color FROM game WHERE player_id = ${otherId}`;
    expect(row2.player_color).toBeNull();
  });

  test('rejects the whole upload when one game is malformed, storing nothing', async () => {
    const playerId = await seedPlayer('Good Game');
    const res = await upload(OWNER, playerId, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('one-malformed.pgn'),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues?: { path: string }[] };
    expect(JSON.stringify(body)).toMatch(/game 2/);
    const rows = await harness.sql`SELECT id FROM game WHERE player_id = ${playerId}`;
    expect(rows).toHaveLength(0);
    const jobs = await harness.sql`SELECT id FROM import_job WHERE player_id = ${playerId}`;
    expect(jobs).toHaveLength(0);
  });

  test('re-uploading the same PGN does not duplicate games', async () => {
    const playerId = await seedPlayer('Test Player');
    const body = {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('multi-game.pgn'),
    };
    await upload(OWNER, playerId, body);
    const res = await upload(OWNER, playerId, body);
    expect(res.status).toBe(202);
    const job = (await res.json()) as {
      gamesFound: number;
      gamesImported: number;
    };
    expect(job.gamesFound).toBe(3);
    expect(job.gamesImported).toBe(0);
    const rows = await harness.sql`SELECT id FROM game WHERE player_id = ${playerId}`;
    expect(rows).toHaveLength(3);
  });

  test('answers 404 for a player that does not exist', async () => {
    const res = await upload(OWNER, '00000000-0000-4000-8000-000000000000', {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('clean-tournament.pgn'),
    });
    expect(res.status).toBe(404);
  });

  test('answers 403 for a player the session has no claim on', async () => {
    const playerId = await seedPlayer();
    const res = await upload(OTHER, playerId, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('clean-tournament.pgn'),
    });
    expect(res.status).toBe(403);
  });

  test('answers 501 for a username source', async () => {
    const playerId = await seedPlayer();
    const res = await upload(OWNER, playerId, {
      source: 'chesscom',
      stream: 'online',
      username: 'someone',
    });
    expect(res.status).toBe(501);
  });
});
