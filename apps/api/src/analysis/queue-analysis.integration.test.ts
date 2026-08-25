import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
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

let seq = 0;

/** A player and a failed game (the Retry target), owned by `ownerId`. */
async function seedFailedGame(ownerId: string): Promise<string> {
  await harness.db
    .insert(user)
    .values([
      { id: OWNER, name: 'Owner', email: 'owner@example.com', emailVerified: true },
      { id: OTHER, name: 'Other', email: 'other@example.com', emailVerified: true },
    ])
    .onConflictDoNothing();
  const [p] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Test Player' })
    .returning({ id: player.id });
  seq += 1;
  const [g] = await harness.db
    .insert(game)
    .values({
      playerId: p!.id,
      stream: 'tournament',
      source: 'pgn_upload',
      pgnHash: `hash_${ownerId}_${seq}`,
      pgn: '[Result "0-1"]\n\n1. e4 e5 0-1',
      result: '0-1',
      playerColor: 'black',
      analysisStatus: 'failed',
      analysisError: 'no moves',
    })
    .returning({ id: game.id });
  return g!.id;
}

describe('POST /games/{gameId}/analysis', () => {
  test('re-queues a failed game and marks it queued', async () => {
    const gameId = await seedFailedGame(OWNER);
    const res = await app(OWNER).request(`/games/${gameId}/analysis`, { method: 'POST' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { gameId: string; status: string };
    expect(body.status).toBe('queued');

    const [g] = await harness.db.select().from(game).where(eq(game.id, gameId));
    expect(g!.analysisStatus).toBe('queued');
    expect(g!.analysisError).toBeNull();
  });

  test('answers 409 for a game already queued or analysing', async () => {
    const gameId = await seedFailedGame(OWNER);
    await harness.db.update(game).set({ analysisStatus: 'analyzing' }).where(eq(game.id, gameId));
    const res = await app(OWNER).request(`/games/${gameId}/analysis`, { method: 'POST' });
    expect(res.status).toBe(409);
  });

  test('answers 401 with no session', async () => {
    const gameId = await seedFailedGame(OWNER);
    const res = await app(null).request(`/games/${gameId}/analysis`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  test('answers 403 for a game belonging to another account’s player', async () => {
    const gameId = await seedFailedGame(OWNER);
    const res = await app(OTHER).request(`/games/${gameId}/analysis`, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  test('answers 404 for a game that does not exist', async () => {
    await seedFailedGame(OWNER);
    const res = await app(OWNER).request('/games/00000000-0000-4000-8000-000000000000/analysis', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });
});
