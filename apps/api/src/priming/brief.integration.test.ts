/**
 * ST-153. The priming surface against a real PostgreSQL: the token lifecycle
 * (create, rotate, revoke, list by prefix), the brief endpoint's bearer auth
 * with its single honest 401, the payload scope pinned to labels and counts,
 * the seven-day instance counts, and the rate limit.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, mistake, player, report, weakness } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

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
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : () => ({ userId })) as (c: Context) => unknown,
    aiClient: null,
  });
}

async function makePlayer(ownerId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
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
      playedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      analysisStatus: 'complete',
      analyzedAt: new Date(),
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
    phase: 'middlegame',
    motif: 'hanging_piece',
    ...fields,
  });
}

/** Six extra rated games with three hanging-piece mistakes, plus the stored report. */
async function seedReportWithLeak(playerId: string): Promise<void> {
  const g1 = await seedRatedGame(playerId);
  const g2 = await seedRatedGame(playerId);
  const g3 = await seedRatedGame(playerId);
  for (let i = 0; i < 6; i++) await seedRatedGame(playerId);
  await addMistake(g1, { halfPointsLost: 2 });
  await addMistake(g2, { halfPointsLost: 1 });
  await addMistake(g3, { halfPointsLost: 1 });

  const [stored] = await harness.db
    .insert(report)
    .values({
      playerId,
      stream: 'online',
      gamesCovered: 9,
      windowStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      windowEnd: new Date(),
      narrative: null,
      narrativeGeneratedAt: null,
    })
    .returning({ id: report.id });
  await harness.db.insert(weakness).values({
    reportId: stored!.id,
    kind: 'motif',
    label: 'Hanging piece',
    eco: null,
    ratingLeak: 10,
    saturated: false,
    halfPointsLost: 4,
    gamesAffected: 3,
    occurrences: 3,
    rank: 1,
    advice: null,
  });
}

async function createToken(
  userId: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app(userId).request('/priming/token', { method: 'POST' });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function readBrief(
  token: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app(null).request('/priming/brief', {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('the priming token lifecycle', () => {
  test('create returns the secret exactly once, and the list names a prefix only', async () => {
    await makePlayer(OWNER);
    const { status, body } = await createToken(OWNER);
    expect(status).toBe(201);
    const secret = String(body.token);
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(String(body.tokenPrefix)).not.toBe(secret);

    const listRes = await app(OWNER).request('/priming/token');
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(secret);
  });

  test('creating a second token rotates: the first stops working', async () => {
    await makePlayer(OWNER);
    const first = await createToken(OWNER);
    const second = await createToken(OWNER);
    expect(second.status).toBe(201);

    const old = await readBrief(String(first.body.token));
    expect(old.status).toBe(401);
    const fresh = await readBrief(String(second.body.token));
    expect(fresh.status).toBe(200);
  });

  test('revoke makes the token answer 401 indistinguishably from unknown', async () => {
    await makePlayer(OWNER);
    const { body } = await createToken(OWNER);
    const tokenId = String(body.id);
    const del = await app(OWNER).request(`/priming/token/${tokenId}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const revoked = await readBrief(String(body.token));
    expect(revoked.status).toBe(401);
    const unknown = await readBrief('not-a-real-token');
    expect(unknown.status).toBe(401);
    expect(revoked.body).toEqual(unknown.body);
  });

  test('another player cannot revoke my token', async () => {
    await makePlayer(OWNER);
    const { body } = await createToken(OWNER);
    const del = await app(OTHER).request(`/priming/token/${String(body.id)}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(403);
  });

  test('requires a session', async () => {
    const { status } = await createToken(null);
    expect(status).toBe(401);
  });
});

describe('GET /priming/brief', () => {
  test('missing, malformed, and unknown tokens all answer the same 401', async () => {
    await makePlayer(OWNER);
    expect((await readBrief(null)).status).toBe(401);

    const badHeader = await app(null).request('/priming/brief', {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(badHeader.status).toBe(401);

    expect((await readBrief('never-issued')).status).toBe(401);
  });

  test('serves exactly the brief fields: labels, streams, counts, focus', async () => {
    const playerId = await makePlayer(OWNER);
    await seedReportWithLeak(playerId);
    const { body } = await createToken(OWNER);

    const { status, body: brief } = await readBrief(String(body.token));
    expect(status).toBe(200);
    expect(Object.keys(brief).sort()).toEqual(['focusLabel', 'groups']);
    const groups = brief.groups as Record<string, unknown>[];
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThanOrEqual(3);
    for (const g of groups) {
      expect(Object.keys(g).sort()).toEqual(['label', 'stream', 'weekCount']);
      expect(typeof g.label).toBe('string');
      expect(['tournament', 'online']).toContain(g.stream);
      expect(Number.isInteger(g.weekCount)).toBe(true);
    }
    // The payload carries nothing else: the whole token reads labels and counts.
    expect(JSON.stringify(brief)).not.toContain(playerId);
    expect(JSON.stringify(brief)).not.toContain('rnbq');
  });

  test('the week count is fresh: an old instance does not count', async () => {
    const playerId = await makePlayer(OWNER);
    const g1 = await seedRatedGame(playerId);
    const g2 = await seedRatedGame(playerId, {
      playedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    for (let i = 0; i < 6; i++) await seedRatedGame(playerId);
    await addMistake(g1, { halfPointsLost: 2 });
    await addMistake(g2, { halfPointsLost: 1 });
    const [stored] = await harness.db
      .insert(report)
      .values({
        playerId,
        stream: 'online',
        gamesCovered: 8,
        windowStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        windowEnd: new Date(),
        narrative: null,
        narrativeGeneratedAt: null,
      })
      .returning({ id: report.id });
    await harness.db.insert(weakness).values({
      reportId: stored!.id,
      kind: 'motif',
      label: 'Hanging piece',
      eco: null,
      ratingLeak: 10,
      saturated: false,
      halfPointsLost: 3,
      gamesAffected: 2,
      occurrences: 2,
      rank: 1,
      advice: null,
    });
    const { body } = await createToken(OWNER);

    const { body: brief } = await readBrief(String(body.token));
    const groups = brief.groups as { label: string; weekCount: number }[];
    const total = groups.reduce((sum, g) => sum + g.weekCount, 0);
    expect(total).toBe(1);
  });

  test('is rate-limited beyond five reads in a window', async () => {
    await makePlayer(OWNER);
    const { body } = await createToken(OWNER);
    const token = String(body.token);

    for (let i = 0; i < 5; i++) {
      const { status } = await readBrief(token);
      expect(status).toBe(200);
    }
    const sixth = await readBrief(token);
    expect(sixth.status).toBe(429);
  });
});
