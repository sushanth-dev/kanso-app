import type { Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, mistake, player } from '../db/schema.ts';
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

/** A player, an analyzed game and one mistake, owned by `ownerId`. */
async function seedMistake(ownerId: string): Promise<string> {
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
  const [createdGame] = await harness.db
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
  const [createdMistake] = await harness.db
    .insert(mistake)
    .values({
      gameId: createdGame!.id,
      ply: 6,
      moveNumber: 3,
      movingColor: 'white',
      phase: 'opening',
      // White queen a1 has Qd1+ (check along the d-file) and Qxb2 (capture),
      // so both the checks and captures groups have at least one entry.
      fen: '3k4/8/8/8/8/8/1p6/Q3K3 w - - 0 1',
      moveSan: 'Qxb2',
      bestMoveSan: 'Qd1+',
      evalBeforeCp: 30,
      evalAfterCp: -200,
      judgement: 'blunder',
      cpLoss: 230,
      winProbDrop: 0.4,
    })
    .returning({ id: mistake.id });
  return createdMistake!.id;
}

describe('GET /mistakes/{mistakeId}/cct', () => {
  test('401 without a session', async () => {
    const mistakeId = await seedMistake(OWNER);
    const res = await app(null).request(`/mistakes/${mistakeId}/cct`);
    expect(res.status).toBe(401);
  });

  test("403 for a mistake on someone else's game", async () => {
    const mistakeId = await seedMistake(OWNER);
    const res = await app(OTHER).request(`/mistakes/${mistakeId}/cct`);
    expect(res.status).toBe(403);
  });

  test('404 for a mistake that does not exist', async () => {
    await seedMistake(OWNER);
    const res = await app(OWNER).request('/mistakes/00000000-0000-0000-0000-000000000000/cct');
    expect(res.status).toBe(404);
  });

  test('enumerates checks and captures from the pre-mistake position', async () => {
    const mistakeId = await seedMistake(OWNER);
    const res = await app(OWNER).request(`/mistakes/${mistakeId}/cct`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mistakeId: string;
      checks: { san: string; type: string; isGoodOption: boolean }[];
      captures: { san: string; type: string }[];
      threats: { san: string; type: string }[];
    };
    expect(body.mistakeId).toBe(mistakeId);
    expect(body.checks.some((m) => m.san === 'Qd1+')).toBe(true);
    expect(body.checks.find((m) => m.san === 'Qd1+')?.isGoodOption).toBe(true);
    expect(body.captures.some((m) => m.san === 'Qxb2')).toBe(true);
  });
});
