/**
 * ST-127. The report's share card against a real PostgreSQL: creation from
 * the same report read the report screen serves, the two-field payload scope,
 * expiry, revocation, and the honest 404s.
 *
 * The share-act mechanics are pinned in the proof-sheet, assignment, and
 * game-share suites; this covers what the card specifically promises: the
 * payload is exactly two fields, and the headline is the report's own rank 1.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { game, mistake, player, reportCardLink } from '../db/schema.ts';
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
    // Explicit: an ambient ZAI_API_KEY must never turn a "no key" test into a
    // live model call.
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

/** A report-eligible player: enough rated games, three with a hanging piece. */
async function seedReportWithLeak(playerId: string): Promise<void> {
  const g1 = await seedRatedGame(playerId);
  const g2 = await seedRatedGame(playerId);
  const g3 = await seedRatedGame(playerId);
  for (let i = 0; i < 6; i++) await seedRatedGame(playerId);
  await addMistake(g1, { halfPointsLost: 2, motif: 'hanging_piece', phase: 'middlegame' });
  await addMistake(g2, { halfPointsLost: 1, motif: 'hanging_piece', phase: 'middlegame' });
  await addMistake(g3, { halfPointsLost: 1, motif: 'hanging_piece', phase: 'middlegame' });
}

interface ReportBody {
  weaknesses: { ratingLeak: number; label: string }[];
}

async function createCard(
  userId: string | null,
  body: Record<string, unknown> = { stream: 'online' },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app(userId).request('/report/share-cards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function readShared(
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app(null).request(`/shared/cards/${token}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /report/share-cards', () => {
  test('freezes the report read rank-1 weakness into the card', async () => {
    const playerId = await makePlayer(OWNER);
    await seedReportWithLeak(playerId);

    // The report read the card must agree with.
    const reportRes = await app(OWNER).request('/report?stream=online');
    expect(reportRes.status).toBe(200);
    const report = (await reportRes.json()) as ReportBody;
    expect(report.weaknesses.length).toBeGreaterThan(0);
    const headline = report.weaknesses[0]!;

    const { status, body } = await createCard(OWNER);
    expect(status).toBe(201);
    expect(body.ratingLeak).toBe(headline.ratingLeak);
    expect(body.label).toBe(headline.label);
    expect(body.token).toEqual(expect.any(String));
    expect(body.url).toMatch(new RegExp(`/shared/cards/${String(body.token)}$`));
    expect(body.revokedAt).toBeNull();
    expect(body.expiresAt).toBeNull();
  });

  test('answers the report read refusals honestly', async () => {
    const playerId = await makePlayer(OWNER);
    const noGames = await createCard(OWNER);
    expect(noGames.status).toBe(404);

    await seedRatedGame(playerId, { analysisStatus: 'complete' });
    const thin = await createCard(OWNER);
    expect(thin.status).toBe(422);
    expect(String(thin.body.code)).toBe('not_enough_evidence');
  });

  test('refuses a report with no weakness rather than sharing an empty card', async () => {
    const playerId = await makePlayer(OWNER);
    for (let i = 0; i < 6; i++) await seedRatedGame(playerId);
    // Rated games but no mistakes: a valid report with nothing quotable.
    const { status, body } = await createCard(OWNER);
    expect(status).toBe(404);
    expect(String(body.message)).toMatch(/no weakness/i);
  });

  test('requires a session', async () => {
    const { status } = await createCard(null);
    expect(status).toBe(401);
  });
});

describe('GET /shared/cards/{token}', () => {
  test('serves exactly the two fields and nothing else', async () => {
    const playerId = await makePlayer(OWNER);
    await seedReportWithLeak(playerId);
    const { body: created } = await createCard(OWNER);

    const { status, body } = await readShared(String(created.token));
    expect(status).toBe(200);
    // The payload-scoping contract: a key that is not one of these two is the
    // card growing into a profile, which is the failure mode this story pins.
    expect(Object.keys(body).sort()).toEqual(['label', 'ratingLeak']);
    expect(body.ratingLeak).toBe(created.ratingLeak);
    expect(body.label).toBe(created.label);
  });

  test('answers the same honest 404 for unknown, expired, and revoked links', async () => {
    const playerId = await makePlayer(OWNER);
    await seedReportWithLeak(playerId);
    const { body: created } = await createCard(OWNER);

    const unknown = await readShared('x'.repeat(43));
    expect(unknown.status).toBe(404);

    const expired = await createCard(OWNER, {
      stream: 'online',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const expiredRead = await readShared(String(expired.body.token));
    expect(expiredRead.status).toBe(404);
    expect(expiredRead.body).toEqual(unknown.body);

    const del = await app(OWNER).request(`/report/share-cards/${String(created.id)}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    const revokedRead = await readShared(String(created.token));
    expect(revokedRead.status).toBe(404);
    expect(revokedRead.body).toEqual(unknown.body);
  });
});

describe('GET /report/share-cards', () => {
  test('lists the player live cards newest first with their payload', async () => {
    const playerId = await makePlayer(OWNER);
    await seedReportWithLeak(playerId);
    const first = await createCard(OWNER);
    const second = await createCard(OWNER);

    const res = await app(OWNER).request('/report/share-cards');
    expect(res.status).toBe(200);
    const cards = (await res.json()) as Record<string, unknown>[];
    expect(cards).toHaveLength(2);
    expect(cards[0]!.id).toBe(second.body.id);
    expect(cards[1]!.id).toBe(first.body.id);
    for (const card of cards) {
      expect(card.ratingLeak).toEqual(expect.any(Number));
      expect(card.label).toEqual(expect.any(String));
      expect(card.revokedAt).toBeNull();
    }
  });

  test('drops revoked and expired cards from the list', async () => {
    const playerId = await makePlayer(OWNER);
    await seedReportWithLeak(playerId);
    const kept = await createCard(OWNER);
    const revoked = await createCard(OWNER);
    await createCard(OWNER, { stream: 'online', expiresAt: '2020-01-01T00:00:00.000Z' });
    await app(OWNER).request(`/report/share-cards/${String(revoked.body.id)}`, {
      method: 'DELETE',
    });

    const res = await app(OWNER).request('/report/share-cards');
    const cards = (await res.json()) as { id: string }[];
    expect(cards.map((c) => c.id)).toEqual([kept.body.id]);
  });
});

describe('DELETE /report/share-cards/{shareLinkId}', () => {
  test('revokes the card and marks the row rather than deleting it', async () => {
    const playerId = await makePlayer(OWNER);
    await seedReportWithLeak(playerId);
    const { body: created } = await createCard(OWNER);

    const del = await app(OWNER).request(`/report/share-cards/${String(created.id)}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);

    const [row] = await harness.db
      .select()
      .from(reportCardLink)
      .where(eq(reportCardLink.id, String(created.id)));
    expect(row!.revokedAt).not.toBeNull();
  });

  test('refuses another player and an unknown id with the honest errors', async () => {
    const playerId = await makePlayer(OWNER);
    await seedReportWithLeak(playerId);
    const { body: created } = await createCard(OWNER);

    const foreign = await app(OTHER).request(`/report/share-cards/${String(created.id)}`, {
      method: 'DELETE',
    });
    expect(foreign.status).toBe(403);

    const unknown = await app(OWNER).request(
      `/report/share-cards/44444444-4444-4444-8444-444444444444`,
      { method: 'DELETE' },
    );
    expect(unknown.status).toBe(404);
  });
});
