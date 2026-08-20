import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, mistake, movePly, player } from '../db/schema.ts';
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

/** A player, an analyzed game, two plies and one mistake, all owned by `ownerId`. */
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
    .values({ ownerUserId: ownerId, displayName: 'Sushanth Kamabathula' })
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

  return gameId;
}

describe('GET /games/{gameId}', () => {
  test('returns the game with plies and mistakes', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const res = await app(OWNER).request(`/games/${gameId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      pgn: string;
      result: string;
      playerColor: string;
      plies: { ply: number; uci: string; bestMoveUci: string | null }[];
      mistakes: { ply: number; bestMoveSan: string; cpLoss: number; explanation: string | null }[];
    };
    expect(body.id).toBe(gameId);
    expect(body.pgn).toContain('0-1');
    expect(body.result).toBe('0-1');
    expect(body.playerColor).toBe('black');
    expect(body.plies).toHaveLength(2);
    expect(body.plies[0]).toMatchObject({ ply: 6, uci: 'd8f6', bestMoveUci: 'b8c6' });
    expect(body.plies[1]).toMatchObject({ ply: 8, bestMoveUci: 'd7d6' });
    expect(body.mistakes).toHaveLength(1);
    expect(body.mistakes[0]).toMatchObject({
      ply: 6,
      bestMoveSan: 'Nc6',
      cpLoss: 230,
      explanation: null,
    });
  });

  test('answers 401 with no session', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const res = await app(null).request(`/games/${gameId}`);
    expect(res.status).toBe(401);
  });

  test('answers 403 for a game belonging to another account’s player', async () => {
    const gameId = await seedReviewedGame(OWNER);
    const res = await app(OTHER).request(`/games/${gameId}`);
    expect(res.status).toBe(403);
  });

  test('answers 404 for a game that does not exist', async () => {
    await seedReviewedGame(OWNER);
    const res = await app(OWNER).request('/games/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});
