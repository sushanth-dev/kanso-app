/**
 * ST-107. The action-item close-out against a real PostgreSQL: a read of the
 * report assigns each weakness group its three progressive resources when the
 * model is up, and POST /report/action-items/done judges one item's summary -
 * a pass marks that item done and pays the XP exactly once, a fail stores
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
import { actionItem, game, mistake, player, report, weakness } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { AiClient, ResourceVerifyFacts } from '../coaching/zai.ts';
import { XP_PER_VERIFIED_RESOURCE } from './action-items.ts';

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

type Verdict = { pass: boolean; feedback: string };

/** The fake's fixed progressive set: one Beginner, one Intermediate, one Advanced. */
const RESOURCES = [
  '[Beginner] Chess Steps workbook on hanging pieces',
  '[Intermediate] Silman, How to Reassess Your Chess',
  '[Advanced] Dvoretsky, Endgame Manual chapters on blunder control',
];

function fakeAi(options: {
  adviceLines?: string[];
  verdict?: Verdict | Error;
  verifyCalls?: ResourceVerifyFacts[];
  /** How many times each model entry point ran; the click tests pin "once". */
  counts?: { advise: number; resources: number };
}): AiClient {
  return {
    explainMistake: () => Promise.reject(new Error('not used here')),
    askSocraticQuestion: () => Promise.reject(new Error('not used here')),
    adviseWeaknesses: (facts) => {
      if (options.counts) options.counts.advise += 1;
      return options.adviceLines
        ? Promise.resolve(options.adviceLines.slice(0, facts.length))
        : Promise.reject(new Error('not used here'));
    },
    summarizeReport: () => Promise.reject(new Error('not used here')),
    verifyAdviceSummary: () => Promise.reject(new Error('not used here')),
    recommendResources: (groups) => {
      if (options.counts) options.counts.resources += 1;
      return Promise.resolve(groups.map(() => RESOURCES));
    },
    verifyResourceAssessment: (input) => {
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
  return app(userId, aiClient).request('/report/action-items/done', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The click that opens a weakness: the on-demand coaching endpoint. */
function coach(userId: string | null, body: unknown, aiClient?: AiClient | null) {
  return app(userId, aiClient).request('/report/weakness', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getReport(userId: string, aiClient?: AiClient | null) {
  return app(userId, aiClient).request('/report?stream=online');
}

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
  advice: string | null;
  actionItems: ActionItemBody[];
}

/** The motif card of a freshly read report; a read fills no curriculum. */
async function readMotif(aiClient?: AiClient | null): Promise<WeaknessBody> {
  const res = await getReport(OWNER, aiClient);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { weaknesses: WeaknessBody[] };
  return body.weaknesses.find((w) => w.kind === 'motif')!;
}

/** The motif card after its click: the model line and its three resources. */
async function coachMotif(
  aiClient?: AiClient | null,
): Promise<WeaknessBody & { actionItems: ActionItemBody[] }> {
  const motif = await readMotif(aiClient);
  const res = await coach(OWNER, { weaknessId: motif.id }, aiClient);
  expect(res.status).toBe(200);
  const body = (await res.json()) as WeaknessBody;
  return { ...motif, advice: body.advice, actionItems: body.actionItems };
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
const SUMMARY = 'I counted defenders on every capture for a week and stopped leaving pieces loose.';
const done = (actionItemId: string) => ({ actionItemId, summary: SUMMARY });

describe('POST /report/weakness (ST-107, on demand)', () => {
  test('a read carries no curriculum; the click assigns the group once', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const counts = { advise: 0, resources: 0 };
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE], counts });

    // The read: template advice on the card, no model, no curriculum.
    const motif = await readMotif(ai);
    expect(motif.advice).toContain('undefended');
    expect(motif.actionItems).toEqual([]);
    expect(counts).toEqual({ advise: 0, resources: 0 });

    // The click: the model line, the progressive set, tiers from the tags.
    const coached = await coachMotif(ai);
    expect(coached.advice).toBe(MOTIF_LINE);
    expect(coached.actionItems.map((i) => i.resource)).toEqual(RESOURCES);
    expect(
      coached.actionItems.map((i) => [i.resourceIndex, i.tier, i.status, i.completedAt]),
    ).toEqual([
      [0, 'beginner', 'pending', null],
      [1, 'intermediate', 'pending', null],
      [2, 'advanced', 'pending', null],
    ]);
    for (const item of coached.actionItems) {
      // The prototype's deadline: a week to work through the resource.
      expect(Date.parse(item.dueAt)).toBeGreaterThan(Date.now());
    }
    expect(counts).toEqual({ advise: 1, resources: 1 });

    // Only the opened group is assigned; the phase group waits for its click.
    const rows = await harness.db
      .select()
      .from(actionItem)
      .where(eq(actionItem.playerId, playerId));
    expect(rows).toHaveLength(3);
    expect(rows).toMatchObject([
      { kind: 'motif', groupKey: 'hanging_piece', resourceIndex: 0 },
      { kind: 'motif', groupKey: 'hanging_piece', resourceIndex: 1 },
      { kind: 'motif', groupKey: 'hanging_piece', resourceIndex: 2 },
    ]);

    // Re-opening the same weakness: the stored line serves, nothing re-asks.
    const again = await coach(OWNER, { weaknessId: motif.id }, ai);
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as WeaknessBody;
    expect(againBody.advice).toBe(MOTIF_LINE);
    expect(againBody.actionItems).toHaveLength(3);
    expect(counts).toEqual({ advise: 1, resources: 1 });

    // The stored line also wins on the next plain read.
    const served = await readMotif(ai);
    expect(served.advice).toBe(MOTIF_LINE);
    expect(served.actionItems).toHaveLength(3);
  });

  test('the click stores the line on the weakness row, its group alone', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE] });
    await coachMotif(ai);

    const [stored] = await harness.db.select().from(report).where(eq(report.playerId, playerId));
    const ws = await harness.db.select().from(weakness).where(eq(weakness.reportId, stored!.id));
    expect(ws.find((w) => w.kind === 'motif')!.advice).toBe(MOTIF_LINE);
    expect(ws.find((w) => w.kind === 'phase')!.advice).toBeNull();
  });

  test('opening a weakness without the model serves null and an empty set', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);

    const motif = await readMotif(null);
    const res = await coach(OWNER, { weaknessId: motif.id }, null);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WeaknessBody;
    expect(body.advice).toBeNull();
    expect(body.actionItems).toEqual([]);
    expect(
      await harness.db.select().from(actionItem).where(eq(actionItem.playerId, playerId)),
    ).toHaveLength(0);
  });

  test('answers 404 no_such_weakness for an unknown id and for another player\u2019s', async () => {
    await makePlayer(OWNER);
    const foreignPlayerId = await makePlayer(OTHER);
    const [foreignReport] = await harness.db
      .insert(report)
      .values({
        playerId: foreignPlayerId,
        stream: 'online',
        gamesCovered: 9,
        windowStart: new Date('2026-01-01T00:00:00Z'),
        windowEnd: new Date('2026-08-01T00:00:00Z'),
        narrative: null,
        narrativeGeneratedAt: null,
      })
      .returning({ id: report.id });
    const [foreignWeakness] = await harness.db
      .insert(weakness)
      .values({
        reportId: foreignReport!.id,
        kind: 'motif',
        label: 'Hanging piece',
        eco: null,
        ratingLeak: 10,
        saturated: false,
        halfPointsLost: 3,
        gamesAffected: 3,
        occurrences: 3,
        rank: 1,
        advice: null,
      })
      .returning({ id: weakness.id });

    const unknown = await coach(OWNER, { weaknessId: foreignWeakness!.id }, fakeAi({}));
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe('no_such_weakness');

    const missing = await coach(
      OWNER,
      { weaknessId: '00000000-0000-4000-8000-0000000000f0' },
      fakeAi({}),
    );
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe('no_such_weakness');
  });

  test('answers 401 with no session', async () => {
    const res = await coach(
      null,
      { weaknessId: '00000000-0000-4000-8000-000000000000' },
      fakeAi({}),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /report/action-items/done (ST-107)', () => {
  test('a passing summary marks the item done and pays the award once', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE] });
    const motif = await coachMotif(ai);
    const item = motif.actionItems[0]!;

    const res = await post(OWNER, done(item.id), ai);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pass: boolean;
      feedback: string;
      completedAt: string | null;
    };
    expect(body.pass).toBe(true);
    expect(body.completedAt).not.toBeNull();

    const [row] = await harness.db.select().from(actionItem).where(eq(actionItem.id, item.id));
    expect(row).toMatchObject({ status: 'completed', summary: SUMMARY });
    expect(row!.completedAt).not.toBeNull();

    const [p] = await harness.db.select().from(player).where(eq(player.id, playerId));
    // The award pays, and the streak it does not touch stays puzzle-only.
    expect(p!.xp).toBe(XP_PER_VERIFIED_RESOURCE);
    expect(p!.currentStreak).toBe(0);
    expect(p!.lastActivityDate).toBeNull();

    // The served report now shows that one item done; its siblings stay pending.
    const served = await readMotif(ai);
    expect(served.actionItems[0]).toMatchObject({
      status: 'completed',
      completedAt: body.completedAt,
    });
    expect(served.actionItems.slice(1).map((i) => i.status)).toEqual(['pending', 'pending']);
  });

  test('re-submitting a done item returns it without another model call', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const verifyCalls: ResourceVerifyFacts[] = [];
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE], verifyCalls });
    const motif = await coachMotif(ai);
    const item = motif.actionItems[0]!;

    const first = await post(OWNER, done(item.id), ai);
    const firstBody = (await first.json()) as { completedAt: string | null };

    const second = await post(OWNER, done(item.id), ai);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      pass: boolean;
      feedback: string;
      completedAt: string | null;
    };
    expect(secondBody).toMatchObject({
      pass: true,
      feedback: 'This one was already done.',
      completedAt: firstBody.completedAt,
    });
    expect(verifyCalls).toHaveLength(1);
    const [p] = await harness.db.select().from(player).where(eq(player.id, playerId));
    expect(p!.xp).toBe(XP_PER_VERIFIED_RESOURCE);
  });

  test('the model receives the label, the resource and the summary, and nothing else', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const verifyCalls: ResourceVerifyFacts[] = [];
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE], verifyCalls });
    const motif = await coachMotif(ai);

    await post(OWNER, done(motif.actionItems[0]!.id), ai);

    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0]).toEqual({
      label: 'Hanging piece',
      resource: RESOURCES[0],
      summary: SUMMARY,
    });
  });

  test('a failing verdict stores nothing and pays nothing', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const ai = fakeAi({
      adviceLines: [MOTIF_LINE, PHASE_LINE],
      verdict: { pass: false, feedback: 'Name one concrete detail you actually did.' },
    });
    const motif = await coachMotif(ai);
    const item = motif.actionItems[0]!;

    const res = await post(OWNER, done(item.id), ai);
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

    const [row] = await harness.db.select().from(actionItem).where(eq(actionItem.id, item.id));
    expect(row).toMatchObject({ status: 'pending', summary: null, completedAt: null });
    const [p] = await harness.db.select().from(player).where(eq(player.id, playerId));
    expect(p!.xp).toBe(0);
  });

  test('answers 502 and stores nothing when the model is down', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE], verdict: new Error('model down') });
    const motif = await coachMotif(ai);
    const item = motif.actionItems[0]!;

    const res = await post(OWNER, done(item.id), ai);
    expect(res.status).toBe(502);
    const coachUnavailable = (await res.json()) as { code: string };
    expect(coachUnavailable.code).toBe('coach_unavailable');

    const [row] = await harness.db.select().from(actionItem).where(eq(actionItem.id, item.id));
    expect(row).toMatchObject({ status: 'pending', summary: null });
    const [p] = await harness.db.select().from(player).where(eq(player.id, playerId));
    expect(p!.xp).toBe(0);
  });

  test('answers 404 no_such_item for an unknown id', async () => {
    await makePlayer(OWNER);

    const res = await post(OWNER, done('00000000-0000-4000-8000-0000000000f0'), fakeAi({}));
    expect(res.status).toBe(404);
    const noSuchItem = (await res.json()) as { code: string };
    expect(noSuchItem.code).toBe('no_such_item');
  });

  test('answers 404 no_such_item for another player\u2019s item', async () => {
    await makePlayer(OWNER);
    const foreignPlayerId = await makePlayer(OTHER);
    const [foreign] = await harness.db
      .insert(actionItem)
      .values({
        playerId: foreignPlayerId,
        kind: 'motif',
        groupKey: 'hanging_piece',
        label: 'Hanging piece',
        resourceIndex: 0,
        tier: 'beginner',
        resource: RESOURCES[0]!,
        dueAt: new Date(),
      })
      .returning({ id: actionItem.id });

    const res = await post(OWNER, done(foreign!.id), fakeAi({}));
    expect(res.status).toBe(404);
    const noSuchItem = (await res.json()) as { code: string };
    expect(noSuchItem.code).toBe('no_such_item');
  });

  test('answers 404 when the model is not mounted', async () => {
    await makePlayer(OWNER);

    const res = await post(OWNER, done('00000000-0000-4000-8000-0000000000f0'), null);
    expect(res.status).toBe(404);
    const notFound = (await res.json()) as { code: string };
    expect(notFound.code).toBe('not_found');
  });

  test('answers 401 with no session', async () => {
    const res = await post(null, done('00000000-0000-4000-8000-000000000000'), fakeAi({}));
    expect(res.status).toBe(401);
  });

  test('the done state survives the report regenerating', async () => {
    const playerId = await makePlayer(OWNER);
    await seedAdviceGames(playerId);
    const ai = fakeAi({ adviceLines: [MOTIF_LINE, PHASE_LINE] });
    const before = await coachMotif(ai);
    const item = before.actionItems[0]!;
    await post(OWNER, done(item.id), ai);

    // A new analysed game makes the stored report stale, so the next read
    // regenerates it and writes fresh weakness rows. The group key holds, and
    // the completed item is neither lost nor duplicated.
    await seedRatedGame(playerId, { analyzedAt: new Date(Date.now() + 60_000) });
    const after = await readMotif(ai);
    expect(after.actionItems).toHaveLength(3);
    expect(after.actionItems[0]).toMatchObject({ id: item.id, status: 'completed' });
    expect(after.actionItems[0]!.completedAt).not.toBeNull();
  });
});
