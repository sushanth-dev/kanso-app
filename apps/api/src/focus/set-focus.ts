/**
 * PUT /focus (F10, F13). Ends the active focus and starts
 * the new one in one transaction. The coach branch stores the instruction
 * verbatim, leaves `catalogueId` null when it names no catalogue key, and pairs
 * it with a measurable focus resolved server-side from a key, never a raw id.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { setFocus } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { focusCatalogue, playerFocus } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';
import { resolveFocusFields } from './resolve.ts';
import { toActiveFocus, toCatalogueEntry } from './view.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountSetFocus(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(setFocus, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const body = c.req.valid('json');

    const resolveKey = async (key: string): Promise<string | null> => {
      const rows = await deps.db
        .select({ id: focusCatalogue.id })
        .from(focusCatalogue)
        .where(and(eq(focusCatalogue.key, key), isNull(focusCatalogue.retiredAt)))
        .limit(1);
      return rows[0]?.id ?? null;
    };

    const result = await resolveFocusFields(body, resolveKey);
    if (!result.ok) {
      return c.json({ code: 'not_found', message: 'No such catalogue key.' }, 404);
    }

    const catalogue =
      result.focus.catalogueId !== null
        ? ((
            await deps.db
              .select()
              .from(focusCatalogue)
              .where(eq(focusCatalogue.id, result.focus.catalogueId))
              .limit(1)
          )[0] ?? null)
        : null;

    const [row] = await deps.db.transaction(async (tx) => {
      await tx
        .update(playerFocus)
        .set({ endedAt: new Date() })
        .where(and(eq(playerFocus.playerId, playerId), isNull(playerFocus.endedAt)));

      return tx
        .insert(playerFocus)
        .values({
          playerId,
          catalogueId: result.focus.catalogueId,
          coachInstruction: result.focus.coachInstruction,
          source: body.source,
          pairedFocusId: result.focus.pairedFocusId,
        })
        .returning();
    });

    return c.json(toActiveFocus(row!, catalogue ? toCatalogueEntry(catalogue) : null, []), 200);
  });
}
