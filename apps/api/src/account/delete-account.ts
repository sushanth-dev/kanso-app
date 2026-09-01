/**
 * The endpoint that deletes the account and everything its player owns.
 *
 * One `DELETE FROM "user"` does all the work: every chess table hangs off
 * `player` with `on delete cascade`, `player` hangs off `user` the same way,
 * and better-auth's own tables cascade off the user row too. The password
 * check runs through better-auth's own `/verify-password` endpoint, so the
 * hashing, the credential lookup, and its rate limiting stay the library's
 * problem rather than ours.
 */
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { deleteAccount } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { user } from '../db/auth-schema.ts';
import { readSession } from '../session.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountDeleteAccount(
  app: OpenAPIHono,
  deps: {
    db: Db;
    getSession: (c: Context) => unknown;
    verifyPassword: (args: { body: { password: string }; headers: Headers }) => Promise<unknown>;
  },
): void {
  app.openapi(deleteAccount, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const { password } = c.req.valid('json');
    try {
      await deps.verifyPassword({ body: { password }, headers: c.req.raw.headers });
    } catch {
      // better-auth refuses a wrong password with its own INVALID_PASSWORD
      // error; a right one returns { status: true }. Either way the account
      // stays and the answer is the same 403.
      return c.json({ code: 'wrong_password', message: 'That password is not right.' }, 403);
    }

    await deps.db.delete(user).where(eq(user.id, session.userId));
    return c.body(null, 204);
  });
}
