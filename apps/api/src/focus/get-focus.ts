/**
 * GET /players/{playerId}/focus (F10, F12, F13). The active focus, or 404 when
 * none, with one measurement per stream the focus can be measured in.
 *
 * A measurement is recomputed when the stream's latest `analyzed_at` is newer
 * than the stored measurement, and read back otherwise, the same rule ST-027
 * holds over its report. The F13 case has `catalogueId` null; its measurements
 * come from the paired measurable focus, so the loop closes even when the
 * instruction itself cannot be measured.
 */
import { and, desc, eq, isNull, max } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { getFocus } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { focusCatalogue, focusMeasurement, playerFocus } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';
import { FocusMeasurement } from '../contract/schemas.ts';
import { FOCUS_COMPUTE } from './computations.ts';
import { FOCUS_SPECS, FOCUS_WINDOW_GAMES, measureFocusStream, trendFor } from './verify.ts';
import { toActiveFocus, toCatalogueEntry } from './view.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

/** The latest `analyzed_at` over one stream's complete games, or null when none. */
async function maxAnalyzedAt(db: Db, playerId: string, stream: Stream): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(schema.game.analyzedAt) })
    .from(schema.game)
    .where(
      and(
        eq(schema.game.playerId, playerId),
        eq(schema.game.stream, stream),
        eq(schema.game.analysisStatus, 'complete'),
      ),
    );
  return row?.at ?? null;
}

/** The newest stored measurement for a focus and stream, or null when none. */
async function latestMeasurement(
  db: Db,
  playerFocusId: string,
  stream: Stream,
): Promise<typeof focusMeasurement.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(focusMeasurement)
    .where(
      and(eq(focusMeasurement.playerFocusId, playerFocusId), eq(focusMeasurement.stream, stream)),
    )
    .orderBy(desc(focusMeasurement.measuredAt))
    .limit(1);
  return row ?? null;
}

function toMeasurement(
  row: typeof focusMeasurement.$inferSelect,
): z.infer<typeof FocusMeasurement> {
  return {
    stream: row.stream,
    measuredAt: row.measuredAt.toISOString(),
    windowGames: row.windowGames,
    baselineValue: row.baselineValue,
    currentValue: row.currentValue,
    unit: row.unit,
    trend: row.trend,
  };
}

export function mountGetFocus(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getFocus, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
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

    // The measurable focus is the focus itself, or the paired focus for the
    // F13 case where the active instruction has no catalogue entry.
    const measurableId = row.catalogueId ?? row.pairedFocusId;
    const measurable =
      measurableId !== null
        ? ((
            await deps.db
              .select()
              .from(focusCatalogue)
              .where(eq(focusCatalogue.id, measurableId))
              .limit(1)
          )[0] ?? null)
        : null;

    const measurements: z.infer<typeof FocusMeasurement>[] = [];
    const spec = measurable !== null ? FOCUS_SPECS[measurable.key] : undefined;
    const compute = measurable !== null ? FOCUS_COMPUTE[measurable.key] : undefined;
    if (measurable !== null && spec !== undefined && compute !== undefined) {
      for (const stream of measurable.measurableStreams) {
        const stored = await latestMeasurement(deps.db, row.id, stream);
        const latest = await maxAnalyzedAt(deps.db, playerId, stream);
        if (stored !== null && latest !== null && stored.measuredAt.getTime() >= latest.getTime()) {
          measurements.push(toMeasurement(stored));
          continue;
        }

        const draft = await measureFocusStream(
          deps.db,
          playerId,
          stream,
          row.startedAt,
          (gameIds) => compute(deps.db, playerId, gameIds),
        );
        const trend = trendFor(spec, draft.baselineValue, draft.currentValue);
        const measuredAt = new Date();

        // A window thin enough to refuse is returned, not stored: it changes
        // with every import and costs nothing to recompute.
        if (draft.windowGames >= FOCUS_WINDOW_GAMES) {
          await deps.db.insert(focusMeasurement).values({
            playerFocusId: row.id,
            stream,
            measuredAt,
            windowGames: draft.windowGames,
            baselineValue: draft.baselineValue,
            currentValue: draft.currentValue,
            unit: spec.unit,
            trend,
          });
        }

        measurements.push({
          stream,
          measuredAt: measuredAt.toISOString(),
          windowGames: draft.windowGames,
          baselineValue: draft.baselineValue,
          currentValue: draft.currentValue,
          unit: spec.unit,
          trend,
        });
      }
    }

    return c.json(
      toActiveFocus(row, catalogue ? toCatalogueEntry(catalogue) : null, measurements),
      200,
    );
  });
}
