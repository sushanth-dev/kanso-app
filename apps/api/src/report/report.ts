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
import {
  generateWeaknessCoaching,
  getReport,
  listActionItems,
  markActionItemDone,
} from '../contract/routes.ts';
import { Report } from '../contract/schemas.ts';
import * as schema from '../db/schema.ts';
import { actionItem, game, patternState, puzzleAttempt, report, weakness } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';
import { leakBaseline, scoreLeaks, weaknessLeakRows } from '../analysis/leak.ts';
import { missedPunishments } from '../analysis/missed-punishment.ts';
import { MIN_RATED_GAMES, SEASON_WINDOW_MS } from '../analysis/performance-rating.ts';
import { scoreTimeTrouble, timeTroubleCounts } from '../phases/phases.ts';
import { FOCUS_WINDOW_GAMES } from '../focus/verify.ts';
import { windowGameIds } from '../analysis/retirement.ts';
import { adviceFor, groupKeyOf, weaknessEvidence, type EvidenceInstance } from './evidence.ts';
import { lineConsistencyByEco } from '../openings/line-consistency.ts';
import { composeReport, type ComposedWeakness } from './compose.ts';
import { generateAdvice } from './advice.ts';
import { summaryForReport } from './summary.ts';
import type { AiClient, ReportAdviceFacts } from '../coaching/zai.ts';
import { ensureActionItems, readItemsByGroup, completeItem, type ItemRow } from './action-items.ts';

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
      // ST-107. Filled in by `withEvidence` from the action-item table; each
      // weakness's curriculum of three resources carries its own done state.
      actionItems: [],
      // ST-106. The group identity the practice link carries; recovered from
      // the label the row stores, so it survives regeneration.
      groupKey: groupKeyOf(w.kind, w.label, w.eco),
      // ST-106. Filled in by `withEvidence` from the drill attempt table.
      drilled: 0,
      // ST-123. Filled in by `withEvidence` on the tournament stream; null
      // otherwise - the figure is a tournament figure and never appears on
      // an online card.
      lineConsistency: null,
      // ST-150. Filled in by `withEvidence` from the pattern_state table; null
      // when the group never became a retirement candidate.
      retirementState: null,
    })),
    // ST-154. Filled in by `withEvidence`; never stored, always recomputed
    // from the same window the report was computed over.
    missedPunishment: null,
    narrative: r.narrative,
  };
}

/**
 * ST-098. Attach the places, the advice, and the drill count to each
 * weakness. The instances come from the same window the report was computed
 * over, so a stored report and its evidence stay consistent after both leave
 * the database. No model runs here: the advice line is written at the click
 * that opens a weakness, and the drill count is one read for the whole
 * report, keyed by group, so it survives the weakness rows being rewritten
 * on regeneration.
 */
/**
 * The wire shape of one assigned resource, shared by the report read and the
 * on-demand coaching response.
 */
function itemBody(item: ItemRow) {
  return {
    id: item.id,
    resourceIndex: item.resourceIndex,
    tier: item.tier,
    resource: item.resource,
    status: item.status,
    dueAt: item.dueAt.toISOString(),
    completedAt: item.completedAt?.toISOString() ?? null,
  };
}

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
  // ST-106. Solved drills per group, from the attempt table the practice
  // routes write; the read is whole-table per player, which is a drill
  // history, not a move log.
  const drilledRows = await db
    .select({
      kind: puzzleAttempt.kind,
      groupKey: puzzleAttempt.groupKey,
      count: sql<number>`count(*) filter (where ${puzzleAttempt.solved})`.mapWith(Number),
    })
    .from(puzzleAttempt)
    .where(eq(puzzleAttempt.playerId, playerId))
    .groupBy(puzzleAttempt.kind, puzzleAttempt.groupKey);
  const drilled = new Map(drilledRows.map((r) => [`${r.kind}:${r.groupKey}`, r.count]));
  // ST-150. One read for the whole report: the player's pattern_state rows in
  // this stream, keyed by group so a weakness can look its state up without a
  // query of its own. A group with no row never became a retirement candidate.
  const patternRows = await db
    .select({
      kind: patternState.kind,
      groupKey: patternState.groupKey,
      state: patternState.state,
      masteredAt: patternState.masteredAt,
    })
    .from(patternState)
    .where(and(eq(patternState.playerId, playerId), eq(patternState.stream, stream)));
  const patternStateByGroup = new Map(patternRows.map((r) => [`${r.kind}:${r.groupKey}`, r]));
  for (const w of response.weaknesses) {
    const key = groupKeyOf(w.kind, w.label, w.eco);
    w.evidence = evidence.get(`${w.kind}:${key}`) ?? [];
    // ST-099. The stored model line wins; the template remains the fallback
    // for reports generated without a key and for pre-ST-099 rows.
    w.advice = w.advice ?? adviceFor(w.kind, key ?? '', w.evidence);
    w.drilled = key === null ? 0 : (drilled.get(`${w.kind}:${key}`) ?? 0);
    // ST-150. A candidate whose window is thinner than the floor reads as
    // `not_yet_verifiable`, the same derivation `GET /patterns` applies, so
    // the report and the pattern list never disagree about the window.
    const pattern = key === null ? undefined : patternStateByGroup.get(`${w.kind}:${key}`);
    if (pattern === undefined) {
      w.retirementState = null;
    } else if (
      pattern.state === 'candidate' &&
      (await windowGameIds(db, playerId, stream, pattern.masteredAt)).length < FOCUS_WINDOW_GAMES
    ) {
      w.retirementState = 'not_yet_verifiable';
    } else {
      w.retirementState = pattern.state;
    }
  }
  const items = await readItemsByGroup(
    db,
    playerId,
    groups.map((g) => ({ kind: g.kind, groupKey: g.key })),
  );
  for (const w of response.weaknesses) {
    const key = groupKeyOf(w.kind, w.label, w.eco);
    w.actionItems = key === null ? [] : (items.get(`${w.kind}:${key}`) ?? []).map(itemBody);
  }
  // ST-123. The consistency figure belongs to the tournament stream (F12's
  // partition): computed for the report's scope, attached to opening
  // weaknesses only, and left null everywhere else.
  if (stream === 'tournament') {
    const ecos = [
      ...new Set(
        response.weaknesses
          .filter((w) => w.kind === 'opening' && w.eco !== null)
          .map((w) => w.eco as string),
      ),
    ];
    const consistency = await lineConsistencyByEco(
      db,
      playerId,
      stream,
      windowStart,
      tournamentId,
      ecos,
    );
    for (const w of response.weaknesses) {
      if (w.kind === 'opening' && w.eco !== null) {
        w.lineConsistency = consistency.get(w.eco) ?? null;
      }
    }
  }
  // ST-154. The missed-punishment line, computed over the same window and
  // scope the leaks were; never stored, so a stored report's figure is
  // recomputed from the same rows each read.
  response.missedPunishment = await missedPunishments(
    db,
    playerId,
    stream,
    windowStart,
    tournamentId,
  );
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
    /** ST-100. The model-written plan, null when the model failed or no key is set. */
    narrative: string | null;
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
        narrative: input.narrative,
        narrativeGeneratedAt: input.narrative === null ? null : new Date(),
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

/**
 * The outcome of one report read: a rendered report, or one of the refusal
 * bodies the endpoint answers with.
 */
type ProducedReport =
  | { ok: true; report: ReportResponse }
  | { ok: false; status: 404 | 422; body: { code: string; message: string } };

/**
 * ST-127. The report read, shared by the report endpoint and the share-card
 * creation: the card snapshots its headline from the same read the report
 * screen serves, so nothing recomputes for the card and no second report
 * path can disagree with the first.
 */
export async function produceReport(
  db: Db,
  aiClient: AiClient | null,
  playerId: string,
  stream: Stream,
  inTournament: string | undefined,
): Promise<ProducedReport> {
  const place = inTournament === undefined ? 'stream' : 'tournament';

  const stored = await latestReport(db, playerId, stream, inTournament);
  const latestAnalyzedAt = await maxAnalyzedAt(db, playerId, stream, inTournament);
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
    const [row] = await db
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
      return {
        ok: true,
        report: await withEvidence(
          db,
          playerId,
          stream,
          inTournament,
          stored.windowStart,
          toResponse(stored, stored.weaknesses),
        ),
      };
    }
  }

  if (fresh) {
    return {
      ok: true,
      report: await withEvidence(
        db,
        playerId,
        stream,
        inTournament,
        stored.windowStart,
        toResponse(stored, stored.weaknesses),
      ),
    };
  }

  const baseline = await leakBaseline(db, playerId, stream, inTournament);
  if (baseline.kind === 'not_enough_evidence') {
    // ST-095. Two different refusals shared one 404, and the web read both
    // as "import your games" - a lie for a player whose games are analysed
    // but too few. Zero analysed games stays the 404 the not-ready state
    // renders; a thin history answers the same 422 the motifs and phase
    // endpoints use, with the numbers in the message.
    const [row] = await db
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
      return {
        ok: false,
        status: 404,
        body: { code: 'not_found', message: `No analyzed games in this ${place} yet.` },
      };
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
    return {
      ok: false,
      status: 422,
      body: {
        code: 'not_enough_evidence',
        message:
          `${lead} A report needs ${MIN_RATED_GAMES} rated games in the last year, ` +
          `and a game counts when it has a decided result, a date, and both players' ratings.`,
      },
    };
  }

  const rows = await weaknessLeakRows(db, playerId, stream, baseline.windowStart, inTournament);
  const leaks = scoreLeaks(baseline.baseline, rows);
  const timeTrouble = scoreTimeTrouble(
    await timeTroubleCounts(db, playerId, stream, { tournamentId: inTournament }),
  );
  const composed = composeReport(leaks, timeTrouble);
  // The model no longer writes at generation - a report read must never
  // pay for every mistake at once. Cards store the template copy; the
  // click that opens a weakness buys its model line once, at the coaching
  // endpoint below. The summary is the only generation-time model call.
  const advice = new Map<string, string>();

  // ST-100. The opening plan is written from the facts alone - the advice
  // lines are written per weakness on demand and this plan never sees
  // them. Null on model failure: the narrative column stays empty and the
  // block is not rendered.
  const narrative = aiClient
    ? await summaryForReport(db, aiClient, {
        playerId,
        stream,
        tournamentId: inTournament,
        windowStart: baseline.windowStart,
        gamesCovered: baseline.baseline.games,
        timeTroubleFromMove: composed.timeTroubleFromMove,
        weaknesses: composed.weaknesses,
        advice,
      })
    : null;

  const response = await storeReport(db, {
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
    narrative,
  });

  return {
    ok: true,
    report: await withEvidence(db, playerId, stream, inTournament, baseline.windowStart, response),
  };
}

export function mountReport(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; aiClient: AiClient | null },
): void {
  app.openapi(getReport, async (c) => {
    const { stream, tournamentId } = c.req.valid('query');
    // `undefined` means the whole stream; a uuid means one tournament's games.
    const inTournament = tournamentId;

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const produced = await produceReport(deps.db, deps.aiClient, playerId, stream, inTournament);
    if (!produced.ok) {
      return c.json(produced.body, produced.status);
    }
    return c.json(produced.report, 200);
  });
  // ST-107. The curriculum page reads every assigned item, not one report's;
  // a read, so it needs no model.
  app.openapi(listActionItems, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }
    const items = await deps.db
      .select()
      .from(actionItem)
      .where(eq(actionItem.playerId, playerId))
      .orderBy(desc(actionItem.createdAt));
    return c.json(
      {
        items: items.map((item) => ({
          id: item.id,
          kind: item.kind,
          label: item.label,
          resourceIndex: item.resourceIndex,
          tier: item.tier,
          resource: item.resource,
          status: item.status,
          summary: item.summary,
          dueAt: item.dueAt.toISOString(),
          completedAt: item.completedAt?.toISOString() ?? null,
        })),
      },
      200,
    );
  });
  // The click that opens a weakness is the one place the model works per
  // mistake: the advice line is written once and stored on the weakness row,
  // and the group's three resources are assigned when absent. Re-opening the
  // weakness - or serving the report - costs no model calls, so no read can
  // stack enough provider time to meet API Gateway's cap.
  app.openapi(generateWeaknessCoaching, async (c) => {
    const body = c.req.valid('json');
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }
    // Ownership is the join's where clause: a weakness id from another
    // player's report is a plain miss.
    const [row] = await deps.db
      .select({ w: weakness, r: report })
      .from(weakness)
      .innerJoin(report, eq(weakness.reportId, report.id))
      .where(and(eq(weakness.id, body.weaknessId), eq(report.playerId, playerId)))
      .limit(1);
    if (row === undefined) {
      return c.json({ code: 'no_such_weakness', message: 'No such weakness.' }, 404);
    }
    const groupKey = groupKeyOf(row.w.kind, row.w.label, row.w.eco);
    if (groupKey === null) {
      return c.json({ code: 'no_group', message: 'The weakness has no stable group.' }, 400);
    }

    let advice = row.w.advice;
    if (advice === null && deps.aiClient !== null && row.w.kind !== 'opening') {
      const evidence = await weaknessEvidence(
        deps.db,
        playerId,
        row.r.stream,
        row.r.tournamentId ?? undefined,
        row.r.windowStart,
        [{ kind: row.w.kind, key: groupKey }],
      );
      const facts: ReportAdviceFacts = {
        kind: row.w.kind,
        label: row.w.label,
        occurrences: row.w.occurrences,
        halfPointsLost: row.w.halfPointsLost,
        gamesAffected: row.w.gamesAffected,
        ratingLeak: row.w.ratingLeak,
        saturated: row.w.saturated,
        gamesCovered: row.r.gamesCovered,
        instances: (evidence.get(`${row.w.kind}:${groupKey}`) ?? []).map((e) => ({
          moveNumber: e.moveNumber,
          moveSan: e.moveSan,
          bestMoveSan: e.bestMoveSan,
          judgement: e.judgement,
          cpLoss: e.cpLoss,
        })),
      };
      // One attempt, one corrective retry inside `generateAdvice`; a refused
      // or invalid line returns null and the card keeps its template copy.
      const [line] = await generateAdvice(deps.aiClient, [facts]);
      if (typeof line === 'string') {
        await deps.db.update(weakness).set({ advice: line }).where(eq(weakness.id, row.w.id));
        advice = line;
      }
    }

    await ensureActionItems(deps.db, deps.aiClient, playerId, [
      { kind: row.w.kind, label: row.w.label, eco: row.w.eco, groupKey, advice },
    ]);
    const items = await readItemsByGroup(deps.db, playerId, [{ kind: row.w.kind, groupKey }]);
    return c.json(
      {
        advice,
        actionItems: (items.get(`${row.w.kind}:${groupKey}`) ?? []).map(itemBody),
      },
      200,
    );
  });
  // ST-107. The assessment judges a summary per action item, so it exists
  // only when the model does, the same mount condition as the coaching routes.
  const ai = deps.aiClient;
  if (ai) {
    app.openapi(markActionItemDone, async (c) => {
      const body = c.req.valid('json');
      const session = await readSession(deps.getSession, c);
      if (session === null) {
        return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
      }
      const playerId = await getOwnPlayerId(deps.db, session.userId);
      if (playerId === null) {
        return c.json({ code: 'not_found', message: 'No such player.' }, 404);
      }
      // Only an item the player owns can be assessed; ownership is the
      // lookup's where clause, so a foreign id is a plain miss.
      const [item] = await deps.db
        .select()
        .from(actionItem)
        .where(and(eq(actionItem.id, body.actionItemId), eq(actionItem.playerId, playerId)))
        .limit(1);
      if (item === undefined) {
        return c.json({ code: 'no_such_item', message: 'No such action item.' }, 404);
      }
      if (item.status === 'completed') {
        // The prototype's guard: an already-done item never re-runs the model
        // and never re-pays the XP.
        return c.json(
          {
            pass: true,
            feedback: 'This one was already done.',
            completedAt: item.completedAt?.toISOString() ?? null,
          },
          200,
        );
      }
      let verdict;
      try {
        verdict = await ai.verifyResourceAssessment({
          label: item.label,
          resource: item.resource,
          summary: body.summary,
        });
      } catch {
        return c.json(
          { code: 'coach_unavailable', message: 'The model call failed. Nothing was stored.' },
          502,
        );
      }
      if (!verdict.pass) {
        return c.json({ pass: false, feedback: verdict.feedback, completedAt: null }, 200);
      }
      const result = await completeItem(deps.db, playerId, item.id, body.summary);
      if (result.outcome === 'no_such_item') {
        return c.json({ code: 'no_such_item', message: 'No such action item.' }, 404);
      }
      const completedAt = result.completedAt?.toISOString() ?? null;
      return c.json(
        { pass: true, feedback: verdict.feedback, completedAt: completedAt ?? null },
        200,
      );
    });
  }
}
