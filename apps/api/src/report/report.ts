/**
 * ST-027. The weakness report, ranked by rating leak, stored per stream.
 *
 * The composition is {@link composeReport}; this file holds the storage, the
 * regeneration rule, and the authenticated handler. A report is stored rather
 * than computed per request, so the expensive leak path runs on change rather
 * than on every read.
 *
 * The regeneration rule, stated: a stored report is reused when it exists and
 * no game in the stream has finished analysing since it was generated. In
 * other words, regenerate when there is no report row, or when
 * `max(analyzed_at)` over the stream's `complete` games is after the latest
 * report's `generated_at`. `analyzed_at` is the timestamp the analysis worker
 * already writes, so no new column and no cache.
 */
import type { Context } from 'hono';
import { and, asc, desc, eq, max } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { getReport } from '../contract/routes.ts';
import { Report } from '../contract/schemas.ts';
import * as schema from '../db/schema.ts';
import { game, report, weakness } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { leakBaseline, scoreLeaks, weaknessLeakRows } from '../analysis/leak.ts';
import { SEASON_WINDOW_MS } from '../analysis/performance-rating.ts';
import { scoreTimeTrouble, timeTroubleCounts } from '../phases/phases.ts';
import { composeReport, type ComposedWeakness } from './compose.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];
type ReportRow = typeof report.$inferSelect;
type WeaknessRow = typeof weakness.$inferSelect;
type ReportResponse = z.infer<typeof Report>;

/** The latest `analyzed_at` over one stream's complete games, or null when none. */
async function maxAnalyzedAt(db: Db, playerId: string, stream: Stream): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(game.analyzedAt) })
    .from(game)
    .where(
      and(
        eq(game.playerId, playerId),
        eq(game.stream, stream),
        eq(game.analysisStatus, 'complete'),
      ),
    );
  return row?.at ?? null;
}

/** The newest stored report for a stream, with its ranked weaknesses. */
async function latestReport(
  db: Db,
  playerId: string,
  stream: Stream,
): Promise<(ReportRow & { weaknesses: WeaknessRow[] }) | null> {
  const [row] = await db
    .select()
    .from(report)
    .where(and(eq(report.playerId, playerId), eq(report.stream, stream)))
    .orderBy(desc(report.generatedAt))
    .limit(1);
  if (!row) return null;

  const rows = await db
    .select()
    .from(weakness)
    .where(eq(weakness.reportId, row.id))
    .orderBy(asc(weakness.rank));

  return { ...row, weaknesses: rows };
}

function toResponse(r: ReportRow, ws: WeaknessRow[]): ReportResponse {
  return {
    id: r.id,
    playerId: r.playerId,
    stream: r.stream,
    generatedAt: r.generatedAt.toISOString(),
    gamesCovered: r.gamesCovered,
    windowStart: r.windowStart ? r.windowStart.toISOString() : null,
    windowEnd: r.windowEnd ? r.windowEnd.toISOString() : null,
    timeTroubleFromMove: r.timeTroubleFromMove,
    timeTroubleReason: r.timeTroubleReason,
    weaknesses: ws.map((w) => ({
      id: w.id,
      kind: w.kind,
      label: w.label,
      eco: w.eco,
      ratingLeak: w.ratingLeak,
      saturated: w.saturated,
      halfPointsLost: w.halfPointsLost,
      gamesAffected: w.gamesAffected,
      occurrences: w.occurrences,
      rank: w.rank,
    })),
    narrative: r.narrative,
  };
}

/** Write the report and its weaknesses in one transaction, and return the response. */
async function storeReport(
  db: Db,
  input: {
    playerId: string;
    stream: Stream;
    gamesCovered: number;
    windowStart: Date;
    windowEnd: Date;
    timeTroubleFromMove: number | null;
    timeTroubleReason: 'no_clock_data' | 'not_enough_evidence' | null;
    weaknesses: ComposedWeakness[];
  },
): Promise<ReportResponse> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(report)
      .values({
        playerId: input.playerId,
        stream: input.stream,
        gamesCovered: input.gamesCovered,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeTroubleFromMove: input.timeTroubleFromMove,
        timeTroubleReason: input.timeTroubleReason,
      })
      .returning();

    // ponytail: no `select ... for update` on the report row. Two concurrent
    // requests for a stale report can both regenerate, producing two rows, and
    // the read path always takes the newest, so the only cost is a wasted
    // computation. Add the lock if concurrent regeneration ever matters.
    const rows = input.weaknesses.length
      ? await tx
          .insert(weakness)
          .values(
            input.weaknesses.map((w) => ({
              reportId: row!.id,
              kind: w.kind,
              label: w.label,
              eco: w.eco,
              ratingLeak: w.ratingLeak,
              saturated: w.saturated,
              halfPointsLost: w.halfPointsLost,
              gamesAffected: w.gamesAffected,
              occurrences: w.occurrences,
              rank: w.rank,
            })),
          )
          .returning()
      : [];

    return toResponse(row!, rows);
  });
}

export function mountReport(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getReport, async (c) => {
    const { playerId } = c.req.valid('param');
    const { stream } = c.req.valid('query');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    // Absence and refusal both answer 403, the same rule as every other
    // player-scoped route, so a player id cannot be enumerated.
    if (!(await hasPlayerClaim(deps.db, session.userId, playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your player.' }, 403);
    }

    const stored = await latestReport(deps.db, playerId, stream);
    const latestAnalyzedAt = await maxAnalyzedAt(deps.db, playerId, stream);
    if (
      stored !== null &&
      latestAnalyzedAt !== null &&
      stored.generatedAt.getTime() >= latestAnalyzedAt.getTime()
    ) {
      return c.json(toResponse(stored, stored.weaknesses), 200);
    }

    const baseline = await leakBaseline(deps.db, playerId, stream);
    if (baseline.kind === 'not_enough_evidence') {
      return c.json({ code: 'not_found', message: 'No analyzed games in this stream yet.' }, 404);
    }

    const rows = await weaknessLeakRows(deps.db, playerId, stream, baseline.windowStart);
    const leaks = scoreLeaks(baseline.baseline, rows);
    const timeTrouble = scoreTimeTrouble(await timeTroubleCounts(deps.db, playerId, stream));
    const composed = composeReport(leaks, timeTrouble);

    const response = await storeReport(deps.db, {
      playerId,
      stream,
      gamesCovered: baseline.baseline.games,
      windowStart: baseline.windowStart,
      // `windowStart` is the latest rated game minus the season, so adding the
      // season back recovers that latest date exactly.
      windowEnd: new Date(baseline.windowStart.getTime() + SEASON_WINDOW_MS),
      timeTroubleFromMove: composed.timeTroubleFromMove,
      timeTroubleReason: composed.timeTroubleReason,
      weaknesses: composed.weaknesses,
    });

    return c.json(response, 200);
  });
}
