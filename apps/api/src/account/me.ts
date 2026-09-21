/**
 * The endpoint that returns the signed-in user and the one player they are.
 *
 * ST-072, ST-074. The account IS the player, so this returns a single
 * `player`, not a list. The tier comes from the user's `subscription` row,
 * defaulting to `beginner` when there is none, which is the schema's own
 * default for a fresh sign-up rather than a value invented in the handler.
 *
 * ST-176 adds the analytics gate's answer. It rides this response rather than a
 * route of its own because the account route already resolves `/me` before any
 * signed-in page renders, so the suite is settled before the first page view
 * rather than after it.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getMe } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { player, subscription } from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { log } from '../logging.ts';
import { readSession } from '../session.ts';
import { analyticsSuiteGate } from './consent-request.ts';
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
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        dateOfBirth: user.dateOfBirth,
      })
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

    const [own] = await deps.db
      .select()
      .from(player)
      .where(eq(player.ownerUserId, session.userId))
      .limit(1);
    if (!own) {
      // A session always names a user with one player (the sign-up hook and the
      // backfill guarantee it). Fail closed rather than invent one.
      return c.json({ code: 'not_found', message: 'No player for this account.' }, 404);
    }

    // ST-176. The gate reads this account's own state and nothing else, so a
    // session cannot learn another account's age through it.
    const suite = await analyticsSuiteGate(deps.db, session.userId, account.dateOfBirth);
    if (!suite.allowed) {
      // The reason, not only the answer: "why is replay missing for this
      // account" is a lookup in these lines rather than a guess.
      log('info', 'analytics_suite_gated', {
        requestId: c.get('requestId'),
        userId: session.userId,
        reason: suite.reason,
      });
    }

    return c.json(
      {
        userId: account.id,
        email: account.email,
        name: account.name,
        tier: sub?.tier ?? 'beginner',
        analyticsSuiteAllowed: suite.allowed,
        player: toPlayer(own),
      },
      200,
    );
  });
}
