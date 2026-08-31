/**
 * ST-102. The practice endpoint against a real PostgreSQL: ownership, the
 * mistake-ply boundary, the running tally, and the `practiced` flag the
 * report's evidence carries.
 *
 * The route tests mirror set-game-color's suite; the report test reuses the
 * report suite's fixture style, because the flag only exists so a report can
 * show it.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, mistake, player, practiceAttempt } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { XP_PER_ACTIVITY_DAY } from '../players/activity.ts';
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
  await harness.db
    .insert(user)
    .values([
      { id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true },
      { id: OTHER, name: 'Other', email: 'other@example.com', emailVerified: true },
    ])
    .onConflictDoNothing();
});

function app(userId: string | null) {
  // The client is always explicit: an ambient ZAI_API_KEY in the developer's
  // shell must never turn a test into a live model call.
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
    aiClient: null,
  });
}

async function post(userId: string | null, gameId: string, body: unknown) {
  return app(userId).request(`/games/${gameId}/practice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function attemptCount(): Promise<number> {
  const rows = await harness.db.select().from(practiceAttempt);
  return rows.length;
}

/** ST-072: one player per account. Created on first use, reused after. */
async function seedPlayer(ownerId: string): Promise<string> {
  await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .onConflictDoNothing();
  const [row] = await harness.db
    .select({ id: player.id })
    .from(player)
    .where(eq(player.ownerUserId, ownerId));
  return row!.id;
}

/** One stored game for `playerId`. */
async function seedGame(
  playerId: string,
  overrides: Partial<typeof game.$inferInsert> = {},
): Promise<string> {
  const [created] = await harness.db
    .insert(game)
    .values({
      playerId,
      stream: 'online',
      source: 'chesscom',
      pgnHash: `hash_${playerId}_${Math.random()}`,
      pgn: '[Result "1/2-1/2"]\n\n1. e4 e5 1/2-1/2',
      playerColor: 'white',
      whiteElo: 1500,
      blackElo: 1500,
      result: '1/2-1/2',
      playedAt: new Date('2026-08-01T12:00:00Z'),
      analysisStatus: 'complete',
      analyzedAt: new Date('2026-08-01T12:00:00Z'),
      ...overrides,
    })
    .returning({ id: game.id });
  return created!.id;
}

/** Convenience for the route tests: the owner's player, plus one game. */
async function seedOwnedGame(ownerId: string): Promise<string> {
  return seedGame(await seedPlayer(ownerId));
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

describe('POST /games/{gameId}/practice', () => {
  test('answers 403 for a game belonging to another account’s player and stores nothing', async () => {
    const gameId = await seedOwnedGame(OWNER);
    const res = await post(OTHER, gameId, { ply: 10, solved: true });
    expect(res.status).toBe(403);
    expect(await attemptCount()).toBe(0);
  });

  test('answers 404 for a game that does not exist', async () => {
    await seedOwnedGame(OWNER);
    const res = await post(OWNER, '00000000-0000-4000-8000-000000000000', {
      ply: 10,
      solved: true,
    });
    expect(res.status).toBe(404);
    expect(await attemptCount()).toBe(0);
  });

  test('answers 422 for a ply that is not one of the game’s mistakes and stores nothing', async () => {
    const gameId = await seedOwnedGame(OWNER);
    await addMistake(gameId, { ply: 10, moveNumber: 5 });
    const res = await post(OWNER, gameId, { ply: 12, solved: true });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('not_a_mistake');
    expect(await attemptCount()).toBe(0);
  });

  test('answers 400 for a body zod does not accept and stores nothing', async () => {
    const gameId = await seedOwnedGame(OWNER);
    await addMistake(gameId, { ply: 10, moveNumber: 5 });
    for (const body of [{ ply: 1.5, solved: true }, { solved: true }]) {
      const res = await post(OWNER, gameId, body);
      expect(res.status).toBe(400);
    }
    expect(await attemptCount()).toBe(0);
  });

  test('the first POST creates the tally, later POSTs increment it', async () => {
    const gameId = await seedOwnedGame(OWNER);
    await addMistake(gameId, { ply: 10, moveNumber: 5 });

    const first = await post(OWNER, gameId, { ply: 10, solved: true });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ gameId, ply: 10, attempts: 1, solved: true });

    const second = await post(OWNER, gameId, { ply: 10, solved: false });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ gameId, ply: 10, attempts: 2, solved: true });
  });

  test('solved is sticky in both orders of the merge', async () => {
    const playerId = await seedPlayer(OWNER);
    const a = await seedGame(playerId);
    const b = await seedGame(playerId);
    await addMistake(a, { ply: 10, moveNumber: 5 });
    await addMistake(b, { ply: 10, moveNumber: 5 });

    const revealed = await post(OWNER, a, { ply: 10, solved: false });
    expect(await revealed.json()).toMatchObject({ attempts: 1, solved: false });
    const solved = await post(OWNER, a, { ply: 10, solved: true });
    expect(await solved.json()).toMatchObject({ attempts: 2, solved: true });

    const solvedFirst = await post(OWNER, b, { ply: 10, solved: true });
    expect(await solvedFirst.json()).toMatchObject({ attempts: 1, solved: true });
    const revealedAfter = await post(OWNER, b, { ply: 10, solved: false });
    expect(await revealedAfter.json()).toMatchObject({ attempts: 2, solved: true });
  });
});

describe('GET /report practice flag', () => {
  interface EvidenceBody {
    gameId: string;
    ply: number;
    practiced: boolean;
  }
  interface ReportBody {
    weaknesses: { kind: string; label: string; evidence: EvidenceBody[] }[];
  }

  test('every instance starts false, and a solved attempt flags only its own place', async () => {
    // Seven rated games clears the six-game evidence floor. Two mistakes in
    // one game make sibling instances: practising one must not flag the other.
    const playerId = await seedPlayer(OWNER);
    const a = await seedGame(playerId);
    const b = await seedGame(playerId);
    for (let i = 0; i < 5; i++) await seedGame(playerId);
    await addMistake(a, { ply: 10, moveNumber: 5, phase: 'middlegame', cpLoss: 300 });
    await addMistake(a, { ply: 20, moveNumber: 10, phase: 'middlegame', cpLoss: 200 });
    await addMistake(b, { ply: 10, moveNumber: 5, phase: 'middlegame', cpLoss: 100 });

    const before = await app(OWNER).request('/report?stream=online');
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as ReportBody;
    const middlegame = beforeBody.weaknesses.find((w) => w.label === 'Middlegame')!;
    expect(middlegame).toBeDefined();
    expect(middlegame.evidence).toHaveLength(3);
    expect(middlegame.evidence.map((e) => e.practiced)).toEqual([false, false, false]);

    const res = await post(OWNER, a, { ply: 20, solved: true });
    expect(res.status).toBe(200);

    const after = await app(OWNER).request('/report?stream=online');
    const afterBody = (await after.json()) as ReportBody;
    const flagged = afterBody.weaknesses.find((w) => w.label === 'Middlegame')!.evidence;
    expect(flagged.find((e) => e.gameId === a && e.ply === 20)!.practiced).toBe(true);
    expect(flagged.find((e) => e.gameId === a && e.ply === 10)!.practiced).toBe(false);
    expect(flagged.find((e) => e.gameId === b && e.ply === 10)!.practiced).toBe(false);
  });
});

describe('practice feeds the streak (ST-103)', () => {
  async function playerState(ownerId: string) {
    const [row] = await harness.db
      .select({
        currentStreak: player.currentStreak,
        xp: player.xp,
        lastActivityDate: player.lastActivityDate,
      })
      .from(player)
      .where(eq(player.ownerUserId, ownerId));
    return row!;
  }

  test('the first solve of a day records the streak and XP, visible on /me', async () => {
    const gameId = await seedOwnedGame(OWNER);
    await addMistake(gameId, { ply: 10, moveNumber: 5 });

    const res = await post(OWNER, gameId, { ply: 10, solved: true });
    expect(res.status).toBe(200);

    const state = await playerState(OWNER);
    expect(state.currentStreak).toBe(1);
    expect(state.xp).toBe(XP_PER_ACTIVITY_DAY);

    const me = await app(OWNER).request('/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      player: { currentStreak: 1, xp: XP_PER_ACTIVITY_DAY },
    });
  });

  test('a second solve on the same day awards XP once', async () => {
    const playerId = await seedPlayer(OWNER);
    const a = await seedGame(playerId);
    const b = await seedGame(playerId);
    await addMistake(a, { ply: 10, moveNumber: 5 });
    await addMistake(b, { ply: 10, moveNumber: 5 });

    await post(OWNER, a, { ply: 10, solved: true });
    await post(OWNER, b, { ply: 20, solved: true });

    expect(await playerState(OWNER)).toMatchObject({
      currentStreak: 1,
      xp: XP_PER_ACTIVITY_DAY,
    });
  });

  test('a reveal or a failed attempt records nothing', async () => {
    const gameId = await seedOwnedGame(OWNER);
    await addMistake(gameId, { ply: 10, moveNumber: 5 });

    const revealed = await post(OWNER, gameId, { ply: 10, solved: false });
    expect(revealed.status).toBe(200);
    expect(await playerState(OWNER)).toMatchObject({
      currentStreak: 0,
      xp: 0,
      lastActivityDate: null,
    });

    // The solve after it still pays, once.
    await post(OWNER, gameId, { ply: 10, solved: true });
    expect(await playerState(OWNER)).toMatchObject({
      currentStreak: 1,
      xp: XP_PER_ACTIVITY_DAY,
    });
  });

  test('reviewing a game and solving a puzzle on the same day awards XP once', async () => {
    const gameId = await seedOwnedGame(OWNER);
    await addMistake(gameId, { ply: 10, moveNumber: 5 });

    // GET /games is the endpoint the review surface opens; on a complete
    // analysis it is the ST-080 activity trigger.
    const review = await app(OWNER).request(`/games/${gameId}`);
    expect(review.status).toBe(200);

    await post(OWNER, gameId, { ply: 10, solved: true });

    expect(await playerState(OWNER)).toMatchObject({
      currentStreak: 1,
      xp: XP_PER_ACTIVITY_DAY,
    });
  });
});
