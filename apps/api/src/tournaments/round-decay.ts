/**
 * ST-019. Attribute a player's evaluation loss to each round of a tournament.
 *
 * The metric is the average centipawn loss per player move, per round, from the
 * existing `mistake` analysis. `mistake.cp_loss` is already "centipawns lost by
 * the mover" and is populated only for the player's own plies, so summing it
 * over a round's mistakes is the round's total loss, and dividing by the number
 * of plies the player made spreads that loss over every move, clean ones
 * included. That is the decay signal: a round where the player blunders more
 * often and worse reads higher than one where they blunder once badly.
 *
 * The split mirrors `opening-leaks.ts`: {@link roundDecay} is the Drizzle query
 * that produces per-round counts, {@link scoreRoundDecay} is the pure scoring
 * and too-thin refusal over those counts, testable with no database, and
 * {@link mountRoundDecay} is the authenticated HTTP handler.
 *
 * The query scopes to one tournament, filters to `complete` games in SQL before
 * any row is read, and never loads broad to aggregate in JavaScript. A game
 * with no round is excluded, because there is no round to attribute it to.
 */
import type { Context } from 'hono';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getRoundDecay } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, mistake, tournament } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** A trend is not reported until the tournament holds at least this many rounds. */
export const MIN_ROUNDS = 2;
/** A round is not reported until it holds at least this many complete games. */
export const MIN_GAMES_PER_ROUND = 3;

/** One round's raw counts, as the queries return them before scoring. */
export interface RoundCount {
  /** The round number, ascending, non-null because unnumbered games are excluded. */
  round: number;
  /** Unique complete games in this round; what the average rests on. */
  games: number;
  /** Raw mistake rows in this round; kept separate from games so the fan-out never masquerades as the game count. */
  mistakes: number;
  /** Sum of `mistake.cp_loss` over the round, in centipawns. */
  totalLoss: number;
  /** The number of plies the player made in the round, the metric's denominator. */
  playerMoves: number;
}

/** One round in the scored result. */
export interface RoundDecayPoint {
  round: number;
  games: number;
  mistakes: number;
  /** `totalLoss / playerMoves`, in centipawns. Null when the round has no moves. */
  lossPerMove: number | null;
}

export type RoundDecayResult =
  { kind: 'ok'; rounds: RoundDecayPoint[]; roundCount: number } | { kind: 'not_enough_evidence' };

/**
 * Score, threshold, and shape per-round counts. Pure: no database, no clock.
 *
 * The threshold is applied here rather than in SQL so a refusal names the
 * evidence rather than hiding it. A round with no complete games never reaches
 * this function because the query produces no row for it, so an absent round is
 * absent from the result, and a round with games but no mistakes scores zero.
 */
export function scoreRoundDecay(rows: RoundCount[]): RoundDecayResult {
  if (rows.length < MIN_ROUNDS) return { kind: 'not_enough_evidence' };
  for (const row of rows) {
    if (row.games < MIN_GAMES_PER_ROUND) return { kind: 'not_enough_evidence' };
  }
  const rounds = rows.map((row) => ({
    round: row.round,
    games: row.games,
    mistakes: row.mistakes,
    lossPerMove: row.playerMoves > 0 ? row.totalLoss / row.playerMoves : null,
  }));
  // Round order is the deterministic shape, not which round has the most
  // games, so the sort is on the round number alone.
  rounds.sort((a, b) => a.round - b.round);
  return { kind: 'ok', rounds, roundCount: rounds.length };
}
/**
 * Per-round counts for one tournament, over analyzed (complete) games only.
 *
 * Two queries because the denominator is a per-game quantity and the mistake
 * join fans a game out per mistake: summing `player_moves` over that join would
 * multiply each game's moves by its mistake count. The loss and move queries
 * share the same filter, so they agree on which rounds exist, and are joined in
 * JavaScript by round number rather than in a second SQL join.
 */
export async function roundDecay(db: Db, tournamentId: string): Promise<RoundCount[]> {
  const where = and(
    eq(game.tournamentId, tournamentId),
    eq(game.analysisStatus, 'complete'),
    isNotNull(game.round),
  );

  const lossRows = await db
    .select({
      round: game.round,
      games: sql<number>`count(distinct ${game.id})::int`,
      mistakes: sql<number>`count(${mistake.id})::int`,
      totalLoss: sql<number>`coalesce(sum(${mistake.cpLoss}), 0)::int`,
    })
    .from(game)
    .leftJoin(mistake, eq(mistake.gameId, game.id))
    .where(where)
    .groupBy(game.round)
    .orderBy(game.round);

  // The player's ply count per game: white plays the odd plies (ceil n/2),
  // black the even (floor n/2). `move_count` is the total ply count, set at
  // import from `chess.history().length`.
  const moveRows = await db
    .select({
      round: game.round,
      playerMoves: sql<number>`sum(
        case when ${game.playerColor} = 'white'
          then (coalesce(${game.moveCount}, 0) + 1) / 2
          else coalesce(${game.moveCount}, 0) / 2
        end
      )::int`,
    })
    .from(game)
    .where(where)
    .groupBy(game.round);

  const movesByRound: Record<number, number> = {};
  for (const row of moveRows) {
    movesByRound[row.round as number] = row.playerMoves;
  }
  return lossRows.map((r) => ({
    round: r.round as number,
    games: r.games,
    mistakes: r.mistakes,
    totalLoss: r.totalLoss,
    playerMoves: movesByRound[r.round as number] ?? 0,
  }));
}

export function mountRoundDecay(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getRoundDecay, async (c) => {
    const { tournamentId } = c.req.valid('param');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const [row] = await deps.db
      .select({ playerId: tournament.playerId })
      .from(tournament)
      .where(eq(tournament.id, tournamentId))
      .limit(1);
    // A tournament that does not exist and one the caller has no claim on both
    // answer 403, so the id cannot be used to enumerate which tournaments exist.
    if (!row || !(await hasPlayerClaim(deps.db, session.userId, row.playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your tournament.' }, 403);
    }

    const result = scoreRoundDecay(await roundDecay(deps.db, tournamentId));
    if (result.kind === 'not_enough_evidence') {
      return c.json(
        {
          code: 'not_enough_evidence',
          message: 'Not enough evidence to report a trend.',
        },
        422,
      );
    }

    return c.json({ tournamentId, rounds: result.rounds, roundCount: result.roundCount }, 200);
  });
}
