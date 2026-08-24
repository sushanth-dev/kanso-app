import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, mistake, movePly, player, report, weakness } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3';

const sessionFor = (userId: string) => () => ({ userId });

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

/** The session's player id for `ownerId`, creating the player row if needed. */
async function playerIdFor(ownerId: string): Promise<string> {
  const [existing] = await harness.db
    .select({ id: player.id })
    .from(player)
    .where(eq(player.ownerUserId, ownerId))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Sushanth Kamabathula' })
    .returning({ id: player.id });
  return row!.id;
}

let seq = 0;

/** A player and an analyzed game (two plies, one mistake), owned by `ownerId`. */
async function seedReviewedGame(ownerId: string): Promise<{ playerId: string; gameId: string }> {
  await harness.db
    .insert(user)
    .values([
      { id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true },
      { id: OTHER, name: 'Other', email: 'other@example.com', emailVerified: true },
    ])
    .onConflictDoNothing();
  const playerId = await playerIdFor(ownerId);
  seq += 1;
  const [created] = await harness.db
    .insert(game)
    .values({
      playerId,
      stream: 'tournament',
      source: 'pgn_upload',
      pgnHash: `hash_${ownerId}_${seq}`,
      pgn: '[Result "0-1"]\n\n1. e4 e5 2. Nf3 Qf6 3. Nc3 Qxf3 0-1',
      result: '0-1',
      playerColor: 'black',
      analysisStatus: 'complete',
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
  });

  return { playerId, gameId };
}

describe('DELETE /games/{gameId}', () => {
  test('deletes the game and its per-game analysis rows', async () => {
    const { gameId } = await seedReviewedGame(OWNER);
    const res = await app(OWNER).request(`/games/${gameId}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const [g] = await harness.db.select().from(game).where(eq(game.id, gameId));
    expect(g).toBeUndefined();
    const [m] = await harness.db.select().from(movePly).where(eq(movePly.gameId, gameId));
    expect(m).toBeUndefined();
    const [mk] = await harness.db.select().from(mistake).where(eq(mistake.gameId, gameId));
    expect(mk).toBeUndefined();
  });

  test('answers 401 with no session', async () => {
    const { gameId } = await seedReviewedGame(OWNER);
    const res = await app(null).request(`/games/${gameId}`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  test('answers 403 for a game belonging to another account’s player', async () => {
    const { gameId } = await seedReviewedGame(OWNER);
    const res = await app(OTHER).request(`/games/${gameId}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  test('answers 404 for a game that does not exist', async () => {
    await seedReviewedGame(OWNER);
    const res = await app(OWNER).request('/games/00000000-0000-4000-8000-000000000000', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  test('deleting one of several games leaves the others and their rows intact', async () => {
    const { gameId: first } = await seedReviewedGame(OWNER);
    const { gameId: second } = await seedReviewedGame(OWNER);

    const res = await app(OWNER).request(`/games/${first}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const [g] = await harness.db.select().from(game).where(eq(game.id, second));
    expect(g).toBeDefined();
    const [m] = await harness.db.select().from(movePly).where(eq(movePly.gameId, second));
    expect(m).toBeDefined();
  });

  test('a stored report for the remaining games stays intact', async () => {
    const { playerId } = await seedReviewedGame(OWNER);
    const [rep] = await harness.db
      .insert(report)
      .values({ playerId, stream: 'tournament', gamesCovered: 1 })
      .returning({ id: report.id });
    await harness.db.insert(weakness).values({
      reportId: rep!.id,
      kind: 'phase',
      label: 'Middlegame',
      ratingLeak: 96,
      halfPointsLost: 1,
      gamesAffected: 1,
      occurrences: 1,
      rank: 1,
    });

    const { gameId } = await seedReviewedGame(OWNER);
    const res = await app(OWNER).request(`/games/${gameId}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const [still] = await harness.db.select().from(report).where(eq(report.id, rep!.id));
    expect(still).toBeDefined();
    const [w] = await harness.db.select().from(weakness).where(eq(weakness.reportId, rep!.id));
    expect(w).toBeDefined();
  });
});
