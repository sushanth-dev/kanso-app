/**
 * ST-047. The FEN-keyed evaluation cache, one row per searched position.
 *
 * A fixed-depth search is deterministic (ADR-0023), so a cached row is the
 * same evaluation a fresh search would produce. Only full-depth results are
 * stored: a search the node ceiling stopped early is not cached, which is what
 * keeps the ceiling out of the key and the entry trustworthy.
 *
 * The batch shapes exist because a game is tens of positions, and one query
 * over tens of rows beats tens of queries.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EvalScore } from '../chess/lichess-utils.ts';
import * as schema from '../db/schema.ts';
import { evaluationCache } from '../db/schema.ts';
import type { EvaluatedPosition } from './engine.ts';

type Db = PostgresJsDatabase<typeof schema>;

export interface CachedEvaluation {
  score: EvalScore;
  bestMoveUci: string | null;
}

/**
 * The cached evaluations for the given positions, keyed by FEN. Positions not
 * yet cached are simply absent from the map.
 */
export async function lookupEvaluations(
  db: Db,
  fens: string[],
  engineVersion: string,
  depth: number,
): Promise<Map<string, CachedEvaluation>> {
  if (fens.length === 0) return new Map();
  const rows = await db
    .select({
      fen: evaluationCache.fen,
      evalCp: evaluationCache.evalCp,
      evalMate: evaluationCache.evalMate,
      bestMoveUci: evaluationCache.bestMoveUci,
    })
    .from(evaluationCache)
    .where(
      and(
        inArray(evaluationCache.fen, fens),
        eq(evaluationCache.engineVersion, engineVersion),
        eq(evaluationCache.depth, depth),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.fen,
      {
        score: {
          ...(row.evalCp === null ? {} : { cp: row.evalCp }),
          ...(row.evalMate === null ? {} : { mate: row.evalMate }),
        },
        bestMoveUci: row.bestMoveUci,
      },
    ]),
  );
}

/**
 * Store the positions that reached the requested depth. A row that already
 * exists is left alone: same key means the same evaluation, and first writer
 * wins keeps a burst of workers from fighting over identical rows.
 */
export async function storeEvaluations(
  db: Db,
  evaluated: EvaluatedPosition[],
  engineVersion: string,
  depth: number,
): Promise<void> {
  const full = evaluated.filter((e) => e.depth >= depth);
  if (full.length === 0) return;
  await db
    .insert(evaluationCache)
    .values(
      full.map((e) => ({
        fen: e.fen,
        engineVersion,
        depth,
        evalCp: e.score.cp ?? null,
        evalMate: e.score.mate ?? null,
        bestMoveUci: e.bestMoveUci,
        nodes: e.nodes,
      })),
    )
    .onConflictDoNothing();
}
