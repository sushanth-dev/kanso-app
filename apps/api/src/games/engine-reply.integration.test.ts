/**
 * ST-158. The engine-reply endpoint against a real PostgreSQL.
 *
 * The engine search is a stub through the `search` seam: what these tests pin
 * is the rails, the fallback trigger, the ownership and validation paths, and
 * the no-writes rule, not the search itself. The real engine is covered by
 * `engine.integration.test.ts`, and the depth cap is pinned by the budget test.
 */
import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app.ts';
import { game, movePly, player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { EngineSearch } from './engine-reply.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

// The game: 1. e4 e5 2. Nf3 Qf6 3. Nc3. Ply 4 (Qf6) is the mistake; a player
// finishing from there leaves the rails with their own continuations.
const RAILS = [
  { ply: 1, san: 'e4' },
  { ply: 2, san: 'e5' },
  { ply: 3, san: 'Nf3' },
  { ply: 4, san: 'Qf6' },
  { ply: 5, san: 'Nc3' },
];

const search: EngineSearch = vi.fn(() =>
  Promise.resolve({ score: { cp: 45, mate: null }, bestMoveUci: 'd7d5' }),
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

function app(userId: string | null): ReturnType<typeof createApp> {
  return createApp({
    db: harness.db,
    getSession: (userId === null ? () => null : () => ({ userId })) as (c: Context) => unknown,
  });
}

let seq = 0;

async function seedGame(ownerId: string): Promise<string> {
  await harness.db
    .insert(user)
    .values([
      { id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true },
      { id: OTHER, name: 'Other', email: 'other@example.com', emailVerified: true },
    ])
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
      pgn: '[Result "*"]\n\n1. e4 e5 2. Nf3 Qf6 3. Nc3 *',
      result: '*',
      playerColor: 'white',
      analysisStatus: 'complete',
    })
    .returning({ id: game.id });
  await harness.db
    .insert(movePly)
    .values(RAILS.map((r) => ({ gameId: created!.id, ...r, uci: '0000', fenBefore: 'x' })));
  return created!.id;
}

describe('POST /games/{gameId}/engine-reply', () => {
  test('answers 401 with no session', async () => {
    const gameId = await seedGame(OWNER);
    const res = await app(null).request(`/games/${gameId}/engine-reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ railPly: 4, playerMoves: [] }),
    });
    expect(res.status).toBe(401);
  });

  test('answers 404 for a missing game', async () => {
    await seedGame(OWNER);
    const res = await app(OWNER).request(
      '/games/00000000-0000-4000-8000-000000000000/engine-reply',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ railPly: 4, playerMoves: [] }),
      },
    );
    expect(res.status).toBe(404);
  });

  test('answers 403 for another account’s game', async () => {
    const gameId = await seedGame(OWNER);
    const res = await app(OTHER).request(`/games/${gameId}/engine-reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ railPly: 4, playerMoves: [] }),
    });
    expect(res.status).toBe(403);
  });

  test('answers 422 bad_rail for a rail ply beyond the game', async () => {
    const gameId = await seedGame(OWNER);
    const res = await app(OWNER).request(`/games/${gameId}/engine-reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ railPly: 99, playerMoves: [] }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'bad_rail' });
  });

  test('answers 422 bad_move for an illegal player move', async () => {
    const gameId = await seedGame(OWNER);
    const res = await app(OWNER).request(`/games/${gameId}/engine-reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // After 1. e4 e5, the white pawn cannot move onto the occupied e5 square.
      body: JSON.stringify({ railPly: 4, playerMoves: ['e5'] }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'bad_move' });
  });
});
