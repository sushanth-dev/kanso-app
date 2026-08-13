/**
 * The endpoint that updates a player's ratings and site usernames.
 *
 * The claim check is the one authorization rule the API has. Absence and
 * refusal both answer 403, so naming a player id cannot be used to discover
 * which ids are real. Only the columns present in the validated `UpdatePlayer`
 * body are written, and the body is a partial of `CreatePlayer`, so
 * `displayName` is updatable too, not just ratings and usernames.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { updatePlayer } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { player } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { toPlayer } from './player-view.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountUpdatePlayer(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(updatePlayer, async (c) => {
    const { playerId } = c.req.valid('param');
    const body = c.req.valid('json');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    if (!(await hasPlayerClaim(deps.db, session.userId, playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your player.' }, 403);
    }

    // `UpdatePlayer` is `CreatePlayer.partial()`, so every field is optional.
    // Drizzle drops `undefined` members from an update, so only the columns the
    // caller actually sent are written.
    const [row] = await deps.db
      .update(player)
      .set({
        displayName: body.displayName,
        birthYear: body.birthYear,
        fideId: body.fideId,
        fideRating: body.fideRating,
        uscfId: body.uscfId,
        uscfRating: body.uscfRating,
        chesscomUsername: body.chesscomUsername,
        lichessUsername: body.lichessUsername,
      })
      .where(eq(player.id, playerId))
      .returning();

    return c.json(toPlayer(row), 200);
  });
}
