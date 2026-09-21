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
 *
 * ST-177. Both texts are held to the facts they were generated from before
 * they are stored, by the rule the report path already applies
 * (`report/advice.ts`): every number and every SAN move in the reply must
 * appear in the fact set the model was given. The ladder is the report's - one
 * attempt, one corrective retry, a thrown call not retried - and a text that
 * fails twice is not stored at all. It is cached prose on a row, so without
 * the check an invented fact is that player's answer on every later read.
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
import { log } from '../logging.ts';
import { checkTextWithinFacts, mistakeFactTokens } from '../report/advice.ts';
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

/**
 * ST-177. The sentence caps, read off the prompts in `zai.ts`: the
 * explanation asks for two or three sentences, the question for one.
 */
const EXPLANATION_MAX_SENTENCES = 3;
const QUESTION_MAX_SENTENCES = 1;

/** ST-177. The text, or the declared refusal to store it. */
type TextOutcome = { text: string } | { refusal: { code: string; message: string } };

/**
 * ST-177. One attempt plus at most one corrective retry, each validated
 * against the facts it was generated from; the report path's ladder. A thrown
 * call is not retried, because a provider that is down should not get a second
 * chance to stall the player. Both refusals are 502s with their own code, so
 * an operator can tell a model that is down from a model that wrote something
 * we will not serve, and neither substitutes prose.
 */
async function generateWithinFacts(
  mistakeId: string,
  kind: 'explanation' | 'question',
  facts: MistakeFacts,
  maxSentences: number,
  generate: () => Promise<string>,
): Promise<TextOutcome> {
  const { numbers, sans } = mistakeFactTokens(facts);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let text: string;
    try {
      text = await generate();
    } catch {
      return {
        refusal: { code: 'model_call_failed', message: 'The model call failed. Retry.' },
      };
    }

    const failure = checkTextWithinFacts(text, numbers, sans, maxSentences);
    if (failure === null) return { text: text.trim() };

    // ST-177. Criterion 5: the rate these lines show is how we learn whether
    // the check is rejecting text a player would have been fine with.
    log('warn', 'coach_text_rejected', {
      mistakeId,
      kind,
      attempt,
      reason: failure.reason,
      ...(failure.reason === 'token' ? { token: failure.token } : {}),
    });
  }

  return {
    refusal: {
      code: 'explanation_unfaithful',
      message: 'The coach wrote something that did not match the facts of your game. Retry.',
    },
  };
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
    const ai = deps.aiClient;
    if (ai === null) {
      return c.json(
        { code: 'model_unavailable', message: 'The coach is not available right now.' },
        503,
      );
    }

    const exhausted = await coachBudgetExhausted(deps.db, loaded.userId);
    if (exhausted !== null) return c.json(exhausted.body, exhausted.status);

    const facts = factsFrom(loaded.mistake, loaded.game);
    const generated = await generateWithinFacts(
      mistakeId,
      'explanation',
      facts,
      EXPLANATION_MAX_SENTENCES,
      () => ai.explainMistake(facts),
    );
    if ('refusal' in generated) return c.json(generated.refusal, 502);
    const text = generated.text;

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

    const ai = deps.aiClient;
    if (ai === null) {
      return c.json(
        { code: 'model_unavailable', message: 'The coach is not available right now.' },
        503,
      );
    }

    const budget = await coachBudgetExhausted(deps.db, loaded.userId);
    if (budget !== null) return c.json(budget.body, budget.status);

    const facts = factsFrom(loaded.mistake, loaded.game);
    const generated = await generateWithinFacts(
      mistakeId,
      'question',
      facts,
      QUESTION_MAX_SENTENCES,
      () => ai.askSocraticQuestion(facts),
    );
    if ('refusal' in generated) return c.json(generated.refusal, 502);
    const question = generated.text;

    const generatedAt = new Date();
    await deps.db
      .update(mistake)
      .set({ socraticQuestion: question, socraticQuestionGeneratedAt: generatedAt })
      .where(eq(mistake.id, mistakeId));

    return c.json({ mistakeId, question, generatedAt: generatedAt.toISOString() }, 200);
  });
}
