/**
 * ST-105. The advice close-out against a real PostgreSQL: a judged summary
 * marks one weakness group done and pays the XP exactly once, a fail stores
 * nothing, an already-done item never re-runs the model, and the done state
 * survives the report regenerating with fresh weakness rows.
 *
 * The verdict itself is the model's; the fake client here pins only what the
 * route does with one. The prompt's content is pinned in `zai.test.ts`.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { adviceProgress, game, mistake, player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { AdviceVerifyFacts, AiClient } from '../coaching/zai.ts';
import { XP_PER_VERIFIED_ADVICE } from './advice-progress.ts';

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

type Verdict = { pass: boolean; feedback: string };

function fakeAi(options: {
  adviceLines?: string[];
  verdict?: Verdict | Error;
  verifyCalls?: AdviceVerifyFacts[];
}): AiClient {
  return {
    explainMistake: () => Promise.reject(new Error('not used here')),
    askSocraticQuestion: () => Promise.reject(new Error('not used here')),
    adviseWeaknesses: () =>
      options.adviceLines
        ? Promise.resolve(options.adviceLines)
        : Promise.reject(new Error('not used here')),
    summarizeReport: () => Promise.reject(new Error('not used here')),
    verifyAdviceSummary: (input) => {
      options.verifyCalls?.push(input);
      const verdict = options.verdict;
      if (verdict instanceof Error) return Promise.reject(verdict);
      return Promise.resolve(verdict ?? { pass: true, feedback: 'Good, keep that habit.' });
    },
  };
}

function app(userId: string | null, aiClient?: AiClient | null) {
  // The client is always explicit: an ambient ZAI_API_KEY in the developer's
  // shell must never turn a test into a live model call.
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
    aiClient: aiClient ?? null,
  });
}

function post(userId: string | null, body: unknown, aiClient?: AiClient | null) {
  return app(userId, aiClient).request('/report/advice/done', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getReport(userId: string, aiClient?: AiClient | null) {
  return app(userId, aiClient).request('/report?stream=online');
}

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .returning({ id: player.id });
  return row!.id;
}

let seq = 0;
/** Insert one rated, analysed game; `analyzedAt` decides report freshness. */
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

/** Three hanging-piece middlegame mistakes over nine rated games: one motif card. */
async function seedAdviceGames(playerId: string): Promise<void> {
  for (let i = 0; i < 9; i++) await seedRatedGame(playerId);
  const [g1, g2, g3] = await harness.db
    .select({ id: game.id })
    .from(game)
    .where(eq(game.playerId, playerId))
    .limit(3);
  for (const g of [g1, g2, g3]) {
    await addMistake(g!.id, { halfPointsLost: 1, motif: 'hanging_piece', phase: 'middlegame' });
  }
}

const MOTIF_LINE =
  'Look at every undefended piece before you move; 3 losses were pieces left hanging.';
const PHASE_LINE =
  'Around move 1 you already lose material; test every capture against a defender first.';
const MOTIF_BODY = {
  stream: 'online',
  tournamentId: null,
  kind: 'motif',
  label: 'Hanging piece',
  eco: null,
  summary: 'I counted defenders on every capture for a week and stopped leaving pieces loose.',
};

describe('POST /report/advice/done (ST-105)', () => {
  test('a passing summary marks the weakness done and pays the award once', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE] });

    const stored = await getReport(OWNER, ai);
    expect(stored.status).toBe(200);

    const res = await post(OWNER, MOTIF_BODY, ai);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pass: boolean;
      feedback: string;
      completedAt: string | null;
    };
    expect(body.pass).toBe(true);
    expect(body.completedAt).not.toBeNull();

    const [row] = await harness.db
      .select()
      .from(adviceProgress)
      .where(eq(adviceProgress.playerId, playerId));
    expect(row).toMatchObject({ kind: 'motif', groupKey: 'hanging_piece' });
    expect(row!.summary).toBe(MOTIF_BODY.summary);

    const [p] = await harness.db.select().from(player).where(eq(player.id, playerId));
    // The award pays, and the streak it does not touch stays puzzle-only.
    expect(p!.xp).toBe(XP_PER_VERIFIED_ADVICE);
    expect(p!.currentStreak).toBe(0);
    expect(p!.lastActivityDate).toBeNull();

    // The served report now shows the card as done.
    const served = await getReport(OWNER, ai);
    const body2 = (await served.json()) as {
      weaknesses: { kind: string; done: boolean; completedAt: string | null }[];
    };
    const motif = body2.weaknesses.find((w) => w.kind === 'motif')!;
    expect(motif.done).toBe(true);
    expect(motif.completedAt).toBe(body.completedAt);
    expect(body2.weaknesses.find((w) => w.kind === 'phase')!.done).toBe(false);
  });

  test('a failing summary stores nothing and pays nothing', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const ai = fakeAi({
      adviceLines: [MOTIF_LINE, PHASE_LINE],
      verdict: { pass: false, feedback: 'Name one concrete detail you actually did.' },
    });
    await getReport(OWNER, ai);

    const res = await post(OWNER, MOTIF_BODY, ai);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pass: boolean;
      feedback: string;
      completedAt: string | null;
    };
    expect(body).toMatchObject({
      pass: false,
      feedback: 'Name one concrete detail you actually did.',
      completedAt: null,
    });

    const rows = await harness.db
      .select()
      .from(adviceProgress)
      .where(eq(adviceProgress.playerId, playerId));
    expect(rows).toHaveLength(0);
    const [p] = await harness.db.select().from(player).where(eq(player.id, playerId));
    expect(p!.xp).toBe(0);
  });

  test('re-submitting a done item returns it without another model call', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const verifyCalls: AdviceVerifyFacts[] = [];
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE], verifyCalls });
    await getReport(OWNER, ai);

    const first = await post(OWNER, MOTIF_BODY, ai);
    const firstBody = (await first.json()) as { completedAt: string | null };

    const second = await post(OWNER, MOTIF_BODY, ai);
    const secondBody = (await second.json()) as { pass: boolean; completedAt: string | null };
    expect(secondBody).toMatchObject({ pass: true, completedAt: firstBody.completedAt });
    expect(verifyCalls).toHaveLength(1);
    const [p] = await harness.db.select().from(player).where(eq(player.id, playerId));
    expect(p!.xp).toBe(XP_PER_VERIFIED_ADVICE);
  });

  test('the done state survives the report regenerating', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE] });
    await getReport(OWNER, ai);
    await post(OWNER, MOTIF_BODY, ai);

    // A new analysed game makes the stored report stale, so the next read
    // regenerates it and writes fresh weakness rows. The group key holds.
    await seedRatedGame(playerId, { analyzedAt: new Date(Date.now() + 60_000) });
    const regenerated = await getReport(OWNER, ai);
    const body = (await regenerated.json()) as {
      id: string;
      weaknesses: { kind: string; done: boolean; completedAt: string | null }[];
    };
    const motif = body.weaknesses.find((w) => w.kind === 'motif')!;
    expect(motif.done).toBe(true);
    expect(motif.completedAt).not.toBeNull();
  });

  test('the model receives the label, the advice line and the summary, and nothing else', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const verifyCalls: AdviceVerifyFacts[] = [];
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE], verifyCalls });
    await getReport(OWNER, ai);

    await post(OWNER, MOTIF_BODY, ai);

    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0]).toEqual({
      label: 'Hanging piece',
      advice: MOTIF_LINE,
      summary: MOTIF_BODY.summary,
    });
  });

  test('refuses a weakness the stored report does not show', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE] });
    await getReport(OWNER, ai);

    const res = await post(OWNER, { ...MOTIF_BODY, label: 'Nonexistent weakness' }, ai);
    expect(res.status).toBe(422);
    const noSuchWeakness = (await res.json()) as { code: string };
    expect(noSuchWeakness.code).toBe('no_such_weakness');
  });

  test('refuses with 404 when the scope has no stored report', async () => {
    await makePlayer(OWNER);
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE] });

    const res = await post(OWNER, { ...MOTIF_BODY, stream: 'tournament' }, ai);
    expect(res.status).toBe(404);
    const noReport = (await res.json()) as { code: string };
    expect(noReport.code).toBe('no_report');
  });

  test('answers 502 and stores nothing when the model is down', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const ai = fakeAi({
      adviceLines: [MOTIF_LINE, PHASE_LINE],
      verdict: new Error('model down'),
    });
    await getReport(OWNER, ai);

    const res = await post(OWNER, MOTIF_BODY, ai);
    expect(res.status).toBe(502);
    const coachUnavailable = (await res.json()) as { code: string };
    expect(coachUnavailable.code).toBe('coach_unavailable');

    const rows = await harness.db
      .select()
      .from(adviceProgress)
      .where(eq(adviceProgress.playerId, playerId));
    expect(rows).toHaveLength(0);
    const [p] = await harness.db.select().from(player).where(eq(player.id, playerId));
    expect(p!.xp).toBe(0);
  });

  test('answers 401 with no session', async () => {
    const res = await post(null, MOTIF_BODY, fakeAi({}));
    expect(res.status).toBe(401);
  });
});
