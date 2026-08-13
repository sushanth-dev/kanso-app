/**
 * Aggregate a player's openings by leak score, for one stream.
 *
 * The port of the prototype's `get-opening-leaks.ts`. Two things change on the
 * way over, both from the story (ST-004): openings group by ECO code, not by
 * the PGN's opening name, so one opening is one row however the provider spelled
 * it; and tournament and online never blend (F1), so this takes a stream and has
 * no mode that returns a combined result.
 *
 * The split the story asks for is kept: {@link openingLeaks} is the Drizzle
 * query that produces per-opening counts, {@link scoreOpenings} is the pure
 * scoring, threshold, and banding over those counts, testable with no database.
 *
 * This adds no HTTP endpoint. It is a query and a function, reachable only from
 * code we write, and the endpoint that exposes it is deferred until the report
 * has a rating-leak currency to denominate it in (story Notes, backlog item 9).
 * The one security property it must hold now is that the query filters on
 * `player_id` in the database, so a caller that forgets to check a claim still
 * cannot read across players.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, mistake } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

/** An opening is not reported until the stream holds at least this many games in it. */
export const MIN_GAMES = 2;

/** Above this many mistakes per game is a high-risk opening. */
export const HIGH_BAND = 1.5;
/** Below this is low-risk. Between the two is neutral. */
export const LOW_BAND = 0.5;

export type RiskBand = 'high' | 'neutral' | 'low';

/** One opening's raw counts, as the query returns them before scoring. */
export interface OpeningCount {
  eco: string;
  /** The opening name from the most recent game in the group, for display only. */
  openingName: string | null;
  games: number;
  mistakes: number;
}

/** One scored opening in the ranked result. */
export interface OpeningLeak extends OpeningCount {
  /** Mistakes per game. The whole point of the aggregation. */
  leakScore: number;
  band: RiskBand;
}

export interface OpeningLeakResult {
  /** Openings that cleared the threshold, ranked by leak score, worst first. */
  leaks: OpeningLeak[];
  /**
   * How many openings were held back for having fewer than {@link MIN_GAMES}
   * games. Reported rather than silently omitted, so a thin history reads as
   * thin rather than clean.
   */
  withheld: number;
}

function bandFor(leakScore: number): RiskBand {
  if (leakScore > HIGH_BAND) return 'high';
  if (leakScore < LOW_BAND) return 'low';
  return 'neutral';
}

/**
 * Score, threshold, and rank per-opening counts. Pure: no database, no clock.
 *
 * The threshold is applied here rather than in SQL so the count of withheld
 * openings is a by-product of the same pass that builds the ranking.
 */
export function scoreOpenings(counts: OpeningCount[]): OpeningLeakResult {
  const leaks: OpeningLeak[] = [];
  let withheld = 0;

  for (const c of counts) {
    if (c.games < MIN_GAMES) {
      withheld++;
      continue;
    }
    const leakScore = c.mistakes / c.games;
    leaks.push({ ...c, leakScore, band: bandFor(leakScore) });
  }

  // Worst first. ECO breaks ties so the same counts rank the same every time.
  leaks.sort((a, b) => b.leakScore - a.leakScore || a.eco.localeCompare(b.eco));
  return { leaks, withheld };
}

/**
 * Per-opening counts for one player and one stream, over analyzed games only.
 *
 * Only `complete` games are counted, so an opening does not look clean because
 * its games were never analyzed. Games with no ECO cannot be attributed to an
 * opening and are left out; grouping is on ECO, and a null key is not an
 * opening.
 *
 * The left join to `mistake` fans a game's row out per mistake, which is why the
 * game count is `count(distinct game.id)` and the mistake count is
 * `count(mistake.id)` — a game with no mistakes contributes one null-id row that
 * counts as zero.
 */
export async function openingLeaks(
  db: Db,
  playerId: string,
  stream: Stream,
  tournament?: string,
): Promise<OpeningLeakResult> {
  const rows = await db
    .select({
      eco: game.eco,
      games: sql<number>`count(distinct ${game.id})::int`,
      mistakes: sql<number>`count(${mistake.id})::int`,
      // Opening name from the most recent game in the group. `desc nulls last`
      // so an undated game does not win the slot over a dated one.
      openingName: sql<
        string | null
      >`(array_agg(${game.opening} order by ${game.playedAt} desc nulls last))[1]`,
    })
    .from(game)
    .leftJoin(mistake, eq(mistake.gameId, game.id))
    .where(
      and(
        eq(game.playerId, playerId),
        eq(game.stream, stream),
        tournament ? eq(game.tournamentId, tournament) : undefined,
        eq(game.analysisStatus, 'complete'),
        isNotNull(game.eco),
      ),
    )
    .groupBy(game.eco);

  return scoreOpenings(rows.map((r) => ({ ...r, eco: r.eco as string })));
}
