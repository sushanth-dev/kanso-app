/**
 * The endpoint a player uses to say which side of the board they were on.
 *
 * The importer leaves the colour unset when the player's name matched both tags
 * or neither, because a guessed colour shows a player an analysis of their
 * opponent. This is the only way that game stops being undecided, and colour is
 * the only field it accepts: everything else on a game is what the PGN said.
 *
 * Ownership runs through the player rather than the game, so a game is
 * reachable only by the account that owns the player it belongs to. Absence and
 * refusal are answered apart — 404 for a game that does not exist, 403 for one
 * that is not the caller's — because the ids are UUIDs, so a 404 for another
 * account's game would tell the caller nothing they could act on anyway.
 * ST-094. Naming a side is also what puts an analysable game on the queue:
 * the import never queues a colourless game, so a first colour here enqueues
 * the game, cap permitting.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { setGameColor } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, player } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { enqueueAnalysis } from '../analysis/queue.ts';
import { analysisRemaining } from '../billing/entitlement.ts';
import { toGameSummary } from './game-summary.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountSetGameColor(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(setGameColor, async (c) => {
    const { gameId } = c.req.valid('param');
    const { playerColor } = c.req.valid('json');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    // ponytail: the third copy of an ownership check is the one worth
    // extracting. ST-005 writes it, and this one joins through the player
    // rather than reading it directly, so a shared helper now would have one
    // shape and two exceptions.
    const outcome = await deps.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({
          ownerUserId: player.ownerUserId,
          playerColor: game.playerColor,
          moveCount: game.moveCount,
          analysisStatus: game.analysisStatus,
        })
        .from(game)
        .innerJoin(player, eq(game.playerId, player.id))
        .where(eq(game.id, gameId))
        .for('update');
      if (owner === undefined) return { kind: 'not_found' as const };
      if (owner.ownerUserId !== session.userId) return { kind: 'forbidden' as const };
      const [updated] = await tx
        .update(game)
        .set({ playerColor })
        .where(eq(game.id, gameId))
        .returning();
      return {
        kind: 'updated' as const,
        row: updated!,
        // ST-094: a colourless game is never auto-queued at import (there is
        // nobody to analyse). Answering the question is what earns the queue
        // send - but only for a game analysis can still run on. A re-colour of
        // an already decided game changes no queue state.
        shouldEnqueue:
          owner.playerColor === null &&
          (owner.moveCount ?? 0) > 0 &&
          (owner.analysisStatus === 'pending' || owner.analysisStatus === 'failed'),
      };
    });

    if (outcome.kind === 'not_found') {
      return c.json({ code: 'not_found', message: 'No such game.' }, 404);
    }
    if (outcome.kind === 'forbidden') {
      return c.json({ code: 'forbidden', message: 'Not your game.' }, 403);
    }

    if (outcome.shouldEnqueue) {
      // The cap is checked like POST /games/{gameId}/analysis does: best-effort
      // here, and the worker is the final authority. At the cap the game keeps
      // its previous status and stays available to Retry next month.
      const remaining = await analysisRemaining(deps.db, session.userId);
      if (remaining !== 0) {
        await deps.db
          .update(game)
          .set({ analysisStatus: 'queued', analysisError: null })
          .where(eq(game.id, gameId));
        await enqueueAnalysis([gameId], undefined, c.get('requestId'));
      }
    }

    const [fresh] = await deps.db.select().from(game).where(eq(game.id, gameId)).limit(1);
    return c.json(toGameSummary(fresh!), 200);
  });
}
