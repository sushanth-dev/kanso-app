/**
 * ST-027. The report endpoint against a real PostgreSQL: ranking, storage and
 * the regeneration rule, stream scoping, the all-refusing case, and the
 * no-analysed-games 404.
 *
 * The composition is unit-tested in compose.test.ts; this covers what only a
 * database proves: the stored report and weakness rows, the regeneration rule
 * over `analyzed_at`, and the player resolved from the session.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { game, mistake, movePly, player, report, tournament, weakness } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

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

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

async function get(userId: string | null, stream: string, tournamentId?: string) {
  const query = tournamentId === undefined ? '' : `&tournamentId=${tournamentId}`;
  return app(userId).request(`/report?stream=${stream}${query}`);
}

/** ST-098. One tournament row for scoped-report tests. */
async function seedTournament(playerId: string, name: string): Promise<string> {
  const [row] = await harness.db
    .insert(tournament)
    .values({ playerId, name, key: name.toLowerCase() })
    .returning({ id: tournament.id });
  return row!.id;
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
  /** ST-098. The advice line and the places behind the figure. */
  advice: string | null;
  evidence: {
    gameId: string;
    whiteName: string | null;
    blackName: string | null;
    playedAt: string | null;
    moveNumber: number;
    moveSan: string;
    bestMoveSan: string;
    phase: string | null;
    judgement: string;
    cpLoss: number;
  }[];
}

interface ReportBody {
  id: string;
  playerId: string;
  stream: string;
  /** ST-098. Set on a tournament-scoped report; null on a stream report. */
  tournamentId: string | null;
  generatedAt: string;
  gamesCovered: number;
  windowStart: string | null;
  windowEnd: string | null;
  timeTroubleFromMove: number | null;
  timeTroubleReason: 'no_clock_data' | 'not_enough_evidence' | null;
  weaknesses: WeaknessBody[];
  narrative: string | null;
}

describe('GET /report', () => {
  test('returns a stored report ranked by rating leak, worst first, ranks contiguous', async () => {
    const playerId = await makePlayer(OWNER);
    const g1 = await seedRatedGame(playerId, { eco: 'B22', opening: 'Sicilian, Alapin' });
    const g2 = await seedRatedGame(playerId, { eco: 'B22', opening: 'Sicilian, Alapin' });
    const g3 = await seedRatedGame(playerId, { eco: 'B20' });
    for (let i = 0; i < 7; i++) await seedRatedGame(playerId);

    await addMistake(g1, { halfPointsLost: 1, motif: 'hanging_piece', phase: 'middlegame' });
    await addMistake(g2, { halfPointsLost: 1, phase: 'middlegame' });
    await addMistake(g3, { halfPointsLost: 1, phase: 'opening' });

    const res = await get(OWNER, 'online');
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

    const first = await get(OWNER, 'online');
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ReportBody;
    expect(firstBody.weaknesses.map((w) => w.kind)).toContain('phase');

    // No new analysis: the same stored report is served, same id.
    const again = await get(OWNER, 'online');
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

    const third = await get(OWNER, 'online');
    const thirdBody = (await third.json()) as ReportBody;
    expect(thirdBody.id).not.toBe(firstBody.id);
    expect(thirdBody.gamesCovered).toBe(11);
  });

  test('never blends streams, and time trouble is null without clock data', async () => {
    const playerId = await makePlayer(OWNER);
    for (let i = 0; i < 10; i++) {
      const id = await seedRatedGame(playerId, { stream: 'online', eco: 'B22' });
      await addMistake(id, { halfPointsLost: 1, phase: 'middlegame' });
    }
    for (let i = 0; i < 10; i++) {
      const id = await seedRatedGame(playerId, { stream: 'tournament', eco: 'B20' });
      await addMistake(id, { halfPointsLost: 1, phase: 'opening' });
    }

    const online = (await (await get(OWNER, 'online')).json()) as ReportBody;
    const tournament = (await (await get(OWNER, 'tournament')).json()) as ReportBody;

    expect(online.weaknesses.map((w) => w.eco)).toContain('B22');
    expect(online.weaknesses.map((w) => w.eco)).not.toContain('B20');
    expect(tournament.weaknesses.map((w) => w.eco)).toContain('B20');
    expect(tournament.weaknesses.map((w) => w.eco)).not.toContain('B22');

    // F6: no clock data in either stream, so no time trouble on either report.
    expect(online.timeTroubleFromMove).toBeNull(); // no clock data on these games
    expect(online.timeTroubleReason).toBe('no_clock_data');
    expect(tournament.timeTroubleFromMove).toBeNull();
    expect(tournament.timeTroubleReason).toBe('no_clock_data');
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

    const res = await get(OWNER, 'online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;

    // The earliest move under the threshold is ply 1, so the full move is 1.
    expect(body.timeTroubleFromMove).toBe(1);
    expect(body.timeTroubleReason).toBeNull();
    expect(body.weaknesses.some((w) => w.kind === 'time_trouble')).toBe(true);
  });

  test('timeTroubleFromMove is populated on a tournament report with clock data', async () => {
    const playerId = await makePlayer(OWNER);
    const clocked: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = await seedRatedGame(playerId, { stream: 'tournament' });
      if (i < 3) clocked.push(id);
    }
    for (const id of clocked) {
      await harness.db.update(game).set({ hasClockData: true }).where(eq(game.id, id));
      for (let ply = 1; ply <= 7; ply += 2) await addClockMove(id, ply, 20_000);
      await addMistake(id, { halfPointsLost: 1, phase: 'middlegame' });
    }

    const res = await get(OWNER, 'tournament');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;

    // The earliest move under the threshold is ply 1, so the full move is 1.
    expect(body.timeTroubleFromMove).toBe(1);
    expect(body.timeTroubleReason).toBeNull();
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

    const res = await get(OWNER, 'online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    expect(body.gamesCovered).toBe(10);
    expect(body.weaknesses).toEqual([]);
  });

  test('a player with analysed but too few rated games answers 422 with the count', async () => {
    // ST-095: this state used to share the zero-games 404, and the web told a
    // player with analysed games to go import games they already had.
    // ST-096: the floor is six, so the fixture sits at five, one under it.
    const playerId = await makePlayer(OWNER);
    for (let i = 0; i < 5; i++) await seedRatedGame(playerId);

    const res = await get(OWNER, 'online');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; message: string };
    expect(body).toMatchObject({ code: 'not_enough_evidence' });
    expect(body.message).toContain('All 5 analyzed games in this stream count');
    expect(body.message).toContain('needs 6 rated games in the last year');
  });

  test('a mixed history answers 422 with the qualifying subset', async () => {
    // ST-097: the two sixes are different sets. Five rated games plus one
    // whose opponent has no Elo must say five of six, not one bare count.
    const playerId = await makePlayer(OWNER);
    for (let g = 0; g < 5; g++) await seedRatedGame(playerId);
    await seedRatedGame(playerId, { blackElo: null });

    const res = await get(OWNER, 'online');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.message).toContain('Only 5 of the 6 analyzed games in this stream count');
    expect(body.message).toContain('a decided result, a date, and both players');
  });

  test('analysed games that all fail the rated bar say so', async () => {
    const playerId = await makePlayer(OWNER);
    for (let g = 0; g < 2; g++) {
      await seedRatedGame(playerId, { result: '*', blackElo: null });
    }

    const res = await get(OWNER, 'online');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.message).toContain('None of the 2 analyzed games in this stream count');
  });

  test('a player with no analysed games keeps the 404', async () => {
    const playerId = await makePlayer(OWNER);
    await seedRatedGame(playerId, { analysisStatus: 'pending', analyzedAt: null });

    const res = await get(OWNER, 'online');
    expect(res.status).toBe(404);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'not_found' });
  });
});

describe('GET /report?tournamentId (ST-098)', () => {
  test('stores and serves a report scoped to one tournament, with evidence and advice', async () => {
    const playerId = await makePlayer(OWNER);
    const big = await seedTournament(playerId, 'City Open');
    const small = await seedTournament(playerId, 'Winter Rapid');

    const cityGames: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = await seedRatedGame(playerId, { stream: 'tournament', tournamentId: big });
      cityGames.push(id);
    }
    for (let i = 0; i < 2; i++) {
      await seedRatedGame(playerId, { stream: 'tournament', tournamentId: small });
    }
    for (const id of cityGames) {
      await addMistake(id, {
        halfPointsLost: 1,
        motif: 'hanging_piece',
        phase: 'middlegame',
        moveNumber: 23,
        moveSan: 'Nf6',
        bestMoveSan: 'e5',
        cpLoss: 240,
      });
    }

    const res = await get(OWNER, 'tournament', big);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    expect(body.tournamentId).toBe(big);
    expect(body.gamesCovered).toBe(6);
    expect(body.weaknesses.map((w) => w.kind)).toContain('motif');

    const motif = body.weaknesses.find((w) => w.kind === 'motif')!;
    expect(motif.advice).toContain('undefended');
    expect(motif.evidence).toHaveLength(3);
    expect(motif.evidence[0]).toMatchObject({
      moveNumber: 23,
      moveSan: 'Nf6',
      bestMoveSan: 'e5',
      cpLoss: 240,
      judgement: 'mistake',
      phase: 'middlegame',
    });
    expect(motif.evidence.every((e) => cityGames.includes(e.gameId))).toBe(true);

    // The stream-wide report is a different scope, and stays null-scoped.
    const stream = await get(OWNER, 'tournament');
    const streamBody = (await stream.json()) as ReportBody;
    expect(streamBody.tournamentId).toBeNull();
    expect(streamBody.gamesCovered).toBe(8);
  });

  test('a tournament under the floor answers 422 naming the tournament', async () => {
    const playerId = await makePlayer(OWNER);
    const small = await seedTournament(playerId, 'Winter Rapid');
    for (let i = 0; i < 5; i++) {
      await seedRatedGame(playerId, { stream: 'tournament', tournamentId: small });
    }

    const res = await get(OWNER, 'tournament', small);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('not_enough_evidence');
    expect(body.message).toContain('All 5 analyzed games in this tournament count');
  });

  test('an unknown tournament id answers 404, not a leak', async () => {
    const playerId = await makePlayer(OWNER);
    for (let i = 0; i < 6; i++) await seedRatedGame(playerId, { stream: 'tournament' });

    const res = await get(OWNER, 'tournament', '00000000-0000-4000-8000-0000000000f0');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.message).toBe('No analyzed games in this tournament yet.');
  });

  test('serves the stored report while games in scope are analysing, regenerates once quiet', async () => {
    const playerId = await makePlayer(OWNER);
    for (let i = 0; i < 6; i++) await seedRatedGame(playerId);

    const first = await get(OWNER, 'online');
    const firstBody = (await first.json()) as ReportBody;

    // A game lands in the queue. The report must not regenerate per poll:
    // new weakness ids remount the client's list and replay its animations.
    await seedRatedGame(playerId, {
      analysisStatus: 'queued',
      analyzedAt: null,
      playedAt: new Date('2026-08-29T12:00:00Z'),
    });
    const during = await get(OWNER, 'online');
    expect(during.status).toBe(200);
    const duringBody = (await during.json()) as ReportBody;
    expect(duringBody.id).toBe(firstBody.id);
    expect(duringBody.gamesCovered).toBe(6);

    // The queue drains: the next read regenerates exactly once.
    await harness.db
      .update(game)
      .set({ analysisStatus: 'complete', analyzedAt: new Date(Date.now() + 3_600_000) })
      .where(eq(game.playerId, playerId));
    const after = await get(OWNER, 'online');
    const afterBody = (await after.json()) as ReportBody;
    expect(afterBody.id).not.toBe(firstBody.id);
    expect(afterBody.gamesCovered).toBe(7);
  });
});
