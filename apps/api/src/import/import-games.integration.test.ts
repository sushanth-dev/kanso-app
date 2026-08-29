import { readFileSync } from 'node:fs';
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { importGames } from './import-games.ts';
import { parsePgn } from './parse-pgn.ts';

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

async function seedPlayer(name = 'Sushanth Kamabathula'): Promise<string> {
  await harness.db
    .insert(user)
    .values([
      {
        id: OWNER,
        name,
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
    .values({ ownerUserId: OWNER, displayName: name })
    .returning({ id: player.id });
  return row!.id;
}

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

async function upload(userId: string | null, body: unknown) {
  return app(userId).request('/imports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await harness.reset();
});

describe('POST /imports (pgn_upload)', () => {
  test('imports every game in a multi-game file, tagged with the request stream', async () => {
    const playerId = await seedPlayer('Test Player');
    const res = await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('multi-game.pgn'),
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as {
      gamesFound: number;
      gamesImported: number;
      stream: string;
      gameIds: string[];
    };
    expect(job.stream).toBe('tournament');
    expect(job.gamesFound).toBe(3);
    expect(job.gamesImported).toBe(3);
    // ST-093: the batch ids let the analysing counter scope to this upload.
    expect(job.gameIds).toHaveLength(3);
    const idRows = (await harness.sql`SELECT id FROM game WHERE player_id = ${playerId}`) as Array<{
      id: string;
    }>;
    expect(job.gameIds.sort()).toEqual(idRows.map((r) => r.id).sort());

    const rows = await harness.sql`SELECT stream FROM game WHERE player_id = ${playerId}`;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.stream === 'tournament')).toBe(true);
  });

  test('stores the tournament tags, with null for what the PGN omits', async () => {
    const playerId = await seedPlayer();
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('round-board.pgn'),
    });
    const [row] = await harness.sql`
      SELECT round, board, event, eco FROM game WHERE player_id = ${playerId}`;
    expect(row!.round).toBe(3);
    expect(row!.board).toBe(32);
    expect(row!.event).toBe('Team Championship');
    expect(row!.eco).toBeNull();
  });

  test('sets has_clock_data truthfully', async () => {
    const playerId = await seedPlayer('Test Player');
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'online',
      pgn: fixture('with-clock.pgn'),
    });
    const [row] = await harness.sql`SELECT has_clock_data FROM game WHERE player_id = ${playerId}`;
    expect(row!.has_clock_data).toBe(true);
  });

  test('decides player_color by exact name match', async () => {
    const playerId = await seedPlayer('Sushanth Kamabathula');
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('clean-tournament.pgn'),
    });
    const [row] = await harness.sql`SELECT player_color FROM game WHERE player_id = ${playerId}`;
    expect(row!.player_color).toBe('white');
  });

  test('decides player_color null when the name does not match', async () => {
    const playerId = await seedPlayer('Nobody Here');
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('clean-tournament.pgn'),
    });
    const [row] = await harness.sql`SELECT player_color FROM game WHERE player_id = ${playerId}`;
    expect(row!.player_color).toBeNull();
  });

  test('rejects the whole upload when one game is malformed, storing nothing', async () => {
    const playerId = await seedPlayer('Good Game');
    const res = await upload(OWNER, {
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
    await upload(OWNER, body);
    const res = await upload(OWNER, body);
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

  test('counts the games whose side it could not decide', async () => {
    await seedPlayer('Nobody Here');
    const res = await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('multi-game.pgn'),
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as {
      gamesImported: number;
      gamesUndetermined: number;
    };
    expect(job.gamesImported).toBe(3);
    expect(job.gamesUndetermined).toBe(3);
  });

  test('counts nothing undetermined when every side was decided', async () => {
    await seedPlayer('Test Player');
    const res = await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('multi-game.pgn'),
    });
    const job = (await res.json()) as { gamesImported: number; gamesUndetermined: number };
    expect(job.gamesImported).toBe(3);
    expect(job.gamesUndetermined).toBe(0);
  });

  test('counts exactly the undetermined games in a mix of decided and undecided sides', async () => {
    await seedPlayer('Sushanth Kamabathula');
    const res = await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('mixed-sides.pgn'),
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as { gamesImported: number; gamesUndetermined: number };
    expect(job.gamesImported).toBe(3);
    expect(job.gamesUndetermined).toBe(1);
  });

  test('decides the side when the crosstable abbreviates the first name', async () => {
    const playerId = await seedPlayer('Sushanth Kamabathula');
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('abbreviated-name.pgn'),
    });
    const [row] = await harness.sql`SELECT player_color FROM game WHERE player_id = ${playerId}`;
    expect(row!.player_color).toBe('black');
  });

  test('decides the side through a title, a federation code, and a FIDE id', async () => {
    const playerId = await seedPlayer('Sushanth Kamabathula');
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('titled-name.pgn'),
    });
    const [row] = await harness.sql`SELECT player_color FROM game WHERE player_id = ${playerId}`;
    expect(row!.player_color).toBe('white');
  });

  test('imports and answers without a queue, leaving the games pending analysis', async () => {
    // No `ANALYSIS_QUEUE_URL` here, which is how the API runs locally and how
    // every other test in this file runs. Import must not depend on a queue,
    // and it must not wait on analysis either: the response is the import's,
    // and the games are left `pending` for the worker.
    const playerId = await seedPlayer('Sushanth Kamabathula');
    const res = await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('clean-tournament.pgn'),
    });

    expect(res.status).toBe(202);
    const rows = await harness.sql`
      SELECT analysis_status FROM game WHERE player_id = ${playerId}`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.analysis_status).toBe('pending');
  });

  test('creates one tournament per event and attaches its games', async () => {
    const playerId = await seedPlayer('Test Player');
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('multi-game.pgn'),
    });
    const tournaments = await harness.sql`
      SELECT id, name, key FROM tournament WHERE player_id = ${playerId}`;
    expect(tournaments).toHaveLength(1);
    expect(tournaments[0]!.name).toBe('Club Night');
    expect(tournaments[0]!.key).toBe('club night');

    const rows = await harness.sql`
      SELECT tournament_id FROM game WHERE player_id = ${playerId}`;
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.tournament_id).toBe(tournaments[0]!.id);
  });

  test('leaves an online game unattached even when its event matches a tournament', async () => {
    const playerId = await seedPlayer('Test Player');
    // A tournament first, so a tournament with the matching key exists.
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('clean-tournament.pgn'),
    });
    // Then an online game whose event matches exactly.
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'online',
      pgn: fixture('online-same-event.pgn'),
    });

    const tournaments = await harness.sql`
      SELECT id FROM tournament WHERE player_id = ${playerId}`;
    expect(tournaments).toHaveLength(1);

    const rows = await harness.sql`
      SELECT stream, tournament_id FROM game WHERE player_id = ${playerId} ORDER BY stream`;
    const online = rows.find((r) => r.stream === 'online');
    expect(online).toBeDefined();
    expect(online?.tournament_id).toBeNull();
  });

  test('re-importing the same PGN creates no second tournament', async () => {
    const playerId = await seedPlayer('Test Player');
    const body = {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('multi-game.pgn'),
    };
    await upload(OWNER, body);
    const res = await upload(OWNER, body);
    expect(res.status).toBe(202);

    const tournaments = await harness.sql`
      SELECT id FROM tournament WHERE player_id = ${playerId}`;
    expect(tournaments).toHaveLength(1);
  });

  test('puts two games at the same event a year apart in two tournaments', async () => {
    const playerId = await seedPlayer('Test Player');
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('same-event-year-apart.pgn'),
    });
    const tournaments = await harness.sql`
      SELECT id FROM tournament WHERE player_id = ${playerId}`;
    expect(tournaments).toHaveLength(2);
  });

  test('leaves a tournament-stream game with no event unattached', async () => {
    const playerId = await seedPlayer('Test Player');
    await upload(OWNER, {
      source: 'pgn_upload',
      stream: 'tournament',
      pgn: fixture('sparse-tags.pgn'),
    });
    const [row] = await harness.sql`
      SELECT tournament_id FROM game WHERE player_id = ${playerId}`;
    expect(row!.tournament_id).toBeNull();
  });

  test('returns the inserted game ids to enqueue for analysis', async () => {
    // The route enqueues whatever `importGames` reports as `queued` after the
    // commit. A freshly inserted game with moves must be in that list, or it
    // stays `pending` forever with nothing behind it. A game with no moves is
    // already `failed` and must not be queued.
    const playerId = await seedPlayer('Sushanth Kamabathula');
    const parsed = parsePgn(fixture('clean-tournament.pgn'));
    expect(parsed.ok).toBe(true);
    const games = parsed.ok ? parsed.games.map((g) => ({ ...g, externalId: null })) : [];

    const { queued } = await importGames(harness.db, {
      playerId,
      source: 'pgn_upload',
      username: null,
      stream: 'tournament',
      matchName: 'Sushanth Kamabathula',
      games,
      gamesRejected: 0,
    });

    expect(queued).toHaveLength(games.length);
    const rows = (await harness.sql`SELECT id FROM game WHERE player_id = ${playerId}`) as Array<{
      id: string;
    }>;
    expect(queued.sort()).toEqual(rows.map((r) => r.id).sort());
  });

  test('withholds colourless games from the queue instead of queuing a guaranteed failure', async () => {
    // ST-094: analysis has nobody to diagnose without a colour, so a queued
    // colourless game could only fail. It stays `pending`, and naming a side
    // on the game review page is what puts it on the queue.
    const playerId = await seedPlayer('Sushanth Kamabathula');
    const parsed = parsePgn(fixture('multi-game.pgn'));
    expect(parsed.ok).toBe(true);
    const games = parsed.ok ? parsed.games.map((g) => ({ ...g, externalId: null })) : [];
    expect(games.length).toBeGreaterThan(0);

    const { queued, gameIds } = await importGames(harness.db, {
      playerId,
      source: 'pgn_upload',
      username: null,
      stream: 'tournament',
      matchName: 'Sushanth Kamabathula',
      games,
      gamesRejected: 0,
    });

    expect(queued).toEqual([]);
    expect(gameIds).toHaveLength(games.length);
    const rows =
      (await harness.sql`SELECT analysis_status FROM game WHERE player_id = ${playerId}`) as Array<{
        analysis_status: string;
      }>;
    expect(rows.every((r) => r.analysis_status === 'pending')).toBe(true);
  });
});
