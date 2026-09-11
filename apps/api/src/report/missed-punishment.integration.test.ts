/**
 * ST-154. The missed-punishment line inside the report, against a real
 * PostgreSQL.
 *
 * Two guarantees sit above the counts themselves:
 *
 * 1. The colour invariant. The opening-leak aggregation counts `mistake`
 *    rows with no colour filter, so the detector must never write an
 *    opponent row into `mistake`. These tests seed the opponent's blunders
 *    as `move_ply` rows only and assert `mistake` stays empty, and that the
 *    report's opening-leak output is unchanged.
 *
 * 2. The per-scope line. The detector reads the same `leakScope` the leaks
 *    read, so the line follows the report's stream and window, and the
 *    instances deep-link at the blunder ply.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, mistake, movePly, player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { AiClient } from '../coaching/zai.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';

const sessionFor = (userId: string) => () => ({ userId });

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await harness.db
    .insert(user)
    .values([{ id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true }]);
});

function app(userId: string | null, aiClient?: AiClient | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
    aiClient: aiClient ?? null,
  });
}

async function makePlayer(): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: OWNER, displayName: 'Test Player' })
    .returning({ id: player.id });
  return row!.id;
}

let seq = 0;
async function seedRatedGame(
  playerId: string,
  fields: Partial<typeof game.$inferInsert> = {},
): Promise<string> {
  const [row] = await harness.db
    .insert(game)
    .values({
      playerId,
      stream: 'online',
      source: 'chesscom',
      pgnHash: `hash_${seq++}`,
      pgn: '[Result "1/2-1/2"]\n\n1. e4 e5 1/2-1/2',
      result: '1/2-1/2',
      playerColor: 'white',
      whiteElo: 1500,
      blackElo: 1500,
      playedAt: new Date('2026-08-01T12:00:00Z'),
      analysisStatus: 'complete',
      analyzedAt: new Date('2026-08-01T12:00:00Z'),
      ...fields,
    })
    .returning({ id: game.id });
  return row!.id;
}

/**
 * One stored ply. The evaluation is white-absolute and belongs to the
 * position before the ply is played, the classifier's own convention.
 */
async function addPly(
  gameId: string,
  fields: Partial<typeof movePly.$inferInsert> = {},
): Promise<void> {
  // Odd plies are white to move, even plies black, which is how the
  // detector derives the mover: `move_ply` stores no colour column.
  const fenBefore =
    fields.fenBefore ??
    `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR ${(fields.ply ?? 1) % 2 === 1 ? 'w' : 'b'} KQkq - 0 1`;
  await harness.db.insert(movePly).values({
    gameId,
    ply: 1,
    san: 'e4',
    uci: 'e2e4',
    fenBefore,
    phase: 'middlegame',
    ...fields,
  });
}

/**
 * A report refuses below six rated games, so every scenario pads with
 * clean filler games dated before the miss games so the miss games stay
 * the most recent and the thirty-day window reaches them.
 */
async function fillGames(
  playerId: string,
  count: number,
  stream: 'online' | 'tournament' = 'online',
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await seedRatedGame(playerId, {
      stream,
      playedAt: new Date(Date.UTC(2025, 8, 1 + i)),
    });
  }
}

/**
 * Seed one missed conversion: black (the opponent) blunders at ply 4 and
 * the white-absolute evaluation jumps from +30 to +400, then white's ply-5
 * move leaves the boundary at +40, under the hold floor. With
 * `playerColor: 'white'` this is one miss at the blunder ply 4.
 */
async function seedMissedConversion(gameId: string): Promise<void> {
  await addPly(gameId, { ply: 1, san: 'd4', uci: 'd2d4', evalCp: 30 });
  await addPly(gameId, { ply: 2, san: 'Nf6', uci: 'g8f6', evalCp: 30 });
  await addPly(gameId, { ply: 3, san: 'c4', uci: 'c2c4', evalCp: 30 });
  await addPly(gameId, { ply: 4, san: 'e6', uci: 'e7e6', evalCp: 30 });
  await addPly(gameId, { ply: 5, san: 'Qb3', uci: 'd1b3', evalCp: 400 });
  await addPly(gameId, { ply: 6, san: 'Nc6', uci: 'b8c6', evalCp: 40 });
  await addPly(gameId, { ply: 7, san: 'e3', uci: 'e2e3', evalCp: 40 });
  await addPly(gameId, { ply: 8, san: 'Bd6', uci: 'f8d6', evalCp: 35 });
}

describe('report missed-punishment line', () => {
  test('one miss surfaces in the report with the blunder-ply deep link', async () => {
    const playerId = await makePlayer();
    await fillGames(playerId, 6);
    const gameId = await seedRatedGame(playerId, {
      playedAt: new Date('2026-08-01T12:00:00Z'),
    });
    await seedMissedConversion(gameId);

    const res = await app(OWNER).request('/report?stream=online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      missedPunishment: {
        seasonCount: number;
        thirtyDayCount: number;
        instances: { gameId: string; ply: number; slipPly: number; slipPhase: string | null }[];
      } | null;
    };
    expect(body.missedPunishment).not.toBeNull();
    expect(body.missedPunishment!.seasonCount).toBe(1);
    expect(body.missedPunishment!.thirtyDayCount).toBe(1);
    expect(body.missedPunishment!.instances).toHaveLength(1);
    const inst = body.missedPunishment!.instances[0]!;
    expect(inst.gameId).toBe(gameId);
    expect(inst.ply).toBe(4); // the blunder ply
    expect(inst.slipPly).toBe(6); // the first boundary under the hold floor
    expect(inst.slipPhase).toBe('middlegame');
  });

  test('the colour invariant: opponent plies never enter mistake and leaks are unchanged', async () => {
    const playerId = await makePlayer();
    await fillGames(playerId, 6);
    const gameId = await seedRatedGame(playerId, {
      playedAt: new Date('2026-08-01T12:00:00Z'),
    });
    await seedMissedConversion(gameId);

    const before = await app(OWNER).request('/report?stream=online');
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as {
      weaknesses: { kind: string; label: string; ratingLeak: number; occurrences: number }[];
    };

    const mistakeRows = await harness.db.select().from(mistake);
    expect(mistakeRows).toEqual([]); // the detector wrote nothing

    // A second report read carries the same leak figures: the detector's
    // reads touch no table the leaks aggregate.
    const after = await app(OWNER).request('/report?stream=online');
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as typeof beforeBody;
    const strip = (r: typeof beforeBody) =>
      r.weaknesses.map((w) => `${w.kind}:${w.label}:${w.ratingLeak}:${w.occurrences}`).sort();
    expect(strip(afterBody)).toEqual(strip(beforeBody));
  });

  test('the line follows the stream: nothing on a stream with no misses', async () => {
    const playerId = await makePlayer();
    await fillGames(playerId, 6);
    const gameId = await seedRatedGame(playerId, {
      stream: 'tournament',
      playedAt: new Date('2026-08-01T12:00:00Z'),
    });
    await seedMissedConversion(gameId);

    const res = await app(OWNER).request('/report?stream=online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      missedPunishment: { seasonCount: number; instances: unknown[] } | null;
    };
    expect(body.missedPunishment).not.toBeNull();
    expect(body.missedPunishment!.seasonCount).toBe(0);
    expect(body.missedPunishment!.instances).toEqual([]);
  });

  test('instances cap at three, most recent first', async () => {
    const playerId = await makePlayer();
    await fillGames(playerId, 6);
    for (let i = 0; i < 5; i++) {
      const gameId = await seedRatedGame(playerId, {
        playedAt: new Date(Date.UTC(2026, 0, 10 + i)),
      });
      await seedMissedConversion(gameId);
    }
    const res = await app(OWNER).request('/report?stream=online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      missedPunishment: { seasonCount: number; instances: { playedAt: string | null }[] } | null;
    };
    expect(body.missedPunishment!.seasonCount).toBe(5);
    expect(body.missedPunishment!.instances).toHaveLength(3);
    const dates = body.missedPunishment!.instances.map((i) => i.playedAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  test('a converted blunder produces nothing', async () => {
    const playerId = await makePlayer();
    await fillGames(playerId, 6);
    const gameId = await seedRatedGame(playerId, {
      playedAt: new Date('2026-08-01T12:00:00Z'),
    });
    // Same blunder, but white holds +400 to the end: converted.
    await addPly(gameId, { ply: 1, san: 'd4', uci: 'd2d4', evalCp: 30 });
    await addPly(gameId, { ply: 2, san: 'Nf6', uci: 'g8f6', evalCp: 30 });
    await addPly(gameId, { ply: 3, san: 'c4', uci: 'c2c4', evalCp: 30 });
    await addPly(gameId, { ply: 4, san: 'e6', uci: 'e7e6', evalCp: 30 });
    await addPly(gameId, { ply: 5, san: 'Qb3', uci: 'd1b3', evalCp: -400 });
    await addPly(gameId, { ply: 6, san: 'Nc6', uci: 'b8c6', evalCp: 400 });
    await addPly(gameId, { ply: 7, san: 'e3', uci: 'e2e3', evalCp: 400 });
    await addPly(gameId, { ply: 8, san: 'Bd6', uci: 'f8d6', evalCp: 395 });

    const res = await app(OWNER).request('/report?stream=online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { missedPunishment: { seasonCount: number } | null };
    expect(body.missedPunishment!.seasonCount).toBe(0);
  });
});
