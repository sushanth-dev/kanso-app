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
import { analysisAvailable } from '../billing/entitlement.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** A game already running or done must not be queued again. */
const RUNNING_OR_DONE: Record<string, true> = {
  queued: true,
  analyzing: true,
  complete: true,
};

/**
 * The worker's hard ceiling (infra/analysis.ts sets a 600s Lambda timeout)
 * plus a margin. A claim that has outlived it is provably orphaned: the hard
 * kill never reached the worker's failure handler, the message is in the
 * dead-letter queue, and without this the Retry path would answer 409 on the
 * game until it was re-imported. Every real worker claim refreshes the
 * timestamp, so a healthy analysis is never mistaken for a stale one.
 */
const ANALYSIS_STALE_MS = 600_000 + 60_000;

/** Whether an `analyzing` claim is old enough to be a dead worker. */
function isStaleClaim(claimedAt: Date | null): boolean {
  return claimedAt !== null && Date.now() - claimedAt.getTime() > ANALYSIS_STALE_MS;
}

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

    // The row is locked and flipped to `queued` in one transaction. Two
    // concurrent retries cannot both enqueue: the loser's `FOR UPDATE` resumes
    // after the winner commits and sees `queued`, so it answers 409 instead of
    // sending a second message. The old code released the read lock before the
    // status flip and enqueue ran, which doubled the message.
    const outcome = await deps.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({
          ownerUserId: player.ownerUserId,
          analysisStatus: game.analysisStatus,
          analysisStartedAt: game.analysisStartedAt,
        })
        .from(game)
        .innerJoin(player, eq(game.playerId, player.id))
        .where(eq(game.id, gameId))
        .for('update');
      if (!owner) return { kind: 'not_found' as const };
      if (owner.ownerUserId !== session.userId) return { kind: 'forbidden' as const };
      // An `analyzing` row whose claim outlived the worker's ceiling is a
      // killed invocation, not a live one; it is freed for re-queueing.
      if (
        RUNNING_OR_DONE[owner.analysisStatus] &&
        !(owner.analysisStatus === 'analyzing' && isStaleClaim(owner.analysisStartedAt))
      ) {
        return { kind: 'conflict' as const };
      }
      const previousStatus = owner.analysisStatus;
      await tx
        .update(game)
        .set({ analysisStatus: 'queued', analysisError: null, analysisStartedAt: null })
        .where(eq(game.id, gameId));
      return { kind: 'ok' as const, previousStatus };
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
    const previousStatus = outcome.previousStatus;

    // The cap is checked outside the transaction: it counts games analysed
    // this month plus games already queued or analysing, and a concurrent
    // import may be spending the same budget. The check is best-eff; the
    // worker is the final authority on the cap.
    const remaining = await analysisAvailable(deps.db, session.userId);
    if (remaining === 0) {
      return c.json({ code: 'cap_reached', message: "The plan's analysis cap is reached." }, 429);
    }

    try {
      await enqueueAnalysis([gameId], undefined, c.get('requestId'));
    } catch {
      // A queue that is down must not leave the game `queued` with no message
      // behind it: the manual Retry reads `queued` as already-running and
      // would answer 409 forever. Restore the prior status so Retry works.
      await deps.db.update(game).set({ analysisStatus: previousStatus }).where(eq(game.id, gameId));
      return c.json(
        { code: 'queue_unavailable', message: 'The analysis queue is unavailable right now.' },
        503,
      );
    }

    return c.json({ gameId, status: 'queued' }, 202);
  });
}
