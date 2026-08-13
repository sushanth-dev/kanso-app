/**
 * The endpoint that creates a chess identity.
 *
 * The owner comes from the session, never the body: the insert names its
 * columns explicitly from the validated `CreatePlayer` body, and Zod rejects
 * unknown fields at the boundary, so a caller cannot smuggle an `ownerUserId`
 * in. This is the mass-assignment mitigation the security assessment names and
 * the same trust boundary ST-014 established.
 */
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { createPlayer } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { player } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { toPlayer } from './player-view.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountCreatePlayer(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(createPlayer, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const body = c.req.valid('json');
    const [row] = await deps.db
      .insert(player)
      .values({
        ownerUserId: session.userId,
        displayName: body.displayName,
        birthYear: body.birthYear,
        fideId: body.fideId,
        fideRating: body.fideRating,
        uscfId: body.uscfId,
        uscfRating: body.uscfRating,
        chesscomUsername: body.chesscomUsername,
        lichessUsername: body.lichessUsername,
      })
      .returning();

    return c.json(toPlayer(row!), 201);
  });
}
