/**
 * The endpoint that returns the signed-in user and the players they own (B4).
 *
 * The person playing is the account owner now: a minor signs up themselves and
 * a guardian is a bare email that confirms consent rather than a second account
 * with its own players (ADR-0035), so there is one list, not two. The tier
 * comes from the user's `subscription` row, defaulting to `free` when there is
 * none, which is the schema's own default for a fresh sign-up rather than a
 * value invented in the handler.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getMe } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { player, subscription } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { readSession } from '../session.ts';
import { toPlayer } from './player-view.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountMe(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getMe, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const [account] = await deps.db
      .select({ id: user.id, email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, session.userId))
      .limit(1);
    if (!account) {
      // A session always names a real user, but a user can be deleted out from
      // under a live session. Fail closed rather than invent an account.
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const [sub] = await deps.db
      .select({ tier: subscription.tier })
      .from(subscription)
      .where(eq(subscription.userId, session.userId))
      .limit(1);

    const owned = await deps.db.select().from(player).where(eq(player.ownerUserId, session.userId));

    return c.json(
      {
        userId: account.id,
        email: account.email,
        name: account.name,
        tier: sub?.tier ?? 'free',
        players: owned.map(toPlayer),
      },
      200,
    );
  });
}
