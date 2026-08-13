import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
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
});

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
  });
}

async function patch(userId: string | null, gameId: string, body: unknown) {
  return app(userId).request(`/games/${gameId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A player owned by `ownerId`, with one stored game whose side was not decided. */
async function seedUndecidedGame(ownerId: string): Promise<string> {
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
      pgn: '[Result "1-0"]\n\n1. e4 e5 1-0',
      result: '1-0',
    })
    .returning({ id: game.id });
  return created!.id;
}

describe('PATCH /games/{gameId}', () => {
  test('sets the side the player was on and returns the game', async () => {
    const gameId = await seedUndecidedGame(OWNER);
    const res = await patch(OWNER, gameId, { playerColor: 'black' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; playerColor: string };
    expect(body.id).toBe(gameId);
    expect(body.playerColor).toBe('black');

    const [row] = await harness.sql`SELECT player_color FROM game WHERE id = ${gameId}`;
    expect(row!.player_color).toBe('black');
  });

  test('rejects a colour the contract does not define', async () => {
    const gameId = await seedUndecidedGame(OWNER);
    const res = await patch(OWNER, gameId, { playerColor: 'green' });
    expect(res.status).toBe(400);
    const [row] = await harness.sql`SELECT player_color FROM game WHERE id = ${gameId}`;
    expect(row!.player_color).toBeNull();
  });

  test('answers 401 with no session', async () => {
    const gameId = await seedUndecidedGame(OWNER);
    const res = await patch(null, gameId, { playerColor: 'white' });
    expect(res.status).toBe(401);
    const [row] = await harness.sql`SELECT player_color FROM game WHERE id = ${gameId}`;
    expect(row!.player_color).toBeNull();
  });

  test('answers 403 for a game belonging to another account’s player', async () => {
    const gameId = await seedUndecidedGame(OWNER);
    const res = await patch(OTHER, gameId, { playerColor: 'white' });
    expect(res.status).toBe(403);
    const [row] = await harness.sql`SELECT player_color FROM game WHERE id = ${gameId}`;
    expect(row!.player_color).toBeNull();
  });

  test('answers 404 for a game that does not exist', async () => {
    await seedUndecidedGame(OWNER);
    const res = await patch(OWNER, '00000000-0000-4000-8000-000000000000', {
      playerColor: 'white',
    });
    expect(res.status).toBe(404);
  });

  test('overwrites a colour the importer had already decided', async () => {
    const gameId = await seedUndecidedGame(OWNER);
    await patch(OWNER, gameId, { playerColor: 'white' });
    const res = await patch(OWNER, gameId, { playerColor: 'black' });
    expect(res.status).toBe(200);
    const [row] = await harness.sql`SELECT player_color FROM game WHERE id = ${gameId}`;
    expect(row!.player_color).toBe('black');
  });
});
