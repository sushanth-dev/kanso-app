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
import type { EvalScore } from '../chess/lichess-utils.ts';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly } from '../db/schema.ts';
import { evaluatePositions, type EngineOptions, type EvaluatedPosition } from './engine.ts';
import { toMistakeRow, type MistakeInsert } from './to-mistake.ts';
import { phaseFor } from './phase.ts';
import { costMicrosFor, DEFAULT_MEMORY_MB } from './cost.ts';
import { lookupEvaluations, storeEvaluations } from './evaluation-cache.ts';
import { positionsToResearch } from './two-pass.ts';
import {
  ANALYSIS_ENGINE_VERSION,
  DEEP_PASS_EXTRA_DEPTH,
  SWING_WIN_PROB_EPSILON,
} from './budget.ts';
import { walkGame, type WalkedPly } from './walk-pgn.ts';

type Db = PostgresJsDatabase<typeof schema>;
type MovePlyInsert = typeof movePly.$inferInsert;

export interface AnalysisOutcome {
  status: 'complete' | 'failed';
  plies: number;
  mistakes: number;
  nodes: number;
  durationMs: number;
  costMicros: number;
}

/** `analysis_error` is read by people. Long enough to diagnose, short enough to read. */
const MAX_ERROR_LENGTH = 500;

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
 * Evaluate a set of positions through the cache: look up what is already
 * known, search the misses, and store what a search reached in full.
 */
async function evaluatePositionsCached(
  db: Db,
  fens: string[],
  options: EngineOptions,
): Promise<{ results: EvaluatedPosition[]; nodes: number }> {
  const hits = await lookupEvaluations(db, fens, ANALYSIS_ENGINE_VERSION, options.depth);
  const misses = fens.filter((fen) => !hits.has(fen));
  const searched = misses.length > 0 ? await evaluatePositions(misses, options) : [];

  await storeEvaluations(db, searched, ANALYSIS_ENGINE_VERSION, options.depth);

  const byFen = new Map<string, EvaluatedPosition>();
  let nodes = 0;
  for (const evaluated of searched) {
    byFen.set(evaluated.fen, evaluated);
    nodes += evaluated.nodes;
  }

  const results = fens.map((fen) => {
    const cached = hits.get(fen);
    if (cached !== undefined) {
      return {
        fen,
        score: cached.score,
        bestMoveUci: cached.bestMoveUci,
        depth: options.depth,
        nodes: 0,
      };
    }
    return byFen.get(fen)!;
  });

  return { results, nodes };
}

/**
 * Evaluate every position, skipping the ones where there was only one legal
 * move, in two passes.
 *
 * A forced move cannot be a mistake: the player had nothing else to play. Its
 * evaluation is the evaluation of the position before it, carried over exactly
 * rather than approximated, so the ply still gets a row with a real number in
 * it. ADR-0023 skips these and deliberately does not skip opening-book moves,
 * because players make mistakes in the opening too.
 *
 * The first pass searches every non-forced position at the contract depth,
 * through the cache. The second pass re-searches, a few plies deeper, both
 * flanks of every ply whose first-pass evaluation swung. A quiet ply keeps its
 * first-pass evaluation; a swinging ply gets the deeper one. Both passes share
 * the cache, keyed by depth.
 */
async function evaluateWalk(
  db: Db,
  positions: string[],
  plies: WalkedPly[],
  options: EngineOptions,
): Promise<{ scores: EvalScore[]; bestMoveUci: (string | null)[]; nodes: number }> {
  // Never skip the first position: with nothing before it there is nothing to
  // carry over from, and a game can begin from an arbitrary FEN.
  const forced = positions.map((fen, index) => index > 0 && new Chess(fen).moves().length === 1);
  const searchedIndices = positions.map((_, index) => index).filter((index) => !forced[index]);
  const searched = searchedIndices.map((index) => positions[index]!);

  // Pass 1: every non-forced position, at the contract depth, through the cache.
  const pass1 = await evaluatePositionsCached(db, searched, options);
  const shallowByIndex = new Map<number, EvaluatedPosition>();
  searchedIndices.forEach((index, j) => shallowByIndex.set(index, pass1.results[j]!));

  const shallowScores: EvalScore[] = [];
  positions.forEach((_, index) => {
    const evaluated = shallowByIndex.get(index);
    shallowScores.push(evaluated === undefined ? shallowScores[index - 1]! : evaluated.score);
  });

  // Pass 2: re-search both flanks of every swinging ply, a few plies deeper.
  const research = positionsToResearch(plies, shallowScores, SWING_WIN_PROB_EPSILON).filter(
    (index) => !forced[index],
  );
  const deepOptions: EngineOptions = { ...options, depth: options.depth + DEEP_PASS_EXTRA_DEPTH };
  const pass2 =
    research.length > 0
      ? await evaluatePositionsCached(
          db,
          research.map((index) => positions[index]!),
          deepOptions,
        )
      : { results: [], nodes: 0 };
  const deepByIndex = new Map<number, EvaluatedPosition>();
  research.forEach((index, j) => deepByIndex.set(index, pass2.results[j]!));

  const scores: EvalScore[] = [];
  const bestMoveUci: (string | null)[] = [];
  positions.forEach((fen, index) => {
    const deep = deepByIndex.get(index);
    if (deep !== undefined) {
      scores.push(deep.score);
      bestMoveUci.push(deep.bestMoveUci);
      return;
    }
    const shallow = shallowByIndex.get(index);
    if (shallow !== undefined) {
      scores.push(shallow.score);
      bestMoveUci.push(shallow.bestMoveUci);
      return;
    }
    // Forced: the evaluation is the previous position's, and the best move is
    // the only move.
    scores.push(scores[index - 1]!);
    bestMoveUci.push(new Chess(fen).moves({ verbose: true })[0]!.lan);
  });

  return { scores, bestMoveUci, nodes: pass1.nodes + pass2.nodes };
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
  const { scores, bestMoveUci, nodes } = await evaluateWalk(db, positions, plies, options);

  const plyRows: MovePlyInsert[] = [];
  const mistakeRows: MistakeInsert[] = [];
  for (const ply of plies) {
    const index = ply.ply - 1;
    const bestUci = bestMoveUci[index]!;
    const bestSan = sanFor(ply.fenBefore, bestUci);
    const phase = phaseFor(ply.fenBefore, ply.ply);

    plyRows.push({
      gameId,
      ply: ply.ply,
      san: ply.san,
      uci: ply.uci,
      fenBefore: ply.fenBefore,
      phase,
      evalCp: scores[index]!.cp ?? null,
      evalMate: scores[index]!.mate ?? null,
      bestMoveSan: bestSan,
      bestMoveUci: bestUci,
      clockMs: ply.clockMs,
      moveTimeMs: ply.moveTimeMs,
    });

    if (ply.movingColor !== row.playerColor) continue;
    const mistakeRow = toMistakeRow(gameId, {
      ply: ply.ply,
      moveNumber: ply.moveNumber,
      san: ply.san,
      fenBefore: ply.fenBefore,
      movingColor: ply.movingColor,
      evalBefore: scores[index]!,
      // The last ply's "after" is the position the game ended in, which is why
      // the walk collects one more position than there are plies.
      evalAfter: scores[index + 1]!,
      bestMoveSan: bestSan,
      phase,
    });
    if (mistakeRow !== null) mistakeRows.push(mistakeRow);
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const memoryMb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? DEFAULT_MEMORY_MB);
  const costMicros = costMicrosFor(durationMs, memoryMb);

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
        analysisCostMicros: costMicros,
      })
      .where(eq(game.id, gameId));
  });

  return {
    status: 'complete',
    plies: plyRows.length,
    mistakes: mistakeRows.length,
    nodes,
    durationMs,
    costMicros,
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
