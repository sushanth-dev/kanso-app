/**
 * ST-154. Missed-punishment tracking: the times the opponent blundered and
 * the player did not convert the gained advantage.
 *
 * The detector is read-only over `move_ply`. It never writes a `mistake` row
 * for the opponent, and it never joins the opponent's plies into any existing
 * aggregate - the opening-leak aggregation counts `mistake` rows with no
 * colour filter, which is why the player-only invariant on those rows is
 * guarded by tests. This module is the mirror image of the player's mistakes
 * and stays strictly on its own read path.
 *
 * Definitions, pinned here and by the golden tests:
 * - A punishable error is an opponent ply the classifier calls a Blunder,
 *   `classifyMove` verbatim with the opponent as the mover. No second
 *   definition of a blunder is written.
 * - The blunder gains an advantage when the player-perspective evaluation
 *   after it is at least {@link GAINED_ADVANTAGE_CP} or mate in the player's
 *   favour.
 * - The conversion is missed when any later ply boundary before game end
 *   falls below {@link HOLD_FLOOR_CP} in the player's perspective. The hold
 *   window is the remainder of the game, not a fixed ply count: a fixed
 *   count would call a win held for forty moves "missed" at ply forty-one.
 *
 * One boundary the stored data does not settle: the final position's
 * evaluation is not written to `move_ply` (each row stores the evaluation
 * before its ply), so a blunder on the last ply has no after-evaluation and a
 * slip visible only in the final position has no boundary to fall through.
 * Both are skipped. Undercounting an edge is the honest failure; inventing an
 * evaluation is not.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, movePly } from '../db/schema.ts';
import { classifyMove, type Color, type EvalScore } from '../chess/lichess-utils.ts';
import { leakScope } from './leak.ts';
import { SEASON_WINDOW_MS } from './performance-rating.ts';
import type { Phase } from './phase.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

/** The player-perspective evaluation after the opponent's blunder that counts as a gained advantage. */
export const GAINED_ADVANTAGE_CP = 150;
/** The player-perspective evaluation a gained advantage must stay above to count as converted. */
export const HOLD_FLOOR_CP = 50;
/** Mate is the largest advantage there is; the sentinel only has to clear every cp value. */
const MATE_SENTINEL_CP = 10000;
/** The rolling window beside the season count. */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/** The instances the report renders, the same cap the weakness evidence uses. */
const INSTANCES_SHOWN = 3;

/** One stored `move_ply` row, the only fields the detector reads. */
export interface PunishmentPly {
  ply: number;
  movingColor: Color;
  evalCp: number | null;
  evalMate: number | null;
  phase: Phase | null;
}

/** One missed conversion, as the report's evidence renders it. */
export interface MissedPunishmentInstance {
  gameId: string;
  whiteName: string | null;
  blackName: string | null;
  playedAt: string | null;
  /** The opponent's blundering ply, where the deep link lands. */
  ply: number;
  /** The ply played from the position where the advantage fell below the hold floor. */
  slipPly: number;
  /** The phase of the slip position, the group the drill routes into. */
  slipPhase: Phase | null;
}

export interface MissedPunishment {
  seasonCount: number;
  thirtyDayCount: number;
  instances: MissedPunishmentInstance[];
}

function evalScoreOf(p: PunishmentPly): EvalScore {
  if (p.evalMate !== null) return { mate: p.evalMate };
  if (p.evalCp === null) throw new Error(`ply ${p.ply} has no evaluation`);
  return { cp: p.evalCp };
}

/** The evaluation at one boundary, in the player's perspective, as centipawns. */
function playerPovCp(p: PunishmentPly, playerColor: Color): number {
  if (p.evalMate !== null) {
    const povMate = playerColor === 'white' ? p.evalMate : -p.evalMate;
    return povMate > 0 ? MATE_SENTINEL_CP : -MATE_SENTINEL_CP;
  }
  const cp = p.evalCp!;
  return playerColor === 'white' ? cp : -cp;
}

/** One detected miss before the game's names and date are attached. */
export interface DetectedMiss {
  blunderPly: number;
  slipPly: number;
  slipPhase: Phase | null;
}

/**
 * The pure detector over one game's stored plies. Golden tests pin it: a
 * converted blunder, a missed one, the borderline hold at exactly the floor,
 * and the mate rule.
 */
export function detectMissedPunishments(
  playerColor: Color,
  plies: PunishmentPly[],
): DetectedMiss[] {
  const misses: DetectedMiss[] = [];
  for (let i = 0; i < plies.length; i++) {
    const blunderPly = plies[i]!;
    if (blunderPly.movingColor === playerColor) continue;
    // The evaluation after this ply is the next ply's before-evaluation; a
    // blunder on the last ply has no stored after-evaluation and is skipped.
    const after = plies[i + 1];
    if (after === undefined) continue;

    const advice = classifyMove(
      blunderPly.movingColor,
      evalScoreOf(blunderPly),
      evalScoreOf(after),
    );
    if (advice?.judgement !== 'Blunder') continue;

    if (playerPovCp(after, playerColor) < GAINED_ADVANTAGE_CP) continue;

    // The gain position itself is the boundary at i+1; the hold scan starts
    // one boundary later, at the evaluation before ply i+2.
    for (let j = i + 2; j < plies.length; j++) {
      const boundary = plies[j]!;
      if (playerPovCp(boundary, playerColor) < HOLD_FLOOR_CP) {
        misses.push({
          blunderPly: blunderPly.ply,
          slipPly: boundary.ply,
          slipPhase: boundary.phase,
        });
        break;
      }
    }
  }
  return misses;
}

/**
 * The missed-punishment figure for one report scope: the season-window count,
 * the rolling thirty-day count beside it, and the most recent instances for
 * the deep links. The rolling window anchors at the season window's end (the
 * latest rated game's date), the same anchor the report's `windowEnd` uses,
 * so the two counts move with the data rather than with the clock.
 */
export async function missedPunishments(
  db: Db,
  playerId: string,
  stream: Stream,
  windowStart: Date | null,
  tournamentId?: string,
): Promise<MissedPunishment> {
  if (windowStart === null) return { seasonCount: 0, thirtyDayCount: 0, instances: [] };

  const rows = await db
    .select({
      gameId: movePly.gameId,
      ply: movePly.ply,
      fenBefore: movePly.fenBefore,
      evalCp: movePly.evalCp,
      evalMate: movePly.evalMate,
      phase: movePly.phase,
      playerColor: game.playerColor,
      whiteName: game.whiteName,
      blackName: game.blackName,
      playedAt: game.playedAt,
    })
    .from(movePly)
    .innerJoin(game, eq(movePly.gameId, game.id))
    .where(and(leakScope(playerId, stream, windowStart, tournamentId)))
    .orderBy(asc(movePly.gameId), asc(movePly.ply));

  const thirtyDayStart = new Date(windowStart.getTime() + SEASON_WINDOW_MS - THIRTY_DAYS_MS);

  interface GameRun {
    playerColor: Color;
    playedAt: Date | null;
    whiteName: string | null;
    blackName: string | null;
    plies: PunishmentPly[];
  }
  const games = new Map<string, GameRun>();
  for (const row of rows) {
    let run = games.get(row.gameId);
    if (run === undefined) {
      if (row.playerColor === null) continue;
      run = {
        playerColor: row.playerColor,
        playedAt: row.playedAt,
        whiteName: row.whiteName,
        blackName: row.blackName,
        plies: [],
      };
      games.set(row.gameId, run);
    }
    // `move_ply` stores no moving-colour column; the side to move is the FEN's
    // second field, the same read the review surface makes.
    const movingColor = row.fenBefore.split(' ')[1] === 'b' ? 'black' : 'white';
    run.plies.push({
      ply: row.ply,
      movingColor,
      evalCp: row.evalCp,
      evalMate: row.evalMate,
      phase: row.phase,
    });
  }

  const instances: MissedPunishmentInstance[] = [];
  for (const [gameId, run] of games) {
    for (const miss of detectMissedPunishments(run.playerColor, run.plies)) {
      instances.push({
        gameId,
        whiteName: run.whiteName,
        blackName: run.blackName,
        playedAt: run.playedAt?.toISOString() ?? null,
        ply: miss.blunderPly,
        slipPly: miss.slipPly,
        slipPhase: miss.slipPhase,
      });
    }
  }
  instances.sort((a, b) => (b.playedAt ?? '').localeCompare(a.playedAt ?? ''));

  const thirtyDayCount = instances.filter(
    (inst) => inst.playedAt !== null && new Date(inst.playedAt) >= thirtyDayStart,
  ).length;

  return {
    seasonCount: instances.length,
    thirtyDayCount,
    instances: instances.slice(0, INSTANCES_SHOWN),
  };
}
