/**
 * The endpoint a player uses to delete a game they own.
 *
 * ST-089. A game a player imported by mistake, from the wrong PGN or the wrong
 * stream, has nowhere to go today. This is the remove. Ownership runs through
 * the player rather than the game, exactly as every other game route does: a
 * game that does not exist is a 404, one that is not the caller's is a 403.
 *
 * The delete removes the game and its per-game analysis rows (move_ply,
 * mistake) through the cascade their `onDelete: 'cascade'` references already
 * declare, so one `delete(game)` is the whole removal. Aggregate data a report
 * or focus measurement still supports is untouched: neither table references a
 * game row, and a report or measurement recomputes on read when the stream's
 * latest analysed game is newer than the stored row, so it stays correct for
 * the games that remain.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { deleteGame } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, player } from '../db/schema.ts';
import { readSession } from '../session.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountDeleteGame(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(deleteGame, async (c) => {
    const { gameId } = c.req.valid('param');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    // The same ownership shape set-game-color.ts uses: the game resolves to
    // its owning player, and the delete only proceeds when that player is the
    // session's one. Absence and refusal are answered apart, 404 and 403.
    const outcome = await deps.db.transaction(async (tx) => {
      const owner = await tx
        .select({ ownerUserId: player.ownerUserId })
        .from(game)
        .innerJoin(player, eq(game.playerId, player.id))
        .where(eq(game.id, gameId))
        .for('update');
      if (owner.length === 0) return { kind: 'not_found' as const };
      if (owner[0]!.ownerUserId !== session.userId) return { kind: 'forbidden' as const };
      await tx.delete(game).where(eq(game.id, gameId));
      return { kind: 'deleted' as const };
    });

    if (outcome.kind === 'not_found') {
      return c.json({ code: 'not_found', message: 'No such game.' }, 404);
    }
    if (outcome.kind === 'forbidden') {
      return c.json({ code: 'forbidden', message: 'Not your game.' }, 403);
    }
    return c.body(null, 204);
  });
}
