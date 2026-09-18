/**
 * The probe that answers whether anybody is signed in, without failing when
 * nobody is.
 *
 * ST-164. It reads the session through the same seam `/me` uses and returns one
 * of two constants, so an absent, expired, or forged cookie all produce the same
 * bytes. It carries no identity and no consent state: both belong to `/me`, and
 * the pages that need them still ask for them.
 *
 * It takes no `db`, because it has nothing to ask the database. A public route
 * that opened a connection on every page load would be a cost with no answer.
 */
import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getSession } from '../contract/routes.ts';
import { readSession } from '../session.ts';

const ANONYMOUS = { signedIn: false } as const;
const SIGNED_IN = { signedIn: true } as const;

export function mountSessionState(
  app: OpenAPIHono,
  deps: { getSession: (c: Context) => unknown },
): void {
  app.openapi(getSession, async (c) => {
    const session = await readSession(deps.getSession, c);
    return c.json(session === null ? ANONYMOUS : SIGNED_IN, 200);
  });
}
