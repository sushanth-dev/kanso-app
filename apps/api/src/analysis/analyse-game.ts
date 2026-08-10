/**
 * One game, analysed and written once.
 *
 * The walk is: replay the PGN, decide which positions are worth searching, send
 * them to the engine, stitch each ply's before and after evaluation, and write
 * every row in a single transaction that first deletes what was there. Analysing
 * a game twice replaces its rows rather than adding to them, and a reader never
 * sees a half-replaced game.
 *
 * Two rules here come from reading the rest of the code rather than from the
 * story:
 *
 * 1. Only the player's own plies become `mistake` rows. The opening-leak
 *    aggregation counts every `mistake` row on a game with no filter on colour,
 *    so a row for the opponent's blunder would make the player's opening look
 *    bad for a move the player never made.
 * 2. A failed analysis is a state, not an absence. `openingLeaks` reads games
 *    with `analysisStatus = 'complete'` only, so a game that ends `failed` is
 *    excluded from the diagnosis by data rather than by anyone remembering to.
 */
import { Chess } from 'chess.js';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Color, EvalScore } from '../chess/lichess-utils.ts';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly } from '../db/schema.ts';
import { evaluatePositions, type EngineOptions, type EvaluatedPosition } from './engine.ts';
import { toMistakeRow, type MistakeInsert } from './to-mistake.ts';

type Db = PostgresJsDatabase<typeof schema>;
type MovePlyInsert = typeof movePly.$inferInsert;

export interface AnalysisOutcome {
  status: 'complete' | 'failed';
  plies: number;
  mistakes: number;
  nodes: number;
  durationMs: number;
}

/** `analysis_error` is read by people. Long enough to diagnose, short enough to read. */
const MAX_ERROR_LENGTH = 500;

interface Ply {
  ply: number;
  moveNumber: number;
  movingColor: Color;
  san: string;
  uci: string;
  fenBefore: string;
}

/** The position each ply was played from, plus the position the game ended in. */
interface Walk {
  plies: Ply[];
  positions: string[];
}

function walkGame(pgn: string): Walk {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  if (history.length === 0) throw new Error('game has no moves to analyse');

  const plies = history.map((move, index) => {
    // Move number and side to move are read off the FEN rather than counted
    // from one, so a game that starts from a position mid-game still numbers
    // its moves the way a player would say them.
    const fields = move.before.split(' ');
    return {
      ply: index + 1,
      moveNumber: Number(fields[5]),
      movingColor: fields[1] === 'b' ? ('black' as const) : ('white' as const),
      san: move.san,
      uci: move.lan,
      fenBefore: move.before,
    };
  });

  const final = history[history.length - 1].after;
  return { plies, positions: [...plies.map((p) => p.fenBefore), final] };
}

/** SAN for a UCI move, or null where there was no move to make. */
function sanFor(fen: string, uci: string | null): string | null {
  if (uci === null) return null;
  const chess = new Chess(fen);
  const move = chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    ...(uci.length > 4 ? { promotion: uci.slice(4) } : {}),
  });
  return move.san;
}

/**
 * Evaluate every position, skipping the ones where there was only one legal
 * move.
 *
 * A forced move cannot be a mistake: the player had nothing else to play. Its
 * evaluation is the evaluation of the position before it, carried over exactly
 * rather than approximated, so the ply still gets a row with a real number in
 * it. ADR-0023 skips these and deliberately does not skip opening-book moves,
 * because players make mistakes in the opening too.
 */
async function evaluateWalk(
  positions: string[],
  options: EngineOptions,
): Promise<{ scores: EvalScore[]; bestMoveUci: (string | null)[]; nodes: number }> {
  // Never skip the first position: with nothing before it there is nothing to
  // carry over from, and a game can begin from an arbitrary FEN.
  const forced = positions.map((fen, index) => index > 0 && new Chess(fen).moves().length === 1);
  const searched = positions.filter((_, index) => !forced[index]);
  const results = await evaluatePositions(searched, options);

  const byIndex = new Map<number, EvaluatedPosition>();
  let next = 0;
  positions.forEach((_, index) => {
    if (!forced[index]) byIndex.set(index, results[next++]);
  });

  const scores: EvalScore[] = [];
  const bestMoveUci: (string | null)[] = [];
  positions.forEach((fen, index) => {
    const evaluated = byIndex.get(index);
    if (evaluated === undefined) {
      // Forced: the evaluation is the previous position's, and the best move is
      // the only move.
      scores.push(scores[index - 1]);
      bestMoveUci.push(new Chess(fen).moves({ verbose: true })[0].lan);
      return;
    }
    scores.push(evaluated.score);
    bestMoveUci.push(evaluated.bestMoveUci);
  });

  return {
    scores,
    bestMoveUci,
    nodes: results.reduce((total, result) => total + result.nodes, 0),
  };
}

async function analyse(db: Db, gameId: string, options: EngineOptions): Promise<AnalysisOutcome> {
  const [row] = await db
    .select({ pgn: game.pgn, playerColor: game.playerColor })
    .from(game)
    .where(eq(game.id, gameId));
  if (row === undefined) throw new Error(`no game ${gameId}`);
  // A game with no known colour has no player to diagnose. The queue does not
  // enqueue one; analysing it anyway would write rows nobody can attribute, so
  // this says why instead of quietly analysing nothing.
  if (row.playerColor === null) {
    throw new Error(`game ${gameId} has no player colour, so there is nobody to analyse`);
  }

  const startedAt = performance.now();
  await db.update(game).set({ analysisStatus: 'analyzing' }).where(eq(game.id, gameId));

  const { plies, positions } = walkGame(row.pgn);
  const { scores, bestMoveUci, nodes } = await evaluateWalk(positions, options);

  const plyRows: MovePlyInsert[] = [];
  const mistakeRows: MistakeInsert[] = [];
  for (const ply of plies) {
    const index = ply.ply - 1;
    const bestUci = bestMoveUci[index];
    const bestSan = sanFor(ply.fenBefore, bestUci);

    plyRows.push({
      gameId,
      ply: ply.ply,
      san: ply.san,
      uci: ply.uci,
      fenBefore: ply.fenBefore,
      evalCp: scores[index].cp ?? null,
      evalMate: scores[index].mate ?? null,
      bestMoveSan: bestSan,
      bestMoveUci: bestUci,
    });

    if (ply.movingColor !== row.playerColor) continue;
    const mistakeRow = toMistakeRow(gameId, {
      ply: ply.ply,
      moveNumber: ply.moveNumber,
      san: ply.san,
      fenBefore: ply.fenBefore,
      movingColor: ply.movingColor,
      evalBefore: scores[index],
      // The last ply's "after" is the position the game ended in, which is why
      // the walk collects one more position than there are plies.
      evalAfter: scores[index + 1],
      bestMoveSan: bestSan,
    });
    if (mistakeRow !== null) mistakeRows.push(mistakeRow);
  }

  const durationMs = Math.round(performance.now() - startedAt);

  await db.transaction(async (tx) => {
    // Delete then insert, inside the transaction: this is the idempotency
    // guard. `move_ply_unique` and `mistake_unique` stay as the backstop that
    // turns a bug here into a failed insert rather than a doubled leak score.
    await tx.delete(mistake).where(eq(mistake.gameId, gameId));
    await tx.delete(movePly).where(eq(movePly.gameId, gameId));
    await tx.insert(movePly).values(plyRows);
    if (mistakeRows.length > 0) await tx.insert(mistake).values(mistakeRows);
    await tx
      .update(game)
      .set({
        analysisStatus: 'complete',
        analyzedAt: new Date(),
        analysisError: null,
        analysisNodes: nodes,
        analysisDurationMs: durationMs,
      })
      .where(eq(game.id, gameId));
  });

  return {
    status: 'complete',
    plies: plyRows.length,
    mistakes: mistakeRows.length,
    nodes,
    durationMs,
  };
}

/**
 * Analyse one game and write its plies and mistakes, or mark it failed.
 *
 * Throws after recording the failure, so the caller still decides about
 * retries: the queue bounds them and sends the job to the dead-letter queue
 * rather than retrying forever.
 */
export async function analyseGame(
  db: Db,
  gameId: string,
  options: EngineOptions,
): Promise<AnalysisOutcome> {
  try {
    return await analyse(db, gameId, options);
  } catch (error) {
    // The message only, never a stack: this column is shown to people, and a
    // stack in it is our internals leaking into their screen.
    const message = error instanceof Error ? error.message : 'analysis failed';
    await db
      .update(game)
      .set({ analysisStatus: 'failed', analysisError: message.slice(0, MAX_ERROR_LENGTH) })
      .where(eq(game.id, gameId));
    throw error;
  }
}
