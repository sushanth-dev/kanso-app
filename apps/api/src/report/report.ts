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
import { and, asc, desc, eq, inArray, isNotNull, isNull, max, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { getReport } from '../contract/routes.ts';
import { Report } from '../contract/schemas.ts';
import * as schema from '../db/schema.ts';
import { game, report, weakness } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';
import { leakBaseline, scoreLeaks, weaknessLeakRows } from '../analysis/leak.ts';
import { MIN_RATED_GAMES, SEASON_WINDOW_MS } from '../analysis/performance-rating.ts';
import { scoreTimeTrouble, timeTroubleCounts } from '../phases/phases.ts';
import { adviceFor, groupKeyOf, weaknessEvidence, type EvidenceInstance } from './evidence.ts';
import { composeReport, type ComposedWeakness } from './compose.ts';
import { adviceForReport } from './advice.ts';
import type { AiClient } from '../coaching/gemini.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];
type ReportRow = typeof report.$inferSelect;
type WeaknessRow = typeof weakness.$inferSelect;
type ReportResponse = z.infer<typeof Report>;

/** The latest `analyzed_at` over one scope's complete games, or null when none. */
async function maxAnalyzedAt(
  db: Db,
  playerId: string,
  stream: Stream,
  tournamentId?: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(game.analyzedAt) })
    .from(game)
    .where(
      and(
        eq(game.playerId, playerId),
        eq(game.stream, stream),
        eq(game.analysisStatus, 'complete'),
        tournamentId === undefined ? undefined : eq(game.tournamentId, tournamentId),
      ),
    );
  return row?.at ?? null;
}

/** The newest stored report for a scope, with its ranked weaknesses. */
async function latestReport(
  db: Db,
  playerId: string,
  stream: Stream,
  tournamentId?: string,
): Promise<(ReportRow & { weaknesses: WeaknessRow[] }) | null> {
  const [row] = await db
    .select()
    .from(report)
    .where(
      and(
        eq(report.playerId, playerId),
        eq(report.stream, stream),
        tournamentId === undefined
          ? isNull(report.tournamentId)
          : eq(report.tournamentId, tournamentId),
      ),
    )
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
    // ST-098. Set on a tournament-scoped report; null on a stream report.
    tournamentId: r.tournamentId,
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
      // Filled in by `withEvidence` before the response leaves the handler.
      evidence: [] as EvidenceInstance[],
      // ST-099. The model line stored with the report; `withEvidence` falls
      // back to the template copy when it is null.
      advice: w.advice,
    })),
    narrative: r.narrative,
  };
}

/**
 * ST-098. Attach the places and the advice to each weakness. The instances
 * come from the same window the report was computed over, so a stored report
 * and its evidence stay consistent after both leave the database.
 */
async function withEvidence(
  db: Db,
  playerId: string,
  stream: Stream,
  tournamentId: string | undefined,
  windowStart: Date | null,
  response: ReportResponse,
): Promise<ReportResponse> {
  const groups = response.weaknesses
    .map((w) => ({ kind: w.kind, key: groupKeyOf(w.kind, w.label, w.eco) }))
    .filter((g): g is { kind: typeof g.kind; key: string } => g.key !== null);
  const evidence = await weaknessEvidence(db, playerId, stream, tournamentId, windowStart, groups);
  for (const w of response.weaknesses) {
    w.evidence = evidence.get(`${w.kind}:${groupKeyOf(w.kind, w.label, w.eco)}`) ?? [];
    // ST-099. The stored model line wins; the template remains the fallback
    // for reports generated without a key and for pre-ST-099 rows.
    w.advice = w.advice ?? adviceFor(w.kind, groupKeyOf(w.kind, w.label, w.eco) ?? '', w.evidence);
  }
  return response;
}

/** Write the report and its weaknesses in one transaction, and return the response. */
async function storeReport(
  db: Db,
  input: {
    playerId: string;
    stream: Stream;
    /** ST-098. Null for a stream report; the tournament's id for a scoped one. */
    tournamentId: string | null;
    gamesCovered: number;
    windowStart: Date;
    windowEnd: Date;
    timeTroubleFromMove: number | null;
    timeTroubleReason: 'no_clock_data' | 'not_enough_evidence' | null;
    weaknesses: ComposedWeakness[];
    /** ST-099. Model lines keyed by aggregate key; empty when no key is set. */
    advice: ReadonlyMap<string, string>;
  },
): Promise<ReportResponse> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(report)
      .values({
        playerId: input.playerId,
        stream: input.stream,
        tournamentId: input.tournamentId,
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
              advice: input.advice.get(`${w.kind}:${groupKeyOf(w.kind, w.label, w.eco)}`) ?? null,
            })),
          )
          .returning()
      : [];

    return toResponse(row!, rows);
  });
}

export function mountReport(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; aiClient: AiClient | null },
): void {
  app.openapi(getReport, async (c) => {
    const { stream, tournamentId } = c.req.valid('query');
    // `undefined` means the whole stream; a uuid means one tournament's games.
    const inTournament = tournamentId;
    const place = inTournament === undefined ? 'stream' : 'tournament';

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const stored = await latestReport(deps.db, playerId, stream, inTournament);
    const latestAnalyzedAt = await maxAnalyzedAt(deps.db, playerId, stream, inTournament);
    const fresh =
      stored !== null &&
      latestAnalyzedAt !== null &&
      stored.generatedAt.getTime() >= latestAnalyzedAt.getTime();

    if (!fresh && stored !== null) {
      // ST-098. While games in this scope are still analysing, the stored
      // report is served as-is. Regenerating on every poll tick wrote new
      // weakness ids each time, the client remounted its list around new keys,
      // and the animations replayed - the flicker Sushanth kept seeing. The
      // banner carries the progress; the quiet stream regenerates once.
      const [row] = await deps.db
        .select({ n: sql<number>`count(*)::int` })
        .from(game)
        .where(
          and(
            eq(game.playerId, playerId),
            eq(game.stream, stream),
            inTournament === undefined ? undefined : eq(game.tournamentId, inTournament),
            or(
              inArray(game.analysisStatus, ['queued', 'analyzing']),
              and(eq(game.analysisStatus, 'pending'), isNotNull(game.playerColor)),
            ),
          ),
        );
      if ((row?.n ?? 0) > 0) {
        return c.json(
          await withEvidence(
            deps.db,
            playerId,
            stream,
            inTournament,
            stored.windowStart,
            toResponse(stored, stored.weaknesses),
          ),
          200,
        );
      }
    }

    if (fresh) {
      return c.json(
        await withEvidence(
          deps.db,
          playerId,
          stream,
          inTournament,
          stored.windowStart,
          toResponse(stored, stored.weaknesses),
        ),
        200,
      );
    }

    const baseline = await leakBaseline(deps.db, playerId, stream, inTournament);
    if (baseline.kind === 'not_enough_evidence') {
      // ST-095. Two different refusals shared one 404, and the web read both
      // as "import your games" - a lie for a player whose games are analysed
      // but too few. Zero analysed games stays the 404 the not-ready state
      // renders; a thin history answers the same 422 the motifs and phase
      // endpoints use, with the numbers in the message.
      const [row] = await deps.db
        .select({ n: sql<number>`count(*)::int` })
        .from(game)
        .where(
          and(
            eq(game.playerId, playerId),
            eq(game.stream, stream),
            eq(game.analysisStatus, 'complete'),
            inTournament === undefined ? undefined : eq(game.tournamentId, inTournament),
          ),
        );
      const analysed = row?.n ?? 0;
      if (analysed === 0) {
        return c.json(
          { code: 'not_found', message: `No analyzed games in this ${place} yet.` },
          404,
        );
      }
      // ST-097. The refusal names both sets, because "6 analyzed games but
      // needs 6 rated games" reads as a contradiction until the qualifying
      // subset is stated. The rated count is the same in-window figure the
      // baseline just computed and discarded.
      const rated = baseline.ratedGames;
      const games = analysed === 1 ? 'game' : 'games';
      const verb = analysed === 1 ? 'counts' : 'count';
      const lead =
        rated === 0
          ? `None of the ${analysed} analyzed ${games} in this ${place} ${verb} toward a report yet.`
          : rated === analysed
            ? `All ${analysed} analyzed ${games} in this ${place} ${verb} toward a report.`
            : `Only ${rated} of the ${analysed} analyzed ${games} in this ${place} ${verb} toward a report.`;
      return c.json(
        {
          code: 'not_enough_evidence',
          message:
            `${lead} A report needs ${MIN_RATED_GAMES} rated games in the last year, ` +
            `and a game counts when it has a decided result, a date, and both players' ratings.`,
        },
        422,
      );
    }

    const rows = await weaknessLeakRows(
      deps.db,
      playerId,
      stream,
      baseline.windowStart,
      inTournament,
    );
    const leaks = scoreLeaks(baseline.baseline, rows);
    const timeTrouble = scoreTimeTrouble(
      await timeTroubleCounts(deps.db, playerId, stream, { tournamentId: inTournament }),
    );
    const composed = composeReport(leaks, timeTrouble);
    // ST-099. The model writes each card's advice once, at generation, from
    // the same instances the card will show. A failed or invalid call simply
    // leaves the template copy in place.
    const advice = deps.aiClient
      ? await adviceForReport(deps.db, deps.aiClient, {
          playerId,
          stream,
          tournamentId: inTournament,
          windowStart: baseline.windowStart,
          gamesCovered: baseline.baseline.games,
          weaknesses: composed.weaknesses,
        })
      : new Map<string, string>();

    const response = await storeReport(deps.db, {
      playerId,
      stream,
      tournamentId: inTournament ?? null,
      gamesCovered: baseline.baseline.games,
      windowStart: baseline.windowStart,
      // `windowStart` is the latest rated game minus the season, so adding the
      // season back recovers that latest date exactly.
      windowEnd: new Date(baseline.windowStart.getTime() + SEASON_WINDOW_MS),
      timeTroubleFromMove: composed.timeTroubleFromMove,
      timeTroubleReason: composed.timeTroubleReason,
      weaknesses: composed.weaknesses,
      advice,
    });

    return c.json(
      await withEvidence(deps.db, playerId, stream, inTournament, baseline.windowStart, response),
      200,
    );
  });
}
