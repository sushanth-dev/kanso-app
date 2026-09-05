/**
 * ST-080, ADR-0018, ST-111. The explanation and Socratic-question endpoints.
 * Both call sites share one shape: load the mistake, check ownership through
 * its game, serve the stored text if it is already generated, and otherwise
 * generate once and cache the result on the mistake row. Generation needs a
 * model (ST-130): with none configured the route answers 503
 * `model_unavailable` before the budget check, because no plan buys a model
 * back, and a cached text still serves. Nothing is generated during
 * analysis; most analyzed mistakes are never opened. The budget counts each
 * generated text as 1 and reads stored rows, so a failed generation consumes
 * nothing (ST-111).
 *
 * A failed model call is a 502, never a fallback to canned text (ADR-0018):
 * a player reading plausible generic prose about a mistake they did not make
 * is worse than a player seeing the numbers with an explanation still
 * loading.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getExplanation, getSocraticQuestion } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, mistake } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { coachBudget, coachRemaining } from '../billing/entitlement.ts';
import type { AiClient, MistakeFacts } from './zai.ts';

type Db = PostgresJsDatabase<typeof schema>;
type MistakeRow = typeof mistake.$inferSelect;
type GameRow = typeof game.$inferSelect;

function factsFrom(m: MistakeRow, g: GameRow): MistakeFacts {
  return {
    moveNumber: m.moveNumber,
    movingColor: m.movingColor,
    phase: m.phase,
    moveSan: m.moveSan,
    bestMoveSan: m.bestMoveSan,
    judgement: m.judgement,
    evalBeforeCp: m.evalBeforeCp,
    evalBeforeMate: m.evalBeforeMate,
    evalAfterCp: m.evalAfterCp,
    evalAfterMate: m.evalAfterMate,
    cpLoss: m.cpLoss,
    motif: m.motif,
    opening: g.opening,
    eco: g.eco,
  };
}

export type OwnedMistake = { mistake: MistakeRow; game: GameRow; userId: string };
export type LoadError = { status: 401 | 403 | 404; body: { code: string; message: string } };

/**
 * Shared by every mistake-scoped coaching route (explanation, Socratic
 * question, CCT scan): load the mistake, and check ownership through its
 * game the same way `getGame` does.
 */
export async function loadOwnedMistake(
  db: Db,
  getSession: (c: Context) => unknown,
  c: Context,
  mistakeId: string,
): Promise<OwnedMistake | LoadError> {
  const session = await readSession(getSession, c);
  if (session === null) {
    return { status: 401, body: { code: 'no_session', message: 'Sign in to use this endpoint.' } };
  }

  const [mistakeRow] = await db.select().from(mistake).where(eq(mistake.id, mistakeId)).limit(1);
  if (mistakeRow === undefined) {
    return { status: 404, body: { code: 'not_found', message: 'No such mistake.' } };
  }

  const [gameRow] = await db.select().from(game).where(eq(game.id, mistakeRow.gameId)).limit(1);
  if (gameRow === undefined || !(await hasPlayerClaim(db, session.userId, gameRow.playerId))) {
    return { status: 403, body: { code: 'forbidden', message: 'Not your mistake.' } };
  }

  return { mistake: mistakeRow, game: gameRow, userId: session.userId };
}

/**
 * ST-111. The plan's coach budget as a refusal, or `null` when the account
 * may still generate. Fires only on the generate path; cached re-reads are
 * free.
 */
async function coachBudgetExhausted(db: Db, userId: string): Promise<LoadError | null> {
  if ((await coachRemaining(db, userId)) === 0) {
    return {
      status: 403,
      body: {
        code: 'upgrade_required',
        message: 'You have used all your coach explanations for this month. Upgrade for more.',
      },
    };
  }
  return null;
}

export function mountExplanation(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; aiClient: AiClient | null },
): void {
  app.openapi(getExplanation, async (c) => {
    const { mistakeId } = c.req.valid('param');
    const loaded = await loadOwnedMistake(deps.db, deps.getSession, c, mistakeId);
    if ('status' in loaded) return c.json(loaded.body, loaded.status);

    // ST-128. The budget counter rides every explanation response. On the
    // generate path it is read after the store, so the generation this
    // response delivered is already counted; on a cached re-read nothing
    // stored, and the read is free.
    const counterFields = async () => {
      const budget = await coachBudget(deps.db, loaded.userId);
      return { remaining: budget?.remaining ?? null, monthlyCap: budget?.cap ?? null };
    };

    if (loaded.mistake.explanation !== null) {
      return c.json(
        {
          mistakeId,
          text: loaded.mistake.explanation,
          generatedAt: loaded.mistake.explanationGeneratedAt!.toISOString(),
          ...(await counterFields()),
        },
        200,
      );
    }

    // ST-130. Generation needs a model; without one the answer is a declared
    // 503, not the 404 of an unmounted route, and it precedes the budget
    // check: no plan buys a model back, so upgrade_required would mislead.
    if (deps.aiClient === null) {
      return c.json(
        { code: 'model_unavailable', message: 'The coach is not available right now.' },
        503,
      );
    }

    const exhausted = await coachBudgetExhausted(deps.db, loaded.userId);
    if (exhausted !== null) return c.json(exhausted.body, exhausted.status);
    let text: string;
    try {
      text = await deps.aiClient.explainMistake(factsFrom(loaded.mistake, loaded.game));
    } catch {
      return c.json({ code: 'model_call_failed', message: 'The model call failed. Retry.' }, 502);
    }

    const generatedAt = new Date();
    await deps.db
      .update(mistake)
      .set({ explanation: text, explanationGeneratedAt: generatedAt })
      .where(eq(mistake.id, mistakeId));

    return c.json(
      { mistakeId, text, generatedAt: generatedAt.toISOString(), ...(await counterFields()) },
      200,
    );
  });
}

export function mountSocraticQuestion(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; aiClient: AiClient | null },
) {
  app.openapi(getSocraticQuestion, async (c) => {
    const { mistakeId } = c.req.valid('param');
    const loaded = await loadOwnedMistake(deps.db, deps.getSession, c, mistakeId);
    if ('status' in loaded) return c.json(loaded.body, loaded.status);

    if (loaded.mistake.socraticQuestion !== null) {
      return c.json(
        {
          mistakeId,
          question: loaded.mistake.socraticQuestion,
          generatedAt: loaded.mistake.socraticQuestionGeneratedAt!.toISOString(),
        },
        200,
      );
    }

    if (deps.aiClient === null) {
      return c.json(
        { code: 'model_unavailable', message: 'The coach is not available right now.' },
        503,
      );
    }

    const budget = await coachBudgetExhausted(deps.db, loaded.userId);
    if (budget !== null) return c.json(budget.body, budget.status);
    let question: string;
    try {
      question = await deps.aiClient.askSocraticQuestion(factsFrom(loaded.mistake, loaded.game));
    } catch {
      return c.json({ code: 'model_call_failed', message: 'The model call failed. Retry.' }, 502);
    }

    const generatedAt = new Date();
    await deps.db
      .update(mistake)
      .set({ socraticQuestion: question, socraticQuestionGeneratedAt: generatedAt })
      .where(eq(mistake.id, mistakeId));

    return c.json({ mistakeId, question, generatedAt: generatedAt.toISOString() }, 200);
  });
}
