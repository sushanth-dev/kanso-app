/**
 * The endpoint that updates the account's own player: ratings and site
 * usernames, and the display name.
 *
 * ST-072. The player is the account, so the player is resolved from the session
 * rather than named in the path. Only the columns present in the validated
 * `UpdatePlayer` body are written; Drizzle drops `undefined` members, so only
 * what the caller sent changes.
 */
import type { Context } from 'hono';
import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { updatePlayer } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { player } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';
import { toPlayer } from './player-view.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountUpdatePlayer(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(updatePlayer, async (c) => {
    const body = c.req.valid('json');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    // ST-084. The display name is the username: it must be unique across
    // accounts. Checked here, not by a DB unique index, because sign-up seeds
    // displayName from the real name and two accounts can share a real name.
    if (body.displayName !== undefined) {
      const [clash] = await deps.db
        .select({ id: player.id })
        .from(player)
        .where(and(eq(player.displayName, body.displayName), ne(player.id, playerId)))
        .limit(1);
      if (clash) {
        return c.json({ code: 'username_taken', message: 'That username is already taken.' }, 409);
      }
    }

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

    return c.json(toPlayer(row!), 200);
  });
}
