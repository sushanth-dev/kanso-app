/**
 * ST-158. One opponent reply for the finish-your-own-game session.
 *
 * While the player stays on the game's actual rails, the opponent's reply is
 * the stored continuation and this endpoint is never called. It exists for the
 * moment the player leaves the tree: their move was better (or at least
 * different), and the stored continuation no longer applies. The server
 * replays the stored plies up to `railPly` and applies `playerMoves` itself,
 * so the position searched is provably one the player's own game reached -
 * the endpoint is not a free engine oracle for arbitrary positions.
 *
 * The search rides the shared evaluation cache and is depth-capped below the
 * analysis contract (ADR-0023), because the answer only needs to be a sensible
 * opponent, not a verdict. Practice effort only, under the ST-129 rule: no
 * write touches `mistake`, `weakness`, the pattern state, or the streak. The
 * one write is the evaluation cache, which is a cache of board positions, not
 * a record about a player.
 */
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { asc, eq, sql } from 'drizzle-orm';
import { Chess } from 'chess.js';
import { postEngineReply } from '../contract/routes.ts';
import type * as schema from '../db/schema.ts';
import { game, movePly, rateLimitBucket } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { evaluatePositions, type EngineOptions } from '../analysis/engine.ts';
import { lookupEvaluations, storeEvaluations } from '../analysis/evaluation-cache.ts';
import {
  ANALYSIS_ENGINE_VERSION,
  ANALYSIS_NODE_CEILING,
  FINISH_DEPTH,
} from '../analysis/budget.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** The engine the API function runs: the WASM build the package ships. */
const defaultEngineOptions: EngineOptions = {
  enginePath: process.env.ENGINE_PATH ?? 'stockfish/bin/stockfish-18-single.js',
  depth: FINISH_DEPTH,
  nodeCeiling: ANALYSIS_NODE_CEILING,
  engines: 1,
  hashMb: 32,
};

/**
 * Searches one position and returns its evaluation, through the shared cache.
 * The seam exists for tests: production passes nothing and the default runs
 * the real engine, the same way the fetcher and AI client seams work.
 */
export type EngineSearch = (
  db: Db,
  fen: string,
) => Promise<{ score: { cp: number | null; mate: number | null }; bestMoveUci: string | null }>;

async function defaultSearch(db: Db, fen: string): ReturnType<EngineSearch> {
  const cached = await lookupEvaluations(db, [fen], ANALYSIS_ENGINE_VERSION, FINISH_DEPTH);
  const hit = cached.get(fen);
  if (hit !== undefined) {
    return {
      score: { cp: hit.score.cp ?? null, mate: hit.score.mate ?? null },
      bestMoveUci: hit.bestMoveUci,
    };
  }
  const [searched] = await evaluatePositions([fen], defaultEngineOptions);
  if (searched === undefined) {
    throw new Error('engine returned no evaluation');
  }
  await storeEvaluations(db, [searched], ANALYSIS_ENGINE_VERSION, FINISH_DEPTH);
  return {
    score: { cp: searched.score.cp ?? null, mate: searched.score.mate ?? null },
    bestMoveUci: searched.bestMoveUci,
  };
}

/** How long the endpoint's fixed window runs, and how many replies it allows. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

/**
 * The fixed-window limiter for the engine-reply endpoint, keyed on the user
 * id, in the database because the API runs more than one instance. Same shape
 * the priming brief uses (ST-153).
 */
async function consumeRateLimit(db: Db, key: string): Promise<boolean> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS);
  // The case expression binds the window as an ISO string: a Date object in a
  // raw sql fragment serializes with toString(), which Postgres cannot parse.
  const windowIso = windowStart.toISOString();
  const [row] = await db
    .insert(rateLimitBucket)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimitBucket.key,
      set: {
        count: sql`case when ${rateLimitBucket.windowStart} = ${windowIso}::timestamptz then ${rateLimitBucket.count} + 1 else 1 end`,
        windowStart,
      },
    })
    .returning();
  return row !== undefined && row.count <= RATE_LIMIT_MAX;
}

/**
 * The position after the stored plies whose number is at most `railPly` and
 * the player's own moves, or null when a move is not legal where it is
 * played. The player's move list is bounded by the contract schema (max 8),
 * so the loop is bounded before it starts.
 */
function positionAfter(
  rails: readonly { ply: number; san: string }[],
  railPly: number,
  playerMoves: readonly string[],
): Chess | null {
  try {
    const chess = new Chess();
    for (const ply of rails) {
      if (ply.ply > railPly) break;
      chess.move(ply.san);
    }
    for (const san of playerMoves) {
      chess.move(san);
    }
    return chess;
  } catch {
    return null;
  }
}

export function mountEngineReply(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; search?: EngineSearch },
): void {
  app.openapi(postEngineReply, async (c) => {
    const { gameId } = c.req.valid('param');
    const { railPly, playerMoves } = c.req.valid('json');

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

    if (!(await consumeRateLimit(deps.db, `engine-reply:${session.userId}`))) {
      return c.json(
        { code: 'rate_limited', message: 'Too many engine replies in this window.' },
        429,
      );
    }

    const plies = await deps.db
      .select({ ply: movePly.ply, san: movePly.san })
      .from(movePly)
      .where(eq(movePly.gameId, gameId))
      .orderBy(asc(movePly.ply));

    // railPly is the ply number of the last stored ply the player followed
    // (0 is the start position); a ply number beyond the game's last is not a
    // position the game ever reached.
    const lastPly = plies.length > 0 ? plies[plies.length - 1]!.ply : 0;
    if (railPly > lastPly) {
      return c.json(
        { code: 'bad_rail', message: 'The rail ply is not a position this game reached.' },
        422,
      );
    }

    const position = positionAfter(plies, railPly, playerMoves);
    if (position === null) {
      return c.json(
        { code: 'bad_move', message: 'A move is not legal in the position it was played in.' },
        422,
      );
    }

    if (position.isGameOver()) {
      return c.json({ status: 'game_over' as const, move: null, evaluation: null }, 200);
    }

    const fen = position.fen();
    const evaluated = await (deps.search ?? defaultSearch)(deps.db, fen);

    if (evaluated.bestMoveUci === null) {
      // No best move in a not-over position has not happened; refuse loudly
      // rather than invent a move.
      return c.json({ code: 'engine_error', message: 'The engine returned no move.' }, 500);
    }

    const reply = position.move({
      from: evaluated.bestMoveUci.slice(0, 2),
      to: evaluated.bestMoveUci.slice(2, 4),
      ...(evaluated.bestMoveUci.length > 4 ? { promotion: evaluated.bestMoveUci.slice(4) } : {}),
    });

    return c.json(
      {
        status: 'reply' as const,
        move: { san: reply.san, uci: evaluated.bestMoveUci },
        evaluation: { cp: evaluated.score.cp ?? null, mate: evaluated.score.mate ?? null },
      },
      200,
    );
  });
}
