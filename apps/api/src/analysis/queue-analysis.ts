/**
 * The endpoint a player uses to re-queue one game for analysis.
 *
 * F3, N1. Analysis runs on SQS and Lambda (ADR-0014) and takes minutes, so this
 * returns 202 immediately and the result arrives on the event stream. Import
 * queues games automatically; this is the manual path a player reaches from a
 * game that failed or is still pending (the "Retry" action on a game card).
 *
 * The same ownership shape as delete-game: the game resolves to its owning
 * player, and the request proceeds only when that player is the session's one.
 * Absence and refusal are answered apart, 404 and 403. A game already queued,
 * analysing, or complete is answered 409 rather than double-queued; the
 * account's monthly analysis cap is checked before enqueueing and answered 429
 * when the plan is spent (pro has no cap).
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { queueAnalysis } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, player } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { enqueueAnalysis } from './queue.ts';
import { analysisRemaining } from '../billing/entitlement.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** A game already running or done must not be queued again. */
const RUNNING_OR_DONE: Record<string, true> = {
  queued: true,
  analyzing: true,
  complete: true,
};

export function mountQueueAnalysis(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(queueAnalysis, async (c) => {
    const { gameId } = c.req.valid('param');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const outcome = await deps.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ ownerUserId: player.ownerUserId, analysisStatus: game.analysisStatus })
        .from(game)
        .innerJoin(player, eq(game.playerId, player.id))
        .where(eq(game.id, gameId))
        .for('update');
      if (!owner) return { kind: 'not_found' as const };
      if (owner.ownerUserId !== session.userId) return { kind: 'forbidden' as const };
      if (RUNNING_OR_DONE[owner.analysisStatus]) return { kind: 'conflict' as const };
      return { kind: 'ok' as const };
    });

    if (outcome.kind === 'not_found') {
      return c.json({ code: 'not_found', message: 'No such game.' }, 404);
    }
    if (outcome.kind === 'forbidden') {
      return c.json({ code: 'forbidden', message: 'Not your game.' }, 403);
    }
    if (outcome.kind === 'conflict') {
      return c.json(
        { code: 'already_running', message: 'Analysis is already running for this game.' },
        409,
      );
    }

    // The cap is checked outside the transaction: it counts games analysed this
    // month, and a concurrent import may be spending the same budget. The check
    // is best-eff; the worker is the final authority on the cap.
    const remaining = await analysisRemaining(deps.db, session.userId);
    if (remaining === 0) {
      return c.json({ code: 'cap_reached', message: "The plan's analysis cap is reached." }, 429);
    }

    // Mark queued before sending so the game card shows a live state, then send.
    // A queue that is down leaves the game `queued` with nothing behind it; the
    // worker's redrive and the manual Retry are the recovery paths.
    await deps.db
      .update(game)
      .set({ analysisStatus: 'queued', analysisError: null })
      .where(eq(game.id, gameId));
    await enqueueAnalysis([gameId], undefined, c.get('requestId'));

    return c.json({ gameId, status: 'queued' }, 202);
  });
}
