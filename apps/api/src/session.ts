/**
 * The session as a handler needs it: an identity, or nothing.
 *
 * `requireSession` in `app.ts` has already refused the request without a
 * session by the time a handler runs, so a null here means a handler mounted on
 * a public path rather than an unauthenticated caller. Handlers check anyway,
 * because failing closed twice costs one comparison.
 *
 * This is its own file rather than a second export from `app.ts`, because
 * `app.ts` imports every handler and a handler importing back from it would
 * make a cycle.
 */
import type { Context } from 'hono';

export interface Session {
  userId: string;
}

export function readSession(getSession: (c: Context) => unknown, c: Context): Session | null {
  const session = getSession(c);
  return session != null && typeof (session as { userId?: unknown }).userId === 'string'
    ? (session as Session)
    : null;
}
