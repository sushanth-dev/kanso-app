/**
 * The endpoint the nudge email's unsubscribe link points at (ST-126).
 *
 * The second unauthenticated path that changes state. The token is verified
 * before any write, and a bad link answers 404 rather than 403 or 409, so a
 * link cannot be used to discover whether an account exists - the same rule
 * the consent confirm route follows. Unsubscribing is idempotent: a repeated
 * click finds the flag already set and answers 204 without writing, and the
 * flag is read by the same selection query that sends, so it cannot drift.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { nudgeUnsubscribe } from '../contract/routes.ts';
import type * as schema from '../db/schema.ts';
import { player } from '../db/schema.ts';
import { verifyUnsubscribeToken } from './unsubscribe-token.ts';

type Db = PostgresJsDatabase<typeof schema>;

const NOT_FOUND = {
  code: 'not_found',
  message: 'No such unsubscribe link, or it was tampered with or has expired.',
} as const;

export function mountNudgeUnsubscribe(app: OpenAPIHono, deps: { db: Db }): void {
  app.openapi(nudgeUnsubscribe, async (c) => {
    const { token } = c.req.valid('param');
    const verified = verifyUnsubscribeToken(token);
    if (!verified.ok) {
      return c.json(NOT_FOUND, 404);
    }

    const [row] = await deps.db
      .select({ id: player.id, unsubscribedAt: player.nudgeUnsubscribedAt })
      .from(player)
      .where(eq(player.ownerUserId, verified.userId))
      .limit(1);
    if (!row) {
      return c.json(NOT_FOUND, 404);
    }

    if (row.unsubscribedAt === null) {
      await deps.db
        .update(player)
        .set({ nudgeUnsubscribedAt: new Date() })
        .where(eq(player.id, row.id));
    }

    return c.body(null, 204);
  });
}
