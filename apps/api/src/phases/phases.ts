/**
 * ST-025. Evaluation loss by phase, and where time trouble starts, for one
 * stream.
 *
 * The split mirrors `motifs.ts` and `round-decay.ts`: {@link phaseCounts} and
 * {@link timeTroubleCounts} are the Drizzle queries, {@link scorePhases} and
 * {@link scoreTimeTrouble} are the pure scoring and refusals over those counts,
 * testable with no database, and {@link mountPhases} is the authenticated
 * handler.
 *
 * The loss currency is `mistake.cp_loss`, the one number the analysis already
 * stores, so no second definition of a mistake or of centipawns lost lives
 * here. The phase rule itself is in `analysis/phase.ts`, the clock parse in
 * `analysis/clock.ts`.
 */
import type { Context } from 'hono';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getPhases } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import type { Phase } from '../analysis/phase.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

/** A move is in time trouble when the remaining clock after it is at most this. */
export const TROUBLE_CLOCK_MS = 30_000;
/** The clock half refuses below this many clocked games. */
export const MIN_CLOCKED_GAMES = 3;
/** The clock half refuses below this many moves made under the threshold. */
export const MIN_TROUBLE_MOVES = 10;

/** The three phases, in the order a report shows them. */
const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

// ─── Phase half ──────────────────────────────────────────────────────────────

/** One phase's raw counts, as the query returns them before scoring. */
export interface PhaseCount {
  phase: Phase;
  totalLoss: number;
  games: number;
  mistakes: number;
}

/** One phase in the result, with the games behind it. */
export interface PhasePoint {
  phase: Phase;
  totalCpLoss: number;
  games: number;
}

export type PhaseResult =
  { kind: 'ok'; phases: PhasePoint[]; mistakeCount: number } | { kind: 'not_enough_evidence' };

/**
 * Score and zero-fill per-phase counts. Pure: no database, no clock.
 *
 * All three phases are returned, in fixed order, with zeroes where a phase has
 * no mistakes, so a coach sees the whole split rather than only the loud phase.
 * `completeGames === 0` is the one case that refuses rather than answers.
 */
export function scorePhases(input: { completeGames: number; counts: PhaseCount[] }): PhaseResult {
  if (input.completeGames === 0) return { kind: 'not_enough_evidence' };

  const phases: PhasePoint[] = PHASES.map((phase) => {
    const c = input.counts.find((x) => x.phase === phase);
    return { phase, totalCpLoss: c?.totalLoss ?? 0, games: c?.games ?? 0 };
  });
  const mistakeCount = input.counts.reduce((n, c) => n + c.mistakes, 0);
  return { kind: 'ok', phases, mistakeCount };
}

/** What {@link phaseCounts} returns. */
export interface PhaseQueryResult {
  completeGames: number;
  counts: PhaseCount[];
}

/**
 * Per-phase loss for one player and one stream, over analysed games only.
 *
 * Two queries, like {@link motifCounts}: the complete-game count decides the
 * empty case, and the mistake join produces the per-phase groups.
 */
export async function phaseCounts(
  db: Db,
  playerId: string,
  stream: Stream,
): Promise<PhaseQueryResult> {
  const where = and(
    eq(game.playerId, playerId),
    eq(game.stream, stream),
    eq(game.analysisStatus, 'complete'),
  );

  const [gameRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(game)
    .where(where);
  const completeGames = gameRow?.n ?? 0;

  const rows = await db
    .select({
      phase: mistake.phase,
      totalLoss: sql<number>`coalesce(sum(${mistake.cpLoss}), 0)::int`,
      games: sql<number>`count(distinct ${mistake.gameId})::int`,
      mistakes: sql<number>`count(${mistake.id})::int`,
    })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .where(where)
    .groupBy(mistake.phase);

  const counts: PhaseCount[] = [];
  for (const row of rows) {
    // `phase` is set by `phaseFor` at analysis time, so null here is a row
    // analysed before this story. It contributes to nothing and is not hidden.
    if (row.phase === null) continue;
    counts.push({
      phase: row.phase,
      totalLoss: row.totalLoss,
      games: row.games,
      mistakes: row.mistakes,
    });
  }
  return { completeGames, counts };
}

// ─── Time-trouble half ───────────────────────────────────────────────────────

/** What {@link timeTroubleCounts} returns, one aggregate row over clocked moves. */
export interface TimeTroubleCounts {
  clockedGames: number;
  troubleMoves: number;
  troubleMistakes: number;
  calmMoves: number;
  calmMistakes: number;
  /** Earliest full-move number the player's clock was under the threshold, or null. */
  fromMove: number | null;
}

export type TimeTroubleResult =
  | {
      status: 'reported';
      clockedGames: number;
      fromMove: number;
      troubleMoves: number;
      troubleMistakeRate: number;
      calmMoves: number;
      calmMistakeRate: number;
    }
  | { status: 'unavailable'; reason: 'not_online' | 'no_clock_data' | 'not_enough_evidence' };

function rate(mistakes: number, moves: number): number {
  if (moves === 0) return 0;
  return Math.round((mistakes / moves) * 10000) / 10000;
}

/**
 * Score and refuse the time-trouble counts. Pure: no database, no clock.
 *
 * The tournament stream is answered with a reason, not a number. No clocked
 * games is `no_clock_data`; a thin history is `not_enough_evidence`, following
 * the ST-019 precedent of refusing rather than drawing a trend through noise.
 */
export function scoreTimeTrouble(
  stream: Stream,
  counts: TimeTroubleCounts | null,
): TimeTroubleResult {
  if (stream === 'tournament') return { status: 'unavailable', reason: 'not_online' };
  if (counts === null || counts.clockedGames === 0) {
    return { status: 'unavailable', reason: 'no_clock_data' };
  }
  if (counts.clockedGames < MIN_CLOCKED_GAMES || counts.troubleMoves < MIN_TROUBLE_MOVES) {
    return { status: 'unavailable', reason: 'not_enough_evidence' };
  }

  return {
    status: 'reported',
    clockedGames: counts.clockedGames,
    fromMove: counts.fromMove ?? 0,
    troubleMoves: counts.troubleMoves,
    troubleMistakeRate: rate(counts.troubleMistakes, counts.troubleMoves),
    calmMoves: counts.calmMoves,
    calmMistakeRate: rate(counts.calmMistakes, counts.calmMoves),
  };
}

/**
 * Bucket the player's clocked online moves at the trouble threshold, entirely
 * in SQL, so a large history is aggregated in the database rather than pulled
 * into JavaScript.
 */
export async function timeTroubleCounts(
  db: Db,
  playerId: string,
  gameIds?: string[],
): Promise<TimeTroubleCounts> {
  const [gameRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(game)
    .where(
      and(
        eq(game.playerId, playerId),
        eq(game.stream, 'online'),
        eq(game.analysisStatus, 'complete'),
        eq(game.hasClockData, true),
        gameIds === undefined ? undefined : inArray(game.id, gameIds),
      ),
    );
  const clockedGames = gameRow?.n ?? 0;

  // The player's own plies, by colour parity against `game.playerColor`.
  const playerPlies = or(
    and(sql`${movePly.ply} % 2 = 1`, eq(game.playerColor, 'white')),
    and(sql`${movePly.ply} % 2 = 0`, eq(game.playerColor, 'black')),
  );

  const [row] = await db
    .select({
      troubleMoves: sql<number>`count(*) filter (where ${movePly.clockMs} <= ${TROUBLE_CLOCK_MS})::int`,
      troubleMistakes: sql<number>`count(*) filter (where ${movePly.clockMs} <= ${TROUBLE_CLOCK_MS} and ${mistake.id} is not null)::int`,
      calmMoves: sql<number>`count(*) filter (where ${movePly.clockMs} > ${TROUBLE_CLOCK_MS})::int`,
      calmMistakes: sql<number>`count(*) filter (where ${movePly.clockMs} > ${TROUBLE_CLOCK_MS} and ${mistake.id} is not null)::int`,
      fromPly: sql<
        number | null
      >`min(${movePly.ply}) filter (where ${movePly.clockMs} <= ${TROUBLE_CLOCK_MS})`,
    })
    .from(movePly)
    .innerJoin(game, eq(movePly.gameId, game.id))
    .leftJoin(mistake, and(eq(mistake.gameId, movePly.gameId), eq(mistake.ply, movePly.ply)))
    .where(
      and(
        eq(game.playerId, playerId),
        eq(game.stream, 'online'),
        eq(game.analysisStatus, 'complete'),
        eq(game.hasClockData, true),
        gameIds === undefined ? undefined : inArray(game.id, gameIds),
        isNotNull(movePly.clockMs),
        playerPlies,
      ),
    );

  return {
    clockedGames,
    troubleMoves: row?.troubleMoves ?? 0,
    troubleMistakes: row?.troubleMistakes ?? 0,
    calmMoves: row?.calmMoves ?? 0,
    calmMistakes: row?.calmMistakes ?? 0,
    fromMove: row?.fromPly == null ? null : Math.ceil(row.fromPly / 2),
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export function mountPhases(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getPhases, async (c) => {
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

    const phase = scorePhases(await phaseCounts(deps.db, playerId, stream));
    if (phase.kind === 'not_enough_evidence') {
      return c.json(
        { code: 'not_enough_evidence', message: 'No analysed games in this stream.' },
        422,
      );
    }

    // The clock half is online-only: for the tournament stream it is answered
    // as unavailable rather than queried and returned empty.
    const timeTrouble = scoreTimeTrouble(
      stream,
      stream === 'tournament' ? null : await timeTroubleCounts(deps.db, playerId),
    );

    return c.json(
      {
        playerId,
        stream,
        phases: phase.phases,
        mistakeCount: phase.mistakeCount,
        timeTrouble,
      },
      200,
    );
  });
}
