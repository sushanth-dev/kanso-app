/**
 * GET /players/{playerId}/focus (F10, F12). The active focus, or 404 when none.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getFocus } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { focusCatalogue, playerFocus } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { toActiveFocus, toCatalogueEntry } from './view.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountGetFocus(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getFocus, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const { playerId } = c.req.valid('param');
    if (!(await hasPlayerClaim(deps.db, session.userId, playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your player.' }, 403);
    }

    const [row] = await deps.db
      .select()
      .from(playerFocus)
      .where(and(eq(playerFocus.playerId, playerId), isNull(playerFocus.endedAt)))
      .limit(1);
    if (!row) {
      return c.json({ code: 'not_found', message: 'No active focus.' }, 404);
    }

    const catalogue =
      row.catalogueId !== null
        ? ((
            await deps.db
              .select()
              .from(focusCatalogue)
              .where(eq(focusCatalogue.id, row.catalogueId))
              .limit(1)
          )[0] ?? null)
        : null;

    return c.json(toActiveFocus(row, catalogue ? toCatalogueEntry(catalogue) : null), 200);
  });
}
