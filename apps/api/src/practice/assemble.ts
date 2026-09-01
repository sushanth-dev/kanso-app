/**
 * ST-106. Assemble one weakness group's drill: 20 pool puzzles, theme-matched
 * and rating-banded, chosen by the prototype's fallback ladder.
 *
 * The prototype fetched drills from its `available_puzzles` table by exact
 * theme within 400 rating points of the player, then widened to 800, then to
 * any theme, because a thin theme at a narrow band must not starve the drill.
 * That ladder carries over verbatim, with one addition: puzzles the player
 * already has an attempt row for are excluded while the pool allows it, so a
 * session deals fresh material and the attempt table accumulates real
 * progress. The import's per-theme caps make the last rung theoretical; an
 * empty pool answers honestly rather than with a short set, because "at
 * least 20" is the feature.
 *
 * The player's rating is the prototype's estimated-ELO stand-in, resolved
 * from the best rating the account actually holds: FIDE, then USCF, then the
 * two site ratings, then 1500.
 */
import { and, eq, gte, lte, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WeaknessKind } from '../analysis/leak.ts';
import * as schema from '../db/schema.ts';
import { player, puzzle, puzzleAttempt } from '../db/schema.ts';
import { themeForGroup } from './themes.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** The size of one drill, the ask's "at least 20". */
export const DRILL_SIZE = 20;

/** The rating of a player with no measured rating anywhere, the prototype's default. */
const DEFAULT_RATING = 1500;

/** One drill puzzle as the client receives it: the raw Lichess row it needs. */
export interface DrillPuzzle {
  id: string;
  fen: string;
  /** Space-separated UCI: the first move is the opponent's setup, the rest the solution. */
  moves: string;
  rating: number;
}

/** One assembled drill, with the theme the ladder matched and the rating band used. */
export interface DrillSet {
  kind: WeaknessKind;
  group: string;
  theme: string;
  rating: number;
  puzzles: DrillPuzzle[];
}

async function gather(
  db: Db,
  playerId: string,
  theme: string | null,
  low: number,
  high: number,
  into: Map<string, DrillPuzzle>,
): Promise<void> {
  if (into.size >= DRILL_SIZE) return;
  // Already-picked ids are excluded inside the query, not after it: the rung
  // limit counts fresh rows only, so a thin rung can never hand back rows
  // the dedupe would just drop.
  const exclusions = [
    notInArray(
      puzzle.lichessId,
      db
        .select({ id: puzzleAttempt.puzzleId })
        .from(puzzleAttempt)
        .where(eq(puzzleAttempt.playerId, playerId)),
    ),
  ];
  if (into.size > 0) exclusions.push(notInArray(puzzle.lichessId, [...into.keys()]));
  const rows = await db
    .select({
      lichessId: puzzle.lichessId,
      fen: puzzle.fen,
      moves: puzzle.moves,
      rating: puzzle.rating,
    })
    .from(puzzle)
    .where(
      and(
        gte(puzzle.rating, low),
        lte(puzzle.rating, high),
        theme === null ? undefined : sql`${puzzle.themes} @> ARRAY[${theme}]::text[]`,
        ...exclusions,
      ),
    )
    .orderBy(sql`random()`)
    .limit(DRILL_SIZE - into.size);
  for (const row of rows) {
    into.set(row.lichessId, {
      id: row.lichessId,
      fen: row.fen,
      moves: row.moves,
      rating: row.rating,
    });
  }
}

export async function assembleDrill(
  db: Db,
  playerId: string,
  kind: WeaknessKind,
  group: string,
): Promise<DrillSet | 'no_such_group' | 'pool_empty'> {
  const theme = themeForGroup(kind, group);
  if (theme === null) return 'no_such_group';

  const [row] = await db
    .select({
      fideRating: player.fideRating,
      uscfRating: player.uscfRating,
      chesscomRating: player.chesscomRating,
      lichessRating: player.lichessRating,
    })
    .from(player)
    .where(eq(player.id, playerId))
    .limit(1);
  const rating =
    row === undefined
      ? DEFAULT_RATING
      : (row.fideRating ??
        row.uscfRating ??
        row.chesscomRating ??
        row.lichessRating ??
        DEFAULT_RATING);

  // The prototype's ladder: exact theme near the player's rating, then the
  // same theme wider, then the crushing fallback wider, then any theme wider.
  const picked = new Map<string, DrillPuzzle>();
  await gather(db, playerId, theme, rating - 400, rating + 400, picked);
  await gather(db, playerId, theme, rating - 800, rating + 800, picked);
  if (theme !== 'crushing') {
    await gather(db, playerId, 'crushing', rating - 800, rating + 800, picked);
  }
  await gather(db, playerId, null, rating - 800, rating + 800, picked);

  if (picked.size < DRILL_SIZE) return 'pool_empty';
  return { kind, group, theme, rating, puzzles: [...picked.values()] };
}
