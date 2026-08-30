/**
 * ST-026. The rating leak per weakness kind, for one player and one stream.
 *
 * The leak is the story's currency: half-points actually lost, converted to
 * rating points a season through performance rating. It is computed over the
 * season's rated games only, because a performance rating against unknown
 * opposition is a number from nothing.
 *
 * The split mirrors `motifs.ts`: {@link leakBaseline} and
 * {@link weaknessLeakRows} are the Drizzle queries, {@link scoreLeaks} is the
 * pure scoring over their output, testable with no database. There is no
 * handler here: ST-027 composes and ranks these figures into the report and
 * owns the endpoint.
 */
import { and, desc, eq, gte, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly } from '../db/schema.ts';
import { TROUBLE_CLOCK_MS } from '../phases/phases.ts';
import {
  leakForWeakness,
  MIN_RATED_GAMES,
  SEASON_WINDOW_MS,
  type SeasonBaseline,
} from './performance-rating.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

export type WeaknessKind = 'opening' | 'motif' | 'phase' | 'time_trouble';

/** One weakness's leak, before ST-027 composes and ranks it. */
export interface WeaknessLeak {
  kind: WeaknessKind;
  /** The group key: an ECO code, a motif name, a phase, or `time_trouble`. */
  key: string;
  /** Display label: an opening name, a humanized motif or phase, or `Time trouble`. */
  label: string;
  /** The ECO code for an opening, null for every other kind. */
  eco: string | null;
  halfPointsLost: number;
  occurrences: number;
  gamesAffected: number;
  ratingLeak: number;
  /** True when the weakness saturates the season; the leak is then a floor. */
  saturated: boolean;
}

export type LeakResult =
  | { kind: 'ok'; baseline: SeasonBaseline; weaknesses: WeaknessLeak[] }
  | { kind: 'not_enough_evidence'; ratedGames: number };

/** The opponent's Elo, read from the player's colour. */
const opponentElo = sql`case when ${game.playerColor} = 'white' then ${game.blackElo} else ${game.whiteElo} end`;

/** The player's score for one game, from the stored colour and result. */
const playerScore = sql`case
  when ${game.result} = '1/2-1/2' then 0.5
  when ${game.playerColor} = 'white' and ${game.result} = '1-0' then 1.0
  when ${game.playerColor} = 'black' and ${game.result} = '0-1' then 1.0
  else 0.0
end`;

/** A rated game: a decided result against an opponent with a known Elo and a date. */
const ratedGame = and(
  isNotNull(game.playedAt),
  isNotNull(game.playerColor),
  ne(game.result, '*'),
  sql`${opponentElo} is not null`,
);

const sumHalfPoints = sql<number>`coalesce(sum(${mistake.halfPointsLost}), 0)::float8`;
const countOccurrences = sql<number>`count(${mistake.id})::int`;
const countGames = sql<number>`count(distinct ${mistake.gameId})::int`;

/** One aggregated group's raw counts, as the queries return them before scoring. */
export interface LeakRow {
  kind: WeaknessKind;
  key: string;
  label: string;
  eco: string | null;
  halfPointsLost: number;
  occurrences: number;
  gamesAffected: number;
}

/**
 * The season baseline for one stream: the number of rated games, the player's
 * score, and the average opponent rating, over the season window. Refuses
 * below {@link MIN_RATED_GAMES}, in the ST-019 and ST-024 shape.
 */
export async function leakBaseline(
  db: Db,
  playerId: string,
  stream: Stream,
): Promise<
  | { kind: 'ok'; baseline: SeasonBaseline; windowStart: Date }
  | { kind: 'not_enough_evidence'; ratedGames: number }
> {
  const [latest] = await db
    .select({ playedAt: game.playedAt })
    .from(game)
    .where(
      and(
        eq(game.playerId, playerId),
        eq(game.stream, stream),
        eq(game.analysisStatus, 'complete'),
        ratedGame,
      ),
    )
    .orderBy(desc(game.playedAt))
    .limit(1);

  if (latest?.playedAt == null) return { kind: 'not_enough_evidence', ratedGames: 0 };
  const windowStart = new Date(latest.playedAt.getTime() - SEASON_WINDOW_MS);

  const [row] = await db
    .select({
      games: sql<number>`count(*)::int`,
      score: sql<number>`coalesce(sum(${playerScore}), 0)::float8`,
      avgOpponentElo: sql<number>`coalesce(avg(${opponentElo}), 0)::float8`,
    })
    .from(game)
    .where(
      and(
        eq(game.playerId, playerId),
        eq(game.stream, stream),
        eq(game.analysisStatus, 'complete'),
        ratedGame,
        gte(game.playedAt, windowStart),
      ),
    );

  const baseline: SeasonBaseline = {
    games: row?.games ?? 0,
    score: row?.score ?? 0,
    avgOpponentElo: row?.avgOpponentElo ?? 0,
  };
  if (baseline.games < MIN_RATED_GAMES)
    return { kind: 'not_enough_evidence', ratedGames: baseline.games };

  return { kind: 'ok', baseline, windowStart };
}

/**
 * Per-kind weakness rows over the season's rated games, grouped by kind and
 * key, summing half-points lost. Three kinds group by a stored column; time
 * trouble groups the mistakes made inside the trouble window, joined to
 * `move_ply` on the game and ply.
 */
export async function weaknessLeakRows(
  db: Db,
  playerId: string,
  stream: Stream,
  windowStart: Date,
): Promise<LeakRow[]> {
  const scope = and(
    eq(game.playerId, playerId),
    eq(game.stream, stream),
    eq(game.analysisStatus, 'complete'),
    ratedGame,
    gte(game.playedAt, windowStart),
  );

  const openings = await db
    .select({
      key: game.eco,
      // The opening name is display-only, from the most recent game in the
      // group, the same rule `opening-leaks.ts` uses so the two never disagree.
      label: sql<
        string | null
      >`(array_agg(${game.opening} order by ${game.playedAt} desc nulls last))[1]`,
      halfPointsLost: sumHalfPoints,
      occurrences: countOccurrences,
      gamesAffected: countGames,
    })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .where(and(scope, isNotNull(game.eco)))
    .groupBy(game.eco);

  const motifs = await db
    .select({
      key: mistake.motif,
      halfPointsLost: sumHalfPoints,
      occurrences: countOccurrences,
      gamesAffected: countGames,
    })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .where(and(scope, isNotNull(mistake.motif)))
    .groupBy(mistake.motif);

  const phases = await db
    .select({
      key: mistake.phase,
      halfPointsLost: sumHalfPoints,
      occurrences: countOccurrences,
      gamesAffected: countGames,
    })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .where(and(scope, isNotNull(mistake.phase)))
    .groupBy(mistake.phase);

  const [trouble] = await db
    .select({
      halfPointsLost: sumHalfPoints,
      occurrences: countOccurrences,
      gamesAffected: countGames,
    })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .innerJoin(movePly, and(eq(movePly.gameId, mistake.gameId), eq(movePly.ply, mistake.ply)))
    .where(and(scope, lte(movePly.clockMs, TROUBLE_CLOCK_MS)));

  const rows: LeakRow[] = [
    ...openings.flatMap((r) => (r.key == null ? [] : [asRow('opening', r.key, r.key, r.label, r)])),
    ...motifs.flatMap((r) => (r.key == null ? [] : [asRow('motif', r.key, null, null, r)])),
    ...phases.flatMap((r) => (r.key == null ? [] : [asRow('phase', r.key, null, null, r)])),
  ];

  if (trouble && trouble.occurrences > 0) {
    rows.push(asRow('time_trouble', 'time_trouble', null, null, trouble));
  }

  return rows;
}

/** Human display labels for the kinds whose key is not already a name. */
const HUMAN_LABELS: Record<string, string> = {
  hanging_piece: 'Hanging piece',
  missed_check: 'Missed check',
  missed_capture: 'Missed capture',
  missed_threat: 'Missed threat',
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
  time_trouble: 'Time trouble',
};

function asRow(
  kind: WeaknessKind,
  key: string,
  eco: string | null,
  label: string | null,
  r: { halfPointsLost: number; occurrences: number; gamesAffected: number },
): LeakRow {
  return {
    kind,
    key,
    label: label ?? HUMAN_LABELS[key] ?? key,
    eco,
    halfPointsLost: r.halfPointsLost,
    occurrences: r.occurrences,
    gamesAffected: r.gamesAffected,
  };
}

/**
 * Convert each group's half-points to rating points and order worst first. The
 * order is not the rank: ST-027 assigns `rank` when it composes the report.
 */
export function scoreLeaks(baseline: SeasonBaseline, rows: LeakRow[]): WeaknessLeak[] {
  return rows
    .map((r) => {
      const { ratingLeak, saturated } = leakForWeakness(baseline, r.halfPointsLost);
      return { ...r, ratingLeak, saturated };
    })
    .sort(
      (a, b) =>
        b.halfPointsLost - a.halfPointsLost ||
        a.kind.localeCompare(b.kind) ||
        a.key.localeCompare(b.key),
    );
}

/** The whole computation: baseline, per-kind aggregation, conversion, refusal. */
export async function computeLeaks(db: Db, playerId: string, stream: Stream): Promise<LeakResult> {
  const baseline = await leakBaseline(db, playerId, stream);
  if (baseline.kind === 'not_enough_evidence') return baseline;
  const rows = await weaknessLeakRows(db, playerId, stream, baseline.windowStart);
  return {
    kind: 'ok',
    baseline: baseline.baseline,
    weaknesses: scoreLeaks(baseline.baseline, rows),
  };
}
