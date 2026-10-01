/**
 * ST-158. The fallback paths of the engine-reply endpoint: the opponent's
 * reply when the player has left the game's rails, and the game already being
 * over. The engine is a stub through the `search` seam, mounted directly
 * because `createApp` does not thread the seam (production passes nothing and
 * runs the real WASM engine).
 */
import type { Context } from 'hono';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { game, mistake, movePly, patternState, player, weakness } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { mountEngineReply, type EngineSearch } from './engine-reply.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';

// The game: 1. f3 e5 2. g4 Qh4# 0-1. The player is black; ply 4 (Qh4#) ends
// the game. From ply 3 (after g4) a finish session leaves the rails with the
// player's own continuation, and the opponent answers from the engine.
const RAILS = [
  { ply: 1, san: 'f3' },
  { ply: 2, san: 'e5' },
  { ply: 3, san: 'g4' },
  { ply: 4, san: 'Qh4#' },
];

const search: EngineSearch = vi.fn(() =>
  Promise.resolve({ score: { cp: 45, mate: null }, bestMoveUci: 'a2a3' }),
);

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  vi.mocked(search).mockClear();
});

function appWithSearch(userId: string) {
  const app = new OpenAPIHono();
  mountEngineReply(app, {
    db: harness.db,
    getSession: (() => ({ userId })) as (c: Context) => unknown,
    search,
  });
  return app;
}

let seq = 0;

async function seedGame(ownerId: string): Promise<{ playerId: string; gameId: string }> {
  await harness.db
    .insert(user)
    .values([{ id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true }])
    .onConflictDoNothing();
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Owner' })
    .returning({ id: player.id });
  seq += 1;
  const [created] = await harness.db
    .insert(game)
    .values({
      playerId: row!.id,
      stream: 'tournament',
      source: 'pgn_upload',
      pgnHash: `hash_${ownerId}_${seq}`,
      pgn: '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
      result: '0-1',
      playerColor: 'black',
      analysisStatus: 'complete',
    })
    .returning({ id: game.id });
  await harness.db
    .insert(movePly)
    .values(RAILS.map((r) => ({ gameId: created!.id, ...r, uci: '0000', fenBefore: 'x' })));
  return { playerId: row!.id, gameId: created!.id };
}

// A game whose PGN declares a starting FEN: 1. Kg6 is legal from that board
// and impossible from the standard start, which is how a replay bug shows.
const FEN_RAILS = [{ ply: 1, san: 'Kg6' }];
const FEN_PGN = '[SetUp "1"]\n[FEN "7k/8/5K1P/8/8/8/8/8 w - - 0 1"]\n\n1. Kg6 *';

async function seedFenGame(ownerId: string): Promise<string> {
  await harness.db
    .insert(user)
    .values([{ id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true }])
    .onConflictDoNothing();
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Owner' })
    .returning({ id: player.id });
  const [created] = await harness.db
    .insert(game)
    .values({
      playerId: row!.id,
      stream: 'tournament',
      source: 'pgn_upload',
      pgnHash: 'fen-game',
      pgn: FEN_PGN,
      result: '*',
      playerColor: 'white',
      analysisStatus: 'complete',
    })
    .returning({ id: game.id });
  await harness.db
    .insert(movePly)
    .values(FEN_RAILS.map((r) => ({ gameId: created!.id, ...r, uci: 'f6g6', fenBefore: 'x' })));
  return created!.id;
}

describe('POST /games/{gameId}/engine-reply (fallback)', () => {
  test('answers one engine reply when the player leaves the rails', async () => {
    const { gameId } = await seedGame(OWNER);
    const res = await appWithSearch(OWNER).request(`/games/${gameId}/engine-reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ railPly: 3, playerMoves: ['Nc6'] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'reply',
      move: { san: 'a3', uci: 'a2a3' },
      evaluation: { cp: 45, mate: null },
    });
    expect(search).toHaveBeenCalledOnce();
  });

  test('answers game_over without searching when the position is finished', async () => {
    const { gameId } = await seedGame(OWNER);
    const res = await appWithSearch(OWNER).request(`/games/${gameId}/engine-reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ railPly: 4, playerMoves: [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'game_over', move: null, evaluation: null });
    expect(search).not.toHaveBeenCalled();
  });

  test('records nothing in the verdict, pattern, or streak state', async () => {
    const { playerId, gameId } = await seedGame(OWNER);
    const patternCounts = async () => ({
      mistakes: (await harness.db.select({ n: sql<number>`count(*)::int` }).from(mistake))[0]!.n,
      weaknesses: (await harness.db.select({ n: sql<number>`count(*)::int` }).from(weakness))[0]!.n,
      patterns: (await harness.db.select({ n: sql<number>`count(*)::int` }).from(patternState))[0]!
        .n,
    });

    const before = await patternCounts();
    const [playerBefore] = await harness.db
      .select({ streak: player.currentStreak, xp: player.xp, last: player.lastActivityDate })
      .from(player)
      .where(eq(player.id, playerId));

    await appWithSearch(OWNER).request(`/games/${gameId}/engine-reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ railPly: 3, playerMoves: ['Nc6'] }),
    });

    const after = await patternCounts();
    expect(after).toEqual(before);
    const [playerAfter] = await harness.db
      .select({ streak: player.currentStreak, xp: player.xp, last: player.lastActivityDate })
      .from(player)
      .where(eq(player.id, playerId));
    expect(playerAfter).toEqual(playerBefore);
  });

  test('replays a FEN-setup game from its declared board, not the standard start', async () => {
    const gameId = await seedFenGame(OWNER);
    const fenSearch: EngineSearch = vi.fn(() =>
      Promise.resolve({ score: { cp: -300, mate: null }, bestMoveUci: 'h8g8' }),
    );
    const app = new OpenAPIHono();
    mountEngineReply(app, {
      db: harness.db,
      getSession: (() => ({ userId: OWNER })) as (c: Context) => unknown,
      search: fenSearch,
    });

    // 1. Kg6 is only legal from the FEN board: before the fix the replay
    // started from the standard start, the rail was illegal, and this
    // answered bad_move instead of the opponent's reply.
    const res = await app.request(`/games/${gameId}/engine-reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ railPly: 1, playerMoves: [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'reply',
      move: { san: 'Kg8', uci: 'h8g8' },
    });
  });
});
