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
  // The client is always explicit: an ambient ZAI_API_KEY in the developer's
  // shell must never turn a "no key" test into a live model call.
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
    aiClient: aiClient ?? null,
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
/** ST-123. One stored ply per SAN, enough for the first-ten-ply window. */
async function addPlies(gameId: string, sans: string[]): Promise<void> {
  if (sans.length === 0) return;
  await harness.db.insert(movePly).values(
    sans.map((san, i) => ({
      gameId,
      ply: i + 1,
      san,
      uci: '0000',
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    })),
  );
}

/** ST-107. One assigned resource in a weakness's curriculum. */
interface ActionItemBody {
  id: string;
  resourceIndex: number;
  tier: 'beginner' | 'intermediate' | 'advanced';
  resource: string;
  status: 'pending' | 'completed';
  dueAt: string;
  completedAt: string | null;
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
    ply: number;
    moveSan: string;
    bestMoveSan: string;
    phase: string | null;
    judgement: string;
    cpLoss: number;
  }[];
  /** ST-123. The line-following figure; null outside the tournament stream. */
  lineConsistency:
    | { status: 'ok'; matched: number; games: number }
    | { status: 'below_floor'; games: number }
    | { status: 'no_full_line'; games: number }
    | null;
  /** ST-107. The curriculum the read fills; empty when no model is set. */
  actionItems: ActionItemBody[];
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

describe('GET /report model advice (ST-099)', () => {
  const MOTIF_LINE =
    'Look at every undefended piece before you move; 3 of your losses were pieces left hanging.';
  const PHASE_LINE =
    'Around move 1 you already lose material; test every capture against a defender first.';
  const HANGING_PIECE_TEMPLATE =
    'Before each move, ask what your opponent\u2019s last move attacks - and after choosing ' +
    'one, check it does not leave the moved piece, or anything it was guarding, undefended.';
  /** ST-107. The fake's fixed progressive set: one Beginner, one Intermediate, one Advanced. */
  const RESOURCES = [
    '[Beginner] Chess Steps workbook on hanging pieces',
    '[Intermediate] Silman, How to Reassess Your Chess',
    '[Advanced] Dvoretsky, Endgame Manual chapters on blunder control',
  ];

  function fakeAi(
    lines: string[] | Error,
    calls: { n: number; summarize?: number; resources?: number } = { n: 0 },
    summary: string | Error | null = null,
  ): AiClient {
    return {
      explainMistake: () => Promise.reject(new Error('not used here')),
      askSocraticQuestion: () => Promise.reject(new Error('not used here')),
      adviseWeaknesses: (facts) => {
        calls.n += 1;
        if (lines instanceof Error) return Promise.reject(lines);
        return Promise.resolve(lines.slice(0, facts.length));
      },
      // Default null rejects: the regeneration path catches and stores no plan.
      summarizeReport: () => {
        calls.summarize = (calls.summarize ?? 0) + 1;
        if (summary instanceof Error) return Promise.reject(summary);
        return summary === null
          ? Promise.reject(new Error('not used here'))
          : Promise.resolve(summary);
      },
      // ST-105. The advice close-out has its own suite; fakeAi stays a
      // report-generation double.
      verifyAdviceSummary: () => Promise.reject(new Error('not used here')),
      // ST-107. The curriculum fill: the same progressive set for every group.
      recommendResources: (groups) => {
        calls.resources = (calls.resources ?? 0) + 1;
        return Promise.resolve(groups.map(() => RESOURCES));
      },
      verifyResourceAssessment: () => Promise.reject(new Error('not used here')),
    };
  }

  /** Nine rated games; three hanging-piece middlegame mistakes make the motif group. */
  async function seedAdviceGames(): Promise<string> {
    const playerId = await makePlayer(OWNER);
    const g1 = await seedRatedGame(playerId);
    const g2 = await seedRatedGame(playerId);
    const g3 = await seedRatedGame(playerId);
    for (let i = 0; i < 6; i++) await seedRatedGame(playerId);
    await addMistake(g1, { halfPointsLost: 1, motif: 'hanging_piece', phase: 'middlegame' });
    await addMistake(g2, { halfPointsLost: 1, motif: 'hanging_piece', phase: 'middlegame' });
    await addMistake(g3, { halfPointsLost: 1, motif: 'hanging_piece', phase: 'middlegame' });
    return playerId;
  }

  test('writes the model line at the click, stores it, and never re-asks on a serve', async () => {
    const playerId = await seedAdviceGames();
    const calls = { n: 0, resources: 0 };
    const first = await app(OWNER, fakeAi([MOTIF_LINE, PHASE_LINE], calls)).request(
      '/report?stream=online',
    );
    expect(first.status).toBe(200);
    const body = (await first.json()) as ReportBody;
    // Generation stores the template copy; no model call has happened yet.
    expect(body.weaknesses.find((w) => w.kind === 'motif')!.advice).toBe(HANGING_PIECE_TEMPLATE);
    expect(body.weaknesses.find((w) => w.kind === 'motif')!.actionItems).toEqual([]);
    expect(calls.n).toBe(0);
    expect(calls.resources).toBe(0);

    // The click that opens the weakness: one advise call for one group, the
    // progressive set assigned, tiers parsed from the fake resources.
    const motif = body.weaknesses.find((w) => w.kind === 'motif')!;
    const click = await app(OWNER, fakeAi([MOTIF_LINE, PHASE_LINE], calls)).request(
      '/report/weakness',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weaknessId: motif.id }),
      },
    );
    expect(click.status).toBe(200);
    const coached = (await click.json()) as {
      advice: string | null;
      actionItems: ActionItemBody[];
    };
    expect(coached.advice).toBe(MOTIF_LINE);
    expect(coached.actionItems.map((i) => [i.tier, i.status])).toEqual([
      ['beginner', 'pending'],
      ['intermediate', 'pending'],
      ['advanced', 'pending'],
    ]);
    expect(coached.actionItems.map((i) => i.resource)).toEqual(RESOURCES);
    expect(calls.n).toBe(1);
    expect(calls.resources).toBe(1);

    const [stored] = await harness.db.select().from(report).where(eq(report.playerId, playerId));
    const ws = await harness.db.select().from(weakness).where(eq(weakness.reportId, stored!.id));
    expect(ws.find((w) => w.kind === 'motif')!.advice).toBe(MOTIF_LINE);
    expect(ws.find((w) => w.kind === 'phase')!.advice).toBeNull();

    // A fresh serve reads the stored line and the assigned set; zero new calls.
    const again = await app(OWNER, fakeAi([], calls)).request('/report?stream=online');
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as ReportBody;
    expect(againBody.id).toBe(body.id);
    expect(againBody.weaknesses.find((w) => w.kind === 'motif')!.advice).toBe(MOTIF_LINE);
    expect(againBody.weaknesses.find((w) => w.kind === 'motif')!.actionItems).toHaveLength(3);
    expect(calls.n).toBe(1);
    expect(calls.resources).toBe(1);
  });

  test('keeps the template copy when the model refuses the clicked weakness', async () => {
    await seedAdviceGames();
    const calls = { n: 0 };
    const gen = await app(OWNER, fakeAi(new Error('Z.AI down'), calls)).request(
      '/report?stream=online',
    );
    expect(gen.status).toBe(200);
    const genBody = (await gen.json()) as ReportBody;
    const motif = genBody.weaknesses.find((w) => w.kind === 'motif')!;

    const click = await app(OWNER, fakeAi(new Error('Z.AI down'), calls)).request(
      '/report/weakness',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weaknessId: motif.id }),
      },
    );
    expect(click.status).toBe(200);
    const coached = (await click.json()) as { advice: string | null; actionItems: unknown[] };
    // The curriculum is not a garnish: the resource assignment succeeds even
    // when the advice line is refused, so the player keeps the work plan.
    expect(coached.actionItems).toHaveLength(3);
    // The report still serves the template, and the phase card keeps its own.
    const res = await app(OWNER, fakeAi(new Error('Z.AI down'), calls)).request(
      '/report?stream=online',
    );
    const body = (await res.json()) as ReportBody;
    expect(body.weaknesses.find((w) => w.kind === 'motif')!.advice).toBe(HANGING_PIECE_TEMPLATE);
    expect(body.weaknesses.find((w) => w.kind === 'phase')!.advice).toContain(
      'pick a candidate move',
    );
    // ST-100. The plan is a garnish like the advice: a failed model leaves it null.
    expect(body.narrative).toBeNull();
  });

  test('no key configured keeps the template behaviour and an empty curriculum', async () => {
    await seedAdviceGames();
    const res = await app(OWNER).request('/report?stream=online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    expect(body.weaknesses.find((w) => w.kind === 'motif')!.advice).toBe(HANGING_PIECE_TEMPLATE);
    // ST-100. No key, no model path: the plan is null with everything else intact.
    expect(body.narrative).toBeNull();
    // ST-107. No key, no curriculum: the click serves the empty set too.
    const motif = body.weaknesses.find((w) => w.kind === 'motif')!;
    const click = await app(OWNER).request('/report/weakness', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weaknessId: motif.id }),
    });
    expect(click.status).toBe(200);
    const coached = (await click.json()) as { advice: string | null; actionItems: unknown[] };
    expect(coached.advice).toBeNull();
    expect(coached.actionItems).toEqual([]);
  });

  describe('GET /report model summary (ST-100)', () => {
    const PLAN =
      'Start with the 3 hanging pieces at move 1, each costing 100 centipawns; rehearse the pattern before the next event.';
    test('stores the model plan and never calls the model when serving', async () => {
      const playerId = await seedAdviceGames();
      const calls = { n: 0, summarize: 0 };
      const first = await app(OWNER, fakeAi([MOTIF_LINE, PHASE_LINE], calls, PLAN)).request(
        '/report?stream=online',
      );
      expect(first.status).toBe(200);
      const body = (await first.json()) as ReportBody;
      expect(body.narrative).toBe(PLAN);
      expect(calls.n).toBe(0);

      const [stored] = await harness.db.select().from(report).where(eq(report.playerId, playerId));
      expect(stored!.narrative).toBe(PLAN);
      expect(stored!.narrativeGeneratedAt).not.toBeNull();

      // A fresh serve reads the stored plan; zero model calls of either kind.
      const again = await app(
        OWNER,
        fakeAi(
          new Error('serve must not call advise'),
          calls,
          new Error('serve must not summarize'),
        ),
      ).request('/report?stream=online');
      expect(again.status).toBe(200);
      const againBody = (await again.json()) as ReportBody;
      expect(againBody.id).toBe(body.id);
      expect(againBody.narrative).toBe(PLAN);
      expect(calls.n).toBe(0);
      expect(calls.summarize).toBe(1);
    });

    test('a plan citing a number outside the fact set is rejected after one retry', async () => {
      await seedAdviceGames();
      const calls = { n: 0, summarize: 0 };
      const res = await app(
        OWNER,
        fakeAi([MOTIF_LINE, PHASE_LINE], calls, 'Fix the 99 blunders at move 77.'),
      ).request('/report?stream=online');
      expect(res.status).toBe(200);
      const body = (await res.json()) as ReportBody;
      expect(body.narrative).toBeNull();
      expect(calls.summarize).toBe(2);
    });

    test('evidence instances carry the ply the deep link needs', async () => {
      await seedAdviceGames();
      const res = await app(OWNER).request('/report?stream=online');
      expect(res.status).toBe(200);
      const body = (await res.json()) as ReportBody;
      const motif = body.weaknesses.find((w) => w.kind === 'motif')!;
      expect(motif.evidence.length).toBeGreaterThan(0);
      for (const instance of motif.evidence) {
        expect(instance.ply).toBe((instance.moveNumber - 1) * 2 + 1);
      }
    });
  });

  describe('ST-123. Line consistency on the tournament report', () => {
    const E4_LINE = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
    const D4_LINE = ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O'];

    test('the share rides the opening card: matched of games against the modal line', async () => {
      const playerId = await makePlayer(OWNER);
      for (let i = 0; i < 5; i++) {
        const id = await seedRatedGame(playerId, {
          stream: 'tournament',
          eco: 'B22',
          opening: 'Sicilian, Alapin',
        });
        await addPlies(id, E4_LINE);
        if (i < 2) await addMistake(id, { halfPointsLost: 1, phase: 'middlegame' });
      }
      const deviant = await seedRatedGame(playerId, {
        stream: 'tournament',
        eco: 'B22',
        opening: 'Sicilian, Alapin',
      });
      await addPlies(deviant, D4_LINE);

      const res = await get(OWNER, 'tournament');
      expect(res.status).toBe(200);
      const body = (await res.json()) as ReportBody;
      const opening = body.weaknesses.find((w) => w.kind === 'opening')!;
      expect(opening.eco).toBe('B22');
      expect(opening.lineConsistency).toEqual({ status: 'ok', matched: 5, games: 6 });
    });

    test('the online report carries no consistency figure, whatever the moves show', async () => {
      const playerId = await makePlayer(OWNER);
      for (let i = 0; i < 6; i++) {
        const id = await seedRatedGame(playerId, { stream: 'online', eco: 'B22' });
        await addPlies(id, E4_LINE);
        if (i < 2) await addMistake(id, { halfPointsLost: 1, phase: 'middlegame' });
      }

      const res = await get(OWNER, 'online');
      expect(res.status).toBe(200);
      const body = (await res.json()) as ReportBody;
      const opening = body.weaknesses.find((w) => w.kind === 'opening')!;
      expect(opening.lineConsistency).toBeNull();
    });

    test('a group under the five-game floor is withheld, naming its size', async () => {
      const playerId = await makePlayer(OWNER);
      for (let i = 0; i < 2; i++) {
        const id = await seedRatedGame(playerId, {
          stream: 'tournament',
          eco: 'C00',
          opening: 'French, Tarrasch',
        });
        await addPlies(id, E4_LINE);
        await addMistake(id, { halfPointsLost: 1, phase: 'middlegame' });
      }
      for (let i = 0; i < 4; i++) await seedRatedGame(playerId, { stream: 'tournament' });

      const res = await get(OWNER, 'tournament');
      expect(res.status).toBe(200);
      const body = (await res.json()) as ReportBody;
      const opening = body.weaknesses.find((w) => w.kind === 'opening')!;
      expect(opening.eco).toBe('C00');
      expect(opening.lineConsistency).toEqual({ status: 'below_floor', games: 2 });
    });

    test('games outside the report window are out of the denominator', async () => {
      const playerId = await makePlayer(OWNER);
      for (let i = 0; i < 5; i++) {
        const id = await seedRatedGame(playerId, {
          stream: 'tournament',
          eco: 'B22',
          opening: 'Sicilian, Alapin',
        });
        await addPlies(id, E4_LINE);
        if (i < 2) await addMistake(id, { halfPointsLost: 1, phase: 'middlegame' });
      }
      // Two more games in the same opening, played before the season window
      // opened: played, stored, and excluded from this report's figure.
      for (const playedAt of [new Date('2024-02-01T12:00:00Z'), new Date('2024-03-01T12:00:00Z')]) {
        const id = await seedRatedGame(playerId, {
          stream: 'tournament',
          eco: 'B22',
          opening: 'Sicilian, Alapin',
          playedAt,
          analyzedAt: playedAt,
        });
        await addPlies(id, E4_LINE);
      }
      // The report itself still needs its rated floor, met by games outside
      // any opening group.
      for (let i = 0; i < 2; i++) await seedRatedGame(playerId, { stream: 'tournament' });

      const res = await get(OWNER, 'tournament');
      expect(res.status).toBe(200);
      const body = (await res.json()) as ReportBody;
      const opening = body.weaknesses.find((w) => w.kind === 'opening')!;
      expect(opening.lineConsistency).toEqual({ status: 'ok', matched: 5, games: 5 });
    });
  });
});
