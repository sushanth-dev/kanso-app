import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { game, mistake, player } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { AiClient } from './zai.ts';

let harness: IntegrationDatabase;
const OWNER = 'user_owner';
const OTHER = 'user_other';

const sessionFor = (userId: string) => () => ({ userId });

let explainCalls = 0;
let questionCalls = 0;
let fail = false;
const aiClient: AiClient = {
  explainMistake() {
    explainCalls += 1;
    if (fail) return Promise.reject(new Error('model down'));
    return Promise.resolve('You left your knight hanging on d5.');
  },
  askSocraticQuestion() {
    questionCalls += 1;
    if (fail) return Promise.reject(new Error('model down'));
    return Promise.resolve('What was defending d5 before your move?');
  },
  adviseWeaknesses() {
    return Promise.reject(new Error('not used here'));
  },
  summarizeReport() {
    return Promise.reject(new Error('not used here'));
  },
  verifyAdviceSummary() {
    return Promise.reject(new Error('not used here'));
  },
};

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  explainCalls = 0;
  questionCalls = 0;
  fail = false;
});

function app(userId: string | null) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
    aiClient,
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
      opening: 'Sicilian Defense',
      eco: 'B20',
    })
    .returning({ id: game.id });
  const [createdMistake] = await harness.db
    .insert(mistake)
    .values({
      gameId: createdGame!.id,
      ply: 6,
      moveNumber: 3,
      movingColor: 'black',
      phase: 'opening',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3',
      moveSan: 'Qf6',
      bestMoveSan: 'Nc6',
      evalBeforeCp: 30,
      evalAfterCp: -200,
      judgement: 'blunder',
      cpLoss: 230,
      winProbDrop: 0.4,
      motif: 'hanging_piece',
    })
    .returning({ id: mistake.id });
  return createdMistake!.id;
}

describe('GET /mistakes/{mistakeId}/explanation', () => {
  test('401 without a session', async () => {
    const mistakeId = await seedMistake(OWNER);
    const res = await app(null).request(`/mistakes/${mistakeId}/explanation`);
    expect(res.status).toBe(401);
  });

  test("403 for a mistake on someone else's game", async () => {
    const mistakeId = await seedMistake(OWNER);
    const res = await app(OTHER).request(`/mistakes/${mistakeId}/explanation`);
    expect(res.status).toBe(403);
  });

  test('404 for a mistake that does not exist', async () => {
    await seedMistake(OWNER);
    const res = await app(OWNER).request(
      '/mistakes/00000000-0000-0000-0000-000000000000/explanation',
    );
    expect(res.status).toBe(404);
  });

  test('generates on first read and caches on the mistake row', async () => {
    const mistakeId = await seedMistake(OWNER);

    const first = await app(OWNER).request(`/mistakes/${mistakeId}/explanation`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { text: string; generatedAt: string };
    expect(firstBody.text).toBe('You left your knight hanging on d5.');
    expect(explainCalls).toBe(1);

    const [row] = await harness.db.select().from(mistake).where(eq(mistake.id, mistakeId));
    expect(row!.explanation).toBe('You left your knight hanging on d5.');
    expect(row!.explanationGeneratedAt).not.toBeNull();

    const second = await app(OWNER).request(`/mistakes/${mistakeId}/explanation`);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { text: string };
    expect(secondBody.text).toBe('You left your knight hanging on d5.');
    // Served from storage the second time; the model is called exactly once.
    expect(explainCalls).toBe(1);
  });

  test('502 when the model call fails, and nothing is cached', async () => {
    fail = true;
    const mistakeId = await seedMistake(OWNER);
    const res = await app(OWNER).request(`/mistakes/${mistakeId}/explanation`);
    expect(res.status).toBe(502);

    const [row] = await harness.db.select().from(mistake).where(eq(mistake.id, mistakeId));
    expect(row!.explanation).toBeNull();
  });
});

describe('GET /mistakes/{mistakeId}/question', () => {
  test('generates on first read and caches on the mistake row', async () => {
    const mistakeId = await seedMistake(OWNER);

    const first = await app(OWNER).request(`/mistakes/${mistakeId}/question`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { question: string };
    expect(firstBody.question).toBe('What was defending d5 before your move?');
    expect(questionCalls).toBe(1);

    const second = await app(OWNER).request(`/mistakes/${mistakeId}/question`);
    expect(second.status).toBe(200);
    expect(questionCalls).toBe(1);
  });

  test("403 for a mistake on someone else's game", async () => {
    const mistakeId = await seedMistake(OWNER);
    const res = await app(OTHER).request(`/mistakes/${mistakeId}/question`);
    expect(res.status).toBe(403);
  });
});
