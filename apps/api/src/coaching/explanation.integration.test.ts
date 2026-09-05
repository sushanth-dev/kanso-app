import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { coachUnitsThisMonth } from '../billing/entitlement.ts';
import { game, mistake, player, subscription } from '../db/schema.ts';
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
  recommendResources() {
    return Promise.reject(new Error('not used here'));
  },
  verifyResourceAssessment() {
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

function app(userId: string | null, model: AiClient | null = aiClient) {
  return createApp({
    db: harness.db,
    getSession: (userId == null ? () => null : sessionFor(userId)) as (c: Context) => unknown,
    aiClient: model,
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
    .values({ ownerUserId: ownerId, displayName: 'Sushanth Kamabathula' })
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

/**
 * ST-111. One player and N single-mistake games, so a suite can spend the
 * plan's coach budget generation by generation.
 */
async function seedMistakes(ownerId: string, count: number): Promise<string[]> {
  await harness.db
    .insert(user)
    .values({ id: ownerId, name: 'Owner', email: 'owner@example.com', emailVerified: true })
    .onConflictDoNothing();
  const [createdPlayer] = await harness.db
    .insert(player)
    .values({ ownerUserId: ownerId, displayName: 'Sushanth Kamabathula' })
    .returning({ id: player.id });
  const createdGames = await harness.db
    .insert(game)
    .values(
      Array.from({ length: count }, (_, i) => ({
        playerId: createdPlayer!.id,
        stream: 'tournament' as const,
        source: 'pgn_upload' as const,
        pgnHash: `hash_${ownerId}_${i}`,
        pgn: '[Result "0-1"]\n\n1. e4 e5 2. Nf3 Qf6 3. Nc3 Qxf3 0-1',
        result: '0-1' as const,
        playerColor: 'black' as const,
        opening: 'Sicilian Defense',
        eco: 'B20',
      })),
    )
    .returning({ id: game.id });
  const createdMistakes = await harness.db
    .insert(mistake)
    .values(
      createdGames.map((g, _i) => ({
        gameId: g.id,
        ply: 6,
        moveNumber: 3,
        movingColor: 'black' as const,
        phase: 'opening' as const,
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3',
        moveSan: 'Qf6',
        bestMoveSan: 'Nc6',
        evalBeforeCp: 30,
        evalAfterCp: -200,
        judgement: 'blunder' as const,
        cpLoss: 230,
        winProbDrop: 0.4,
        motif: 'hanging_piece',
        explanationGeneratedAt: null,
        socraticQuestionGeneratedAt: null,
      })),
    )
    .returning({ id: mistake.id });
  return createdMistakes.map((m) => m.id);
}

describe('ST-111 plan caps on generated coach texts', () => {
  test('beginner: the 51st generated text is refused before the model is called', async () => {
    const ids = await seedMistakes(OWNER, 51);
    for (const id of ids.slice(0, 50)) {
      const res = await app(OWNER).request(`/mistakes/${id}/explanation`);
      expect(res.status).toBe(200);
    }
    expect(explainCalls).toBe(50);

    const refused = await app(OWNER).request(`/mistakes/${ids[50]}/explanation`);
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as { code: string; message: string };
    expect(body.code).toBe('upgrade_required');
    // The refusal fires on the budget check, so the model is never called.
    expect(explainCalls).toBe(50);
  });

  test('beginner: explanation and question share one budget, two units per mistake', async () => {
    const ids = await seedMistakes(OWNER, 26);
    for (const id of ids.slice(0, 25)) {
      const explanation = await app(OWNER).request(`/mistakes/${id}/explanation`);
      expect(explanation.status).toBe(200);
      const question = await app(OWNER).request(`/mistakes/${id}/question`);
      expect(question.status).toBe(200);
    }
    expect(await coachUnitsThisMonth(harness.db, OWNER)).toBe(50);

    const refusedExplanation = await app(OWNER).request(`/mistakes/${ids[25]}/explanation`);
    expect(refusedExplanation.status).toBe(403);
    const refusedQuestion = await app(OWNER).request(`/mistakes/${ids[25]}/question`);
    expect(refusedQuestion.status).toBe(403);
  });

  test('beginner: cached texts re-read 200 at zero remaining', async () => {
    const ids = await seedMistakes(OWNER, 25);
    for (const id of ids) {
      const explanation = await app(OWNER).request(`/mistakes/${id}/explanation`);
      expect(explanation.status).toBe(200);
      const question = await app(OWNER).request(`/mistakes/${id}/question`);
      expect(question.status).toBe(200);
    }
    // The budget is spent: twenty-five mistakes, two texts each.
    expect(await coachUnitsThisMonth(harness.db, OWNER)).toBe(50);

    // Both stored texts on mistake 0 re-read from storage, never refused.
    const cached = await app(OWNER).request(`/mistakes/${ids[0]}/explanation`);
    expect(cached.status).toBe(200);
    const cachedQuestion = await app(OWNER).request(`/mistakes/${ids[0]}/question`);
    expect(cachedQuestion.status).toBe(200);
    expect(explainCalls).toBe(25);
    expect(questionCalls).toBe(25);
  });

  test('intermediate: refuses at the 101st generated text', async () => {
    const ids = await seedMistakes(OWNER, 101);
    await harness.db.insert(subscription).values({ userId: OWNER, tier: 'intermediate' });
    for (const id of ids.slice(0, 100)) {
      const res = await app(OWNER).request(`/mistakes/${id}/explanation`);
      expect(res.status).toBe(200);
    }
    const refused = await app(OWNER).request(`/mistakes/${ids[100]}/explanation`);
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as { code: string };
    expect(body.code).toBe('upgrade_required');
  });

  test('pro: never refuses', async () => {
    const ids = await seedMistakes(OWNER, 11);
    await harness.db.insert(subscription).values({ userId: OWNER, tier: 'pro' });
    for (const id of ids) {
      const res = await app(OWNER).request(`/mistakes/${id}/explanation`);
      expect(res.status).toBe(200);
    }
    expect(explainCalls).toBe(11);
  });

  test('a failed generation stores nothing and consumes nothing', async () => {
    const [id] = await seedMistakes(OWNER, 1);
    fail = true;
    const failed = await app(OWNER).request(`/mistakes/${id}/explanation`);
    expect(failed.status).toBe(502);
    expect(await coachUnitsThisMonth(harness.db, OWNER)).toBe(0);

    fail = false;
    const retry = await app(OWNER).request(`/mistakes/${id}/explanation`);
    expect(retry.status).toBe(200);
    expect(await coachUnitsThisMonth(harness.db, OWNER)).toBe(1);
  });
});

describe('ST-128 coach budget counter on the explanation response', () => {
  test('beginner: the generation this response delivered is already counted', async () => {
    const [id] = await seedMistakes(OWNER, 1);
    const res = await app(OWNER).request(`/mistakes/${id}/explanation`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { remaining: number | null; monthlyCap: number | null };
    expect(body.monthlyCap).toBe(50);
    expect(body.remaining).toBe(49);
  });

  test('beginner: the cached re-read is free and shows the same count', async () => {
    const [id] = await seedMistakes(OWNER, 1);
    await app(OWNER).request(`/mistakes/${id}/explanation`);
    const cached = await app(OWNER).request(`/mistakes/${id}/explanation`);
    expect(cached.status).toBe(200);
    const body = (await cached.json()) as { remaining: number | null; monthlyCap: number | null };
    expect(body.remaining).toBe(49);
    expect(body.monthlyCap).toBe(50);
    expect(explainCalls).toBe(1);
  });

  test('intermediate: the counter reads the intermediate cap', async () => {
    const [id] = await seedMistakes(OWNER, 1);
    await harness.db.insert(subscription).values({ userId: OWNER, tier: 'intermediate' });
    const res = await app(OWNER).request(`/mistakes/${id}/explanation`);
    const body = (await res.json()) as { remaining: number | null; monthlyCap: number | null };
    expect(body.monthlyCap).toBe(100);
    expect(body.remaining).toBe(99);
  });

  test('pro: both counter fields are null, so no counter renders', async () => {
    const [id] = await seedMistakes(OWNER, 1);
    await harness.db.insert(subscription).values({ userId: OWNER, tier: 'pro' });
    const res = await app(OWNER).request(`/mistakes/${id}/explanation`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { remaining: number | null; monthlyCap: number | null };
    expect(body.remaining).toBeNull();
    expect(body.monthlyCap).toBeNull();
  });
});

describe('ST-130 no model configured', () => {
  test('the coach routes mount and answer 503 model_unavailable to generate', async () => {
    const [id] = await seedMistakes(OWNER, 1);

    const explanation = await app(OWNER, null).request(`/mistakes/${id}/explanation`);
    expect(explanation.status).toBe(503);
    const explanationBody = (await explanation.json()) as { code: string };
    expect(explanationBody.code).toBe('model_unavailable');

    const question = await app(OWNER, null).request(`/mistakes/${id}/question`);
    expect(question.status).toBe(503);
    const questionBody = (await question.json()) as { code: string };
    expect(questionBody.code).toBe('model_unavailable');
  });

  test('an already-generated text serves 200 with no model', async () => {
    const id = await seedMistake(OWNER);
    await harness.db
      .update(mistake)
      .set({ explanation: 'Stored prose.', explanationGeneratedAt: new Date() })
      .where(eq(mistake.id, id));

    const res = await app(OWNER, null).request(`/mistakes/${id}/explanation`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toBe('Stored prose.');
  });

  test('the 503 precedes the budget refusal: an exhausted account is not told to upgrade', async () => {
    const ids = await seedMistakes(OWNER, 51);
    for (const id of ids.slice(0, 50)) {
      const res = await app(OWNER).request(`/mistakes/${id}/explanation`);
      expect(res.status).toBe(200);
    }
    expect(await coachUnitsThisMonth(harness.db, OWNER)).toBe(50);

    const refused = await app(OWNER, null).request(`/mistakes/${ids[50]}/explanation`);
    expect(refused.status).toBe(503);
    const refusedBody = (await refused.json()) as { code: string };
    expect(refusedBody.code).toBe('model_unavailable');
  });
});
