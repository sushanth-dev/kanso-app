/**
 * ST-027. The report endpoint against a real PostgreSQL: ranking, storage and
 * the regeneration rule, stream scoping, the all-refusing case, the
 * no-analysed-games 404, and a second user refused another player's report.
 *
 * The composition is unit-tested in compose.test.ts; this covers what only a
 * database proves: the stored report and weakness rows, the regeneration rule
 * over `analyzed_at`, and the claim check through the real handler.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { game, mistake, movePly, player, report, weakness } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

const sessionFor = (userId: string) => () => ({ userId });

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await harness.db.insert(user).values([
    { id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true },
    { id: OTHER, name: 'Other', email: 'other@example.com', emailVerified: true },
  ]);
});

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

async function get(userId: string | null, playerId: string, stream: string) {
  return app(userId).request(`/players/${playerId}/report?stream=${stream}`);
}

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .returning({ id: player.id });
  return row!.id;
}

let seq = 0;
/** Insert one rated game, analysed at a fixed past time by default. */
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

async function addMistake(
  gameId: string,
  fields: Partial<typeof mistake.$inferInsert> = {},
): Promise<void> {
  await harness.db.insert(mistake).values({
    gameId,
    ply: 1,
    moveNumber: 1,
    movingColor: 'white',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moveSan: 'e4',
    bestMoveSan: 'd4',
    judgement: 'mistake',
    cpLoss: 100,
    winProbDrop: 0.2,
    halfPointsLost: 1,
    crossedResultBoundary: true,
    phase: null,
    motif: null,
    ...fields,
  });
}

async function addClockMove(gameId: string, ply: number, clockMs: number): Promise<void> {
  await harness.db.insert(movePly).values({
    gameId,
    ply,
    san: 'e4',
    uci: 'e2e4',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    clockMs,
  });
}

interface WeaknessBody {
  id: string;
  kind: string;
  label: string;
  eco: string | null;
  ratingLeak: number;
  halfPointsLost: number;
  gamesAffected: number;
  occurrences: number;
  rank: number;
}

interface ReportBody {
  id: string;
  playerId: string;
  stream: string;
  generatedAt: string;
  gamesCovered: number;
  windowStart: string | null;
  windowEnd: string | null;
  timeTroubleFromMove: number | null;
  weaknesses: WeaknessBody[];
  narrative: string | null;
}

describe('GET /players/{playerId}/report', () => {
  test('returns a stored report ranked by rating leak, worst first, ranks contiguous', async () => {
    const playerId = await makePlayer(OWNER);
    const g1 = await seedRatedGame(playerId, { eco: 'B22', opening: 'Sicilian, Alapin' });
    const g2 = await seedRatedGame(playerId, { eco: 'B22', opening: 'Sicilian, Alapin' });
    const g3 = await seedRatedGame(playerId, { eco: 'B20' });
    for (let i = 0; i < 7; i++) await seedRatedGame(playerId);

    await addMistake(g1, { halfPointsLost: 1, motif: 'hanging_piece', phase: 'middlegame' });
    await addMistake(g2, { halfPointsLost: 1, phase: 'middlegame' });
    await addMistake(g3, { halfPointsLost: 1, phase: 'opening' });

    const res = await get(OWNER, playerId, 'online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;

    expect(body.stream).toBe('online');
    expect(body.gamesCovered).toBe(10);
    expect(body.narrative).toBeNull();
    expect(body.windowStart).not.toBeNull();
    expect(body.windowEnd).not.toBeNull();

    // Opening B22 (two games) survives; B20 (one game) and the one-occurrence
    // motif are withheld, and no clock data means no time trouble.
    expect(body.weaknesses.map((w) => `${w.kind}:${w.eco ?? w.label}`)).toEqual([
      'opening:B22',
      'phase:Middlegame',
      'phase:Opening',
    ]);
    expect(body.weaknesses.map((w) => w.rank)).toEqual([1, 2, 3]);

    // The evidence sits beside the figure, so a reader can check it.
    const top = body.weaknesses[0]!;
    expect(top).toMatchObject({
      kind: 'opening',
      label: 'Sicilian, Alapin',
      eco: 'B22',
      gamesAffected: 2,
      occurrences: 2,
    });
    expect(top.halfPointsLost).toBeCloseTo(2);
    expect(top.ratingLeak).toBeGreaterThan(0);

    // Stored, not computed per request.
    const [stored] = await harness.db.select().from(report).where(eq(report.playerId, playerId));
    expect(stored).toBeDefined();
    expect(stored!.gamesCovered).toBe(10);
    const ws = await harness.db.select().from(weakness).where(eq(weakness.reportId, stored!.id));
    expect(ws).toHaveLength(3);
  });

  test('reuses the stored report when analysis has not moved, regenerates when it has', async () => {
    const playerId = await makePlayer(OWNER);
    const games: string[] = [];
    for (let i = 0; i < 10; i++) games.push(await seedRatedGame(playerId));
    await addMistake(games[0]!, { halfPointsLost: 1, phase: 'middlegame' });

    const first = await get(OWNER, playerId, 'online');
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ReportBody;
    expect(firstBody.weaknesses.map((w) => w.kind)).toContain('phase');

    // No new analysis: the same stored report is served, same id.
    const again = await get(OWNER, playerId, 'online');
    const againBody = (await again.json()) as ReportBody;
    expect(againBody.id).toBe(firstBody.id);

    // A game analysed after the report was generated moves the report. The
    // future `analyzed_at` is the test's way of saying "after `generated_at`",
    // which `defaultNow()` sets to the real clock.
    const late = await seedRatedGame(playerId, {
      eco: 'B99',
      analyzedAt: new Date(Date.now() + 3_600_000),
    });
    await addMistake(late, { halfPointsLost: 1, phase: 'middlegame' });

    const third = await get(OWNER, playerId, 'online');
    const thirdBody = (await third.json()) as ReportBody;
    expect(thirdBody.id).not.toBe(firstBody.id);
    expect(thirdBody.gamesCovered).toBe(11);
  });

  test('never blends streams, and time trouble is null on a tournament report', async () => {
    const playerId = await makePlayer(OWNER);
    for (let i = 0; i < 10; i++) {
      const id = await seedRatedGame(playerId, { stream: 'online', eco: 'B22' });
      await addMistake(id, { halfPointsLost: 1, phase: 'middlegame' });
    }
    for (let i = 0; i < 10; i++) {
      const id = await seedRatedGame(playerId, { stream: 'tournament', eco: 'B20' });
      await addMistake(id, { halfPointsLost: 1, phase: 'opening' });
    }

    const online = (await (await get(OWNER, playerId, 'online')).json()) as ReportBody;
    const tournament = (await (await get(OWNER, playerId, 'tournament')).json()) as ReportBody;

    expect(online.weaknesses.map((w) => w.eco)).toContain('B22');
    expect(online.weaknesses.map((w) => w.eco)).not.toContain('B20');
    expect(tournament.weaknesses.map((w) => w.eco)).toContain('B20');
    expect(tournament.weaknesses.map((w) => w.eco)).not.toContain('B22');

    // F6: time trouble is online-only; null on a tournament report by design.
    expect(online.timeTroubleFromMove).toBeNull(); // no clock data on these games
    expect(tournament.timeTroubleFromMove).toBeNull();
  });

  test('timeTroubleFromMove is populated on an online report with clock data', async () => {
    const playerId = await makePlayer(OWNER);
    const clocked: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = await seedRatedGame(playerId);
      if (i < 3) clocked.push(id);
    }
    for (const id of clocked) {
      await harness.db.update(game).set({ hasClockData: true }).where(eq(game.id, id));
      for (let ply = 1; ply <= 7; ply += 2) await addClockMove(id, ply, 20_000);
      await addMistake(id, { halfPointsLost: 1, phase: 'middlegame' });
    }

    const res = await get(OWNER, playerId, 'online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;

    // The earliest move under the threshold is ply 1, so the full move is 1.
    expect(body.timeTroubleFromMove).toBe(1);
    expect(body.weaknesses.some((w) => w.kind === 'time_trouble')).toBe(true);
  });

  test('a report with no defensible weakness is a valid 200, empty', async () => {
    const playerId = await makePlayer(OWNER);
    // Ten rated games, every mistake without a result-boundary crossing.
    for (let i = 0; i < 10; i++) {
      const id = await seedRatedGame(playerId);
      await addMistake(id, {
        halfPointsLost: 0,
        crossedResultBoundary: false,
        phase: 'middlegame',
      });
    }

    const res = await get(OWNER, playerId, 'online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    expect(body.gamesCovered).toBe(10);
    expect(body.weaknesses).toEqual([]);
  });

  test('a player with too few rated games gets the 404', async () => {
    const playerId = await makePlayer(OWNER);
    for (let i = 0; i < 9; i++) await seedRatedGame(playerId);

    const res = await get(OWNER, playerId, 'online');
    expect(res.status).toBe(404);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'not_found' });
  });

  test('a second user with no claim answers 403', async () => {
    const playerId = await makePlayer(OWNER);
    for (let i = 0; i < 10; i++) await seedRatedGame(playerId);

    const res = await get(OTHER, playerId, 'online');
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'forbidden' });
  });
});
