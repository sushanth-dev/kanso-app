/**
 * One game with its per-ply evaluations and classified mistakes.
 *
 * This is the read endpoint the review surface renders. Ownership runs through
 * the player rather than the game, the same rule as the other games endpoints:
 * a game that does not exist is a 404, one the caller does not own is a 403.
 *
 * The response reuses `toGameSummary` for the metadata and appends the PGN,
 * the plies and the mistakes. A ply's `bestMoveUci` is served here too, so the
 * review board can draw the engine's best move without a SAN parser in the
 * client: the from/to are already the `move_ply` row the frontend joins by
 * `ply` for the played move's `uci`.
 */
import type { Context } from 'hono';
import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getGame } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { toGameSummary } from './game-summary.ts';

type Db = PostgresJsDatabase<typeof schema>;
type MovePlyRow = typeof movePly.$inferSelect;
type MistakeRow = typeof mistake.$inferSelect;

function toMovePlyResponse(row: MovePlyRow) {
  return {
    ply: row.ply,
    san: row.san,
    uci: row.uci,
    fenBefore: row.fenBefore,
    phase: row.phase,
    // The contract says an evaluation has exactly one of cp or mate set; a ply
    // with neither is a ply that was never evaluated, served as null.
    evaluation:
      row.evalCp === null && row.evalMate === null ? null : { cp: row.evalCp, mate: row.evalMate },
    bestMoveSan: row.bestMoveSan,
    bestMoveUci: row.bestMoveUci,
    clockMs: row.clockMs,
    moveTimeMs: row.moveTimeMs,
  };
}

function toMistakeResponse(row: MistakeRow) {
  return {
    id: row.id,
    gameId: row.gameId,
    ply: row.ply,
    moveNumber: row.moveNumber,
    movingColor: row.movingColor,
    phase: row.phase,
    fen: row.fen,
    moveSan: row.moveSan,
    bestMoveSan: row.bestMoveSan,
    evalBefore: { cp: row.evalBeforeCp, mate: row.evalBeforeMate },
    evalAfter: { cp: row.evalAfterCp, mate: row.evalAfterMate },
    judgement: row.judgement,
    cpLoss: row.cpLoss,
    winProbDrop: row.winProbDrop,
    motif: row.motif,
    crossedResultBoundary: row.crossedResultBoundary,
    halfPointsLost: row.halfPointsLost,
    explanation: row.explanation,
  };
}

export function mountGetGame(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getGame, async (c) => {
    const { gameId } = c.req.valid('param');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const [row] = await deps.db.select().from(game).where(eq(game.id, gameId)).limit(1);
    if (row === undefined) {
      return c.json({ code: 'not_found', message: 'No such game.' }, 404);
    }
    if (!(await hasPlayerClaim(deps.db, session.userId, row.playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your game.' }, 403);
    }

    const [plies, mistakes] = await Promise.all([
      deps.db.select().from(movePly).where(eq(movePly.gameId, gameId)).orderBy(asc(movePly.ply)),
      deps.db.select().from(mistake).where(eq(mistake.gameId, gameId)).orderBy(asc(mistake.ply)),
    ]);

    return c.json(
      {
        ...toGameSummary(row),
        pgn: row.pgn,
        plies: plies.map(toMovePlyResponse),
        mistakes: mistakes.map(toMistakeResponse),
      },
      200,
    );
  });
}
