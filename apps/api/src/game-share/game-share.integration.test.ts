import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { gameShareLink } from '../db/schema.ts';
import { game, mistake, movePly, player } from '../db/schema.ts';
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
});

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

function sessionFor(userId: string) {
  return () => ({ userId });
}

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3';

/** A player, a completed game, two plies and one mistake with a stored explanation. */
async function seedReviewedGame(ownerId: string): Promise<string> {
  await harness.db
    .insert(user)
    .values([
      { id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true },
      { id: OTHER, name: 'Other', email: 'other@example.com', emailVerified: true },
    ])
    .onConflictDoNothing();
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .returning({ id: player.id });
  const [created] = await harness.db
    .insert(game)
    .values({
      playerId: row!.id,
      stream: 'tournament',
      source: 'pgn_upload',
      pgnHash: `hash_${ownerId}`,
      pgn: '[Result "0-1"]\n\n1. e4 e5 2. Nf3 Qf6 3. Nc3 Qxf3 0-1',
      result: '0-1',
      playerColor: 'black',
      analysisStatus: 'complete',
      whiteName: 'Magness C',
      blackName: 'Test Player',
    })
    .returning({ id: game.id });
  const gameId = created!.id;

  await harness.db.insert(movePly).values([
    {
      gameId,
      ply: 6,
      san: 'Qf6',
      uci: 'd8f6',
      fenBefore: FEN,
      phase: 'opening',
      evalCp: 30,
      evalMate: null,
      bestMoveSan: 'Nc6',
      bestMoveUci: 'b8c6',
      clockMs: null,
      moveTimeMs: null,
    },
    {
      gameId,
      ply: 8,
      san: 'Qxf3',
      uci: 'f6f3',
      fenBefore: FEN,
      phase: 'opening',
      evalCp: -200,
      evalMate: null,
      bestMoveSan: 'd6',
      bestMoveUci: 'd7d6',
      clockMs: null,
      moveTimeMs: null,
    },
  ]);

  await harness.db.insert(mistake).values({
    gameId,
    ply: 6,
    moveNumber: 3,
    movingColor: 'black',
    phase: 'opening',
    fen: FEN,
    moveSan: 'Qf6',
    bestMoveSan: 'Nc6',
    evalBeforeCp: 30,
    evalBeforeMate: null,
    evalAfterCp: -200,
    evalAfterMate: null,
    judgement: 'blunder',
    cpLoss: 230,
    winProbDrop: 0.4,
    motif: 'hanging_piece',
    explanation: 'The queen was already attacked; this hangs it for nothing.',
  });

  return gameId;
}

async function createLink(
  gameId: string,
  options: { as?: string | null; expiresAt?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app(options.as === undefined ? OWNER : options.as).request(
    `/games/${gameId}/share-links`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
    },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /games/{gameId}/share-links', () => {
  test('creates a link with a token and the shared URL', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const { status, body } = await createLink(gameId);
    expect(status).toBe(201);
    expect(body.token).toEqual(expect.any(String));
    expect(body.url).toMatch(new RegExp(`/shared/games/${String(body.token)}$`));
    expect(body.revokedAt).toBeNull();
    expect(body.expiresAt).toBeNull();
  });

  test('answers 401 with no session', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const { status } = await createLink(gameId, { as: null });
    expect(status).toBe(401);
  });

  test('answers 403 for a game belonging to another account', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const { status } = await createLink(gameId, { as: OTHER });
    expect(status).toBe(403);
  });

  test('answers 404 for a game that does not exist', async () => {
    await seedReviewedGame(OWNER);
    const { status } = await createLink('00000000-0000-4000-8000-000000000000');
    expect(status).toBe(404);
  });
});

describe('GET /games/{gameId}/share-links', () => {
  test('lists live links, newest first, and drops revoked ones', async () => {
    const gameId = await seedReviewedGame(OWNER);
    expect((await app(OWNER).request(`/games/${gameId}/share-links`)).status).toBe(200);
    const first = await createLink(gameId);
    const second = await createLink(gameId);

    const revokeRes = await app(OWNER).request(
      `/games/${gameId}/share-links/${String(second.body.id)}`,
      { method: 'DELETE' },
    );
    expect(revokeRes.status).toBe(204);

    const list = await app(OWNER).request(`/games/${gameId}/share-links`);
    const body = (await list.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(String(body[0]!.id)).toBe(String(first.body.id));
  });

  test('answers 403 for another account', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const res = await app(OTHER).request(`/games/${gameId}/share-links`);
    expect(res.status).toBe(403);
  });
});

describe('GET /shared/games/{token}', () => {
  test('serves exactly one reviewed game and nothing else', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const { body } = await createLink(gameId);

    const res = await app(null).request(`/shared/games/${String(body.token)}`);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as Record<string, unknown>;
    // The key set is the contract: the game and nothing beyond it. No player
    // or game id, no stream, no account fields, and no coach prose.
    expect(Object.keys(payload).sort()).toEqual(
      ['blackName', 'mistakes', 'playerColor', 'plies', 'result', 'whiteName'].sort(),
    );
    expect(payload.whiteName).toBe('Magness C');
    expect(payload.blackName).toBe('Test Player');
    expect(payload.result).toBe('0-1');
    expect(payload.playerColor).toBe('black');
    const plies = payload.plies as Array<Record<string, unknown>>;
    expect(plies).toHaveLength(2);
    expect(plies[0]!.bestMoveUci).toBe('b8c6');
    const mistakes = payload.mistakes as Array<Record<string, unknown>>;
    expect(mistakes).toHaveLength(1);
    expect(Object.keys(mistakes[0]!)).not.toContain('explanation');
    expect(mistakes[0]!.cpLoss).toBe(230);
  });

  test('answers the same 404 for unknown, revoked, and expired tokens', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const unknown = await app(null).request(`/shared/games/${'x'.repeat(43)}`);
    expect(unknown.status).toBe(404);
    const unknownBody = (await unknown.json()) as Record<string, unknown>;

    const expired = await createLink(gameId, { expiresAt: '2020-01-01T00:00:00.000Z' });
    const expiredRes = await app(null).request(`/shared/games/${String(expired.body.token)}`);
    expect(expiredRes.status).toBe(404);
    expect(await expiredRes.json()).toEqual(unknownBody);

    const created = await createLink(gameId);
    await harness.db
      .update(gameShareLink)
      .set({ revokedAt: new Date() })
      .where(eq(gameShareLink.token, String(created.body.token)));
    const revokedRes = await app(null).request(`/shared/games/${String(created.body.token)}`);
    expect(revokedRes.status).toBe(404);
    expect(await revokedRes.json()).toEqual(unknownBody);
  });
});

describe('DELETE /games/{gameId}/share-links/{shareLinkId}', () => {
  test('revokes for the owner and refuses everyone else', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const { body } = await createLink(gameId);
    const linkId = String(body.id);

    const stranger = await app(OTHER).request(`/games/${gameId}/share-links/${linkId}`, {
      method: 'DELETE',
    });
    expect(stranger.status).toBe(403);

    // A link id from another game answers 404 rather than revoking across games.
    const crossGame = await app(OWNER).request(
      `/games/00000000-0000-4000-8000-000000000000/share-links/${linkId}`,
      { method: 'DELETE' },
    );
    expect(crossGame.status).toBe(404);

    const res = await app(OWNER).request(`/games/${gameId}/share-links/${linkId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    const [row] = await harness.db
      .select({ revokedAt: gameShareLink.revokedAt })
      .from(gameShareLink)
      .where(eq(gameShareLink.id, linkId));
    expect(row!.revokedAt).not.toBeNull();
  });

  test('answers 404 for an unknown link', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const res = await app(OWNER).request(
      `/games/${gameId}/share-links/00000000-0000-4000-8000-000000000000`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);
  });
});
