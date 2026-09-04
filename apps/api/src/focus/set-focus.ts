/**
 * PUT /focus (F10, F13). Ends the active focus and starts the new one in one
 * transaction. The coach branch stores the instruction verbatim, leaves
 * `catalogueId` null when it names no catalogue key, and pairs it with a
 * measurable focus resolved server-side from a key, never a raw id.
 *
 * The write itself lives in `setFocusForPlayer` because it has a second
 * caller: ST-117's assignment confirm writes through this exact path, so the
 * F13 pairing - instruction verbatim, paired, never standing alone - has one
 * implementation.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { setFocus } from '../contract/routes.ts';
import { SetFocus } from '../contract/schemas.ts';
import * as schema from '../db/schema.ts';
import { focusCatalogue, playerFocus } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';
import { resolveFocusFields } from './resolve.ts';
import { FOCUS_DRILL_KINDS, practiceSummary } from './verify.ts';
import { toActiveFocus, toCatalogueEntry } from './view.ts';

type Db = PostgresJsDatabase<typeof schema>;

type SetFocusBody = z.infer<typeof SetFocus>;

export type SetFocusResult =
  | {
      ok: true;
      row: typeof playerFocus.$inferSelect;
      catalogue: typeof focusCatalogue.$inferSelect | null;
    }
  | { ok: false };

/**
 * Resolve the body, end the active focus, and start the new one in one
 * transaction. `ok: false` means a named catalogue key does not exist or is
 * retired; the caller turns that into its own honest 404.
 */
export async function setFocusForPlayer(
  db: Db,
  playerId: string,
  body: SetFocusBody,
): Promise<SetFocusResult> {
  const resolveKey = async (key: string): Promise<string | null> => {
    const rows = await db
      .select({ id: focusCatalogue.id })
      .from(focusCatalogue)
      .where(and(eq(focusCatalogue.key, key), isNull(focusCatalogue.retiredAt)))
      .limit(1);
    return rows[0]?.id ?? null;
  };

  const result = await resolveFocusFields(body, resolveKey);
  if (!result.ok) return { ok: false };

  const catalogue =
    result.focus.catalogueId !== null
      ? ((
          await db
            .select()
            .from(focusCatalogue)
            .where(eq(focusCatalogue.id, result.focus.catalogueId))
            .limit(1)
        )[0] ?? null)
      : null;

  const [row] = await db.transaction(async (tx) => {
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

  return { ok: true, row: row!, catalogue };
}

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
    const result = await setFocusForPlayer(deps.db, playerId, body);
    if (!result.ok) {
      return c.json({ code: 'not_found', message: 'No such catalogue key.' }, 404);
    }

    // ST-129. The response carries the same practice line the read will:
    // the focus itself when it has a catalogue entry, the paired focus for
    // a coach instruction.
    const drillCatalogue =
      result.catalogue ??
      (result.row.pairedFocusId !== null
        ? ((
            await deps.db
              .select()
              .from(focusCatalogue)
              .where(eq(focusCatalogue.id, result.row.pairedFocusId))
              .limit(1)
          )[0] ?? null)
        : null);
    const practice = await practiceSummary(
      deps.db,
      playerId,
      drillCatalogue !== null ? FOCUS_DRILL_KINDS[drillCatalogue.key] : undefined,
    );

    return c.json(
      toActiveFocus(
        result.row,
        result.catalogue ? toCatalogueEntry(result.catalogue) : null,
        [],
        practice,
      ),
      200,
    );
  });
}
