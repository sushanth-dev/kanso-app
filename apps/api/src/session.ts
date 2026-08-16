/**
 * The session as a handler needs it: an identity, or nothing.
 *
 * This is its own file rather than a second export from `app.ts`, because
 * `app.ts` imports every handler and a handler importing back from it would
 * make a cycle.
 */
import type { Context } from 'hono';

export interface Session {
  userId: string;
}

export async function readSession(
  getSession: (c: Context) => unknown,
  c: Context,
): Promise<Session | null> {
  const session = await getSession(c);
  return session != null && typeof (session as { userId?: unknown }).userId === 'string'
    ? (session as Session)
    : null;
}

/**
 * The production session reader: the seam's real default.
 *
 * `requireSession` and every handler take a `getSession` function so the
 * cross-cutting tests can assemble an app with any session state. In a running
 * server this is the reader behind that seam: it asks better-auth for the
 * session behind the request's cookie and maps it to the `{ userId }` shape
 * `hasPlayerClaim` resolves against. The id better-auth puts in a session is
 * the id it writes into `user.id`, which is what `player.owner_user_id`
 * references, so this is where the sprint's question is answered.
 */
export function realSessionReader(auth: {
  api: {
    getSession: (args: { headers: Headers }) => Promise<{ session: { userId: string } } | null>;
  };
}) {
  return async (c: Context) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    return result?.session ? { userId: result.session.userId } : null;
  };
}
