/**
 * ST-024. Aggregate a player's mistakes by tactical motif, for one stream.
 *
 * The split mirrors `opening-leaks.ts` and `round-decay.ts`: {@link motifCounts}
 * is the Drizzle query that produces per-motif counts, {@link scoreMotifs} is
 * the pure thresholding and ranking over those counts, testable with no
 * database, and {@link mountMotifs} is the authenticated handler.
 *
 * The cost metric is total centipawns lost per motif, the same currency
 * `round-decay.ts` uses, so a motif's rank means "this is where the player's
 * points went" rather than "this is what happened most often".
 *
 * The query scopes to one player and one stream, filters to `complete` games
 * in SQL, and groups on `mistake.motif`. Only `attributeMotif` writes that
 * column, and it writes the four values in {@link MOTIFS} or null, so a non-null
 * group is one of those four.
 */
import type { Context } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getMotifs } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, mistake } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import type { Motif } from '../analysis/motif.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

/** A motif is not reported until at least this many mistakes support it. */
export const MIN_POSITIONS = 3;

/** One motif's raw counts, as the query returns them before scoring. */
export interface MotifCount {
  motif: Motif;
  positions: number;
  totalLoss: number;
}

/** One motif in the ranked result. */
export interface MotifPoint {
  motif: Motif;
  positions: number;
  totalCpLoss: number;
}

export type MotifResult =
  | {
      kind: 'ok';
      motifs: MotifPoint[];
      unattributed: number;
      mistakeCount: number;
      withheld: number;
    }
  | { kind: 'not_enough_evidence' };

/**
 * Score, threshold, and rank per-motif counts. Pure: no database, no clock.
 *
 * `completeGames` is zero only when the player has no analysed games in the
 * stream, which is the one case that refuses rather than answers. A player with
 * analysed games and no mistakes scores an `ok` result with an empty list and a
 * zero `mistakeCount`, which reads as a clean bill rather than a thin history.
 */
export function scoreMotifs(input: {
  completeGames: number;
  counts: MotifCount[];
  unattributed: number;
}): MotifResult {
  if (input.completeGames === 0) return { kind: 'not_enough_evidence' };

  const mistakeCount = input.counts.reduce((n, c) => n + c.positions, 0) + input.unattributed;

  const motifs: MotifPoint[] = [];
  let withheld = 0;
  for (const c of input.counts) {
    if (c.positions < MIN_POSITIONS) {
      withheld++;
      continue;
    }
    motifs.push({ motif: c.motif, positions: c.positions, totalCpLoss: c.totalLoss });
  }

  // Worst first. Motif name breaks ties so the same counts rank the same every time.
  motifs.sort((a, b) => b.totalCpLoss - a.totalCpLoss || a.motif.localeCompare(b.motif));
  return { kind: 'ok', motifs, unattributed: input.unattributed, mistakeCount, withheld };
}

/** What {@link motifCounts} returns, one pass over the mistake rows. */
export interface MotifQueryResult {
  completeGames: number;
  counts: MotifCount[];
  unattributed: number;
}

/**
 * Per-motif counts for one player and one stream, over analysed games only.
 *
 * Two queries: the complete-game count decides the empty case, and the mistake
 * join produces the per-motif groups. The null-motif group is the unattributed
 * bucket, kept separate from the named motifs rather than dropped.
 */
export async function motifCounts(
  db: Db,
  playerId: string,
  stream: Stream,
): Promise<MotifQueryResult> {
  const where = and(
    eq(game.playerId, playerId),
    eq(game.stream, stream),
    eq(game.analysisStatus, 'complete'),
  );

  const [gameRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(game)
    .where(where);
  const completeGames = gameRow?.n ?? 0;

  const rows = await db
    .select({
      motif: mistake.motif,
      positions: sql<number>`count(${mistake.id})::int`,
      totalLoss: sql<number>`coalesce(sum(${mistake.cpLoss}), 0)::int`,
    })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .where(where)
    .groupBy(mistake.motif);

  const counts: MotifCount[] = [];
  let unattributed = 0;
  for (const row of rows) {
    if (row.motif === null) {
      unattributed = row.positions;
    } else {
      counts.push({
        motif: row.motif as Motif,
        positions: row.positions,
        totalLoss: row.totalLoss,
      });
    }
  }
  return { completeGames, counts, unattributed };
}

export function mountMotifs(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getMotifs, async (c) => {
    const { playerId } = c.req.valid('param');
    const { stream } = c.req.valid('query');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    // Absence and refusal both answer 403, the same rule as every other
    // player-scoped route, so a player id cannot be enumerated.
    if (!(await hasPlayerClaim(deps.db, session.userId, playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your player.' }, 403);
    }

    const result = scoreMotifs(await motifCounts(deps.db, playerId, stream));
    if (result.kind === 'not_enough_evidence') {
      return c.json(
        { code: 'not_enough_evidence', message: 'No analysed games in this stream.' },
        422,
      );
    }

    return c.json(
      {
        playerId,
        stream,
        motifs: result.motifs,
        unattributed: result.unattributed,
        mistakeCount: result.mistakeCount,
        withheld: result.withheld,
      },
      200,
    );
  });
}
