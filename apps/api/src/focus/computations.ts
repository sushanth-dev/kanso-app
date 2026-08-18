/**
 * ST-032. The four focus measurements, one value per window of games.
 *
 * Each computation is a pure scorer (unit-tested without a database) plus a
 * query that fetches its rows for a window's games. A scorer returns null when
 * its own denominator is too thin, which surfaces as `insufficient_evidence`
 * through `trendFor` in `verify.ts`. Every query is scoped by `playerId` at the
 * lowest level, per the story's security assessment.
 */
import { and, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, movePly } from '../db/schema.ts';
import {
  cpWinningChances,
  povChances,
  type Color,
  type EvalScore,
} from '../chess/lichess-utils.ts';
import { findCCT } from '../chess/diagnostic-utils.ts';
import { scoreTimeTrouble, timeTroubleCounts } from '../phases/phases.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** Computes one focus's value over a window of games, or null when it refuses. */
export type FocusCompute = (db: Db, playerId: string, gameIds: string[]) => Promise<number | null>;

// ─── Converting won positions ────────────────────────────────────────────────

/** A position is "won" at +2.0 or better from the player's perspective. */
export const WON_POSITION_CP = 200;
const WON_POSITION_CHANCES = cpWinningChances(WON_POSITION_CP);
/** Fewer positions at +2.0 than this in a half refuses rather than estimates. */
export const MIN_WON_POSITIONS = 3;

export function playerWon(color: Color, result: string): boolean {
  return (color === 'white' && result === '1-0') || (color === 'black' && result === '0-1');
}

export function reachedWonPosition(color: Color, evals: EvalScore[]): boolean {
  return evals.some((ev) => povChances(color, ev) >= WON_POSITION_CHANCES);
}

/** The share of +2.0 positions converted to a win, or null when too few exist. */
export function wonPositionConversion(
  games: { wonPosition: boolean; won: boolean }[],
): number | null {
  const reached = games.filter((g) => g.wonPosition).length;
  if (reached < MIN_WON_POSITIONS) return null;
  return games.filter((g) => g.wonPosition && g.won).length / reached;
}

function toEvalScore(evalCp: number | null, evalMate: number | null): EvalScore | null {
  if (evalMate !== null) return { mate: evalMate };
  if (evalCp !== null) return { cp: evalCp };
  return null;
}

export async function convertingPositionsValue(
  db: Db,
  playerId: string,
  gameIds: string[],
): Promise<number | null> {
  const games = await db
    .select({ id: game.id, playerColor: game.playerColor, result: game.result })
    .from(game)
    .where(
      and(eq(game.playerId, playerId), inArray(game.id, gameIds), isNotNull(game.playerColor)),
    );

  const plies = await db
    .select({ gameId: movePly.gameId, evalCp: movePly.evalCp, evalMate: movePly.evalMate })
    .from(movePly)
    .where(inArray(movePly.gameId, gameIds));

  const evalsByGame = new Map<string, EvalScore[]>();
  for (const ply of plies) {
    const score = toEvalScore(ply.evalCp, ply.evalMate);
    if (score === null) continue;
    const list = evalsByGame.get(ply.gameId) ?? [];
    list.push(score);
    evalsByGame.set(ply.gameId, list);
  }

  return wonPositionConversion(
    games.map((g) => {
      const color: Color = g.playerColor === 'white' ? 'white' : 'black';
      return {
        wonPosition: reachedWonPosition(color, evalsByGame.get(g.id) ?? []),
        won: playerWon(color, g.result),
      };
    }),
  );
}

// ─── Opening repertoire results ───────────────────────────────────────────────

/** Fewer opening games than this in a half refuses rather than estimates. */
export const MIN_OPENING_GAMES = 3;

/** The score a result is worth from the player's point of view, in points. */
export function playerScore(color: Color, result: string): number | null {
  if (result === '1/2-1/2') return 0.5;
  if (result === '*') return null;
  return playerWon(color, result) ? 1 : 0;
}

/** The average score per game, or null when too few games reached move 15. */
export function openingScore(scores: number[]): number | null {
  if (scores.length < MIN_OPENING_GAMES) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export async function openingResultsValue(
  db: Db,
  playerId: string,
  gameIds: string[],
): Promise<number | null> {
  const rows = await db
    .select({ id: game.id, playerColor: game.playerColor, result: game.result })
    .from(game)
    .innerJoin(movePly, eq(movePly.gameId, game.id))
    .where(
      and(
        eq(game.playerId, playerId),
        inArray(game.id, gameIds),
        isNotNull(game.playerColor),
        gte(movePly.ply, 30),
      ),
    );

  const seen = new Set<string>();
  const scores: number[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const color: Color = row.playerColor === 'white' ? 'white' : 'black';
    const score = playerScore(color, row.result);
    if (score !== null) scores.push(score);
  }
  return openingScore(scores);
}

// ─── Tactical alertness ───────────────────────────────────────────────────────

/** Fewer tactic-offering positions than this in a half refuses rather than estimates. */
export const MIN_TACTIC_POSITIONS = 10;

/** The share of offered tactics the player found, or null when too few exist. */
export function tacticFoundRate(
  positions: { fenBefore: string; playedUci: string; bestMoveSan: string | null }[],
): number | null {
  let offered = 0;
  let found = 0;
  for (const p of positions) {
    const cct = findCCT(p.fenBefore, p.bestMoveSan ?? undefined);
    if (cct.usefulCCT.length === 0) continue;
    offered++;
    if (cct.usefulCCT.some((m) => m.uci === p.playedUci)) found++;
  }
  if (offered < MIN_TACTIC_POSITIONS) return null;
  return found / offered;
}

export async function tacticalAlertnessValue(
  db: Db,
  playerId: string,
  gameIds: string[],
): Promise<number | null> {
  const playerPlies = or(
    and(sql`${movePly.ply} % 2 = 1`, eq(game.playerColor, 'white')),
    and(sql`${movePly.ply} % 2 = 0`, eq(game.playerColor, 'black')),
  );

  const rows = await db
    .select({
      fenBefore: movePly.fenBefore,
      playedUci: movePly.uci,
      bestMoveSan: movePly.bestMoveSan,
    })
    .from(movePly)
    .innerJoin(game, eq(movePly.gameId, game.id))
    .where(and(eq(game.playerId, playerId), inArray(game.id, gameIds), playerPlies));

  return tacticFoundRate(rows);
}

// ─── Time management ──────────────────────────────────────────────────────────

/** The time-trouble onset move, online only. Reuses ST-025's computation. */
export async function timeManagementValue(
  db: Db,
  playerId: string,
  gameIds: string[],
): Promise<number | null> {
  const result = scoreTimeTrouble(await timeTroubleCounts(db, playerId, 'online', gameIds));
  return result.status === 'reported' ? result.fromMove : null;
}

/** The four measurements, keyed by catalogue key. */
export const FOCUS_COMPUTE: Record<string, FocusCompute> = {
  converting_won_positions: convertingPositionsValue,
  time_management: timeManagementValue,
  opening_repertoire_results: openingResultsValue,
  tactical_alertness: tacticalAlertnessValue,
};
