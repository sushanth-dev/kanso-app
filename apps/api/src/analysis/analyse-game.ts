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
import { evaluationSources } from './evaluation-sources.ts';
import {
  ANALYSIS_ENGINE_VERSION,
  DEEP_PASS_EXTRA_DEPTH,
  SWING_WIN_PROB_EPSILON,
} from './budget.ts';
import { walkGame, type WalkedPly } from './walk-pgn.ts';
import { applyRetirement } from './retirement.ts';

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
 * Evaluate every position, searching the ones that need it, in two passes.
 *
 * A position with one legal move cannot itself be a mistake: the player had
 * nothing else to play. The mistake is the move that forced it, and that move
 * is measured at the position the forced move leads to. So a forced position
 * takes the evaluation of the position after it, which is the value that flows
 * into the ply before it and makes a blunder that forces a reply visible
 * instead of invisible. Inheriting a value that was searched at full depth
 * costs one fewer search than evaluating the forced position as well, and does
 * not write a borrowed number under the forced position's cache key. The last
 * position in the walk has no successor, so it is always searched, and
 * `evaluation-sources.ts` holds the rule. ADR-0023 covers these positions and
 * deliberately does not cover opening-book moves, because players make
 * mistakes in the opening too.
 *
 * The first pass searches every position that is its own source at the
 * contract depth, through the cache. The second pass re-searches, a few plies
 * deeper, both flanks of every ply whose first-pass evaluation swung, resolved
 * to the positions that hold those values. A quiet ply keeps its first-pass
 * evaluation; a swinging ply gets the deeper one. Both passes share the cache,
 * keyed by depth.
 */
async function evaluateWalk(
  db: Db,
  positions: string[],
  plies: WalkedPly[],
  options: EngineOptions,
): Promise<{ scores: EvalScore[]; bestMoveUci: (string | null)[]; nodes: number }> {
  const legalMoves = positions.map((fen) => new Chess(fen).moves({ verbose: true }));
  const sources = evaluationSources(legalMoves.map((moves) => moves.length));
  const searchedIndices = positions
    .map((_, index) => index)
    .filter((index) => sources[index] === index);
  const searched = searchedIndices.map((index) => positions[index]!);

  // Pass 1: every position that holds its own value, at the contract depth,
  // through the cache.
  const pass1 = await evaluatePositionsCached(db, searched, options);
  const shallowByIndex = new Map<number, EvaluatedPosition>();
  searchedIndices.forEach((index, j) => shallowByIndex.set(index, pass1.results[j]!));

  const shallowScores: EvalScore[] = [];
  positions.forEach((_, index) => {
    shallowScores.push(shallowByIndex.get(sources[index]!)!.score);
  });

  // Pass 2: re-search both flanks of every swinging ply, a few plies deeper,
  // resolved to the positions that actually hold those evaluations. A forced
  // position never holds its own, so a swing beside one re-searches its source.
  const research = [
    ...new Set(
      positionsToResearch(plies, shallowScores, SWING_WIN_PROB_EPSILON).map(
        (index) => sources[index]!,
      ),
    ),
  ].sort((a, b) => a - b);
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
  positions.forEach((_, index) => {
    const source = sources[index]!;
    const evaluated = deepByIndex.get(source) ?? shallowByIndex.get(source)!;
    scores.push(evaluated.score);
    // A position that holds its own value keeps the engine's best move. A
    // forced position has one legal move, and that is the best move there was.
    bestMoveUci.push(source === index ? evaluated.bestMoveUci : legalMoves[index]![0]!.lan);
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
    const outcome = await analyse(db, gameId, options);
    if (outcome.status === 'complete') await applyRetirement(db, gameId);
    return outcome;
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
