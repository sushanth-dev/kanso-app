/**
 * ST-111. The feedback endpoint: one free-text message from a signed-in
 * player, stored against their account. Read in SQL; nothing renders it back
 * into the product, so the bound is a courtesy to the reader, not an XSS
 * boundary.
 *
 * Residual risk, named in the story's security assessment: an authenticated
 * user can insert many small rows. The named upgrade path is a per-user daily
 * insert cap here, one query, when anyone abuses it.
 */
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { submitFeedback } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { feedback } from '../db/schema.ts';
import { readSession } from '../session.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountFeedback(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(submitFeedback, async (c) => {
    const body = c.req.valid('json');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    // The user id comes from the session, never the body.
    const [row] = await deps.db
      .insert(feedback)
      .values({ userId: session.userId, message: body.message })
      .returning({ id: feedback.id, createdAt: feedback.createdAt });

    return c.json({ id: row!.id, createdAt: row!.createdAt.toISOString() }, 201);
  });
}
