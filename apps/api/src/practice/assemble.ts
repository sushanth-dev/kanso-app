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
 * ST-122 adds two rungs ahead of the ladder: an opening group's mapped ECO
 * family prefix inside the rating bands, so the player drills the opening
 * they leak in before any generic theme.
 *
 * ST-124 deals the group's due review puzzles - solved ladder rows whose
 * review time has passed - ahead of any fresh material, so the drills that
 * earned a return meet the player first.
 *
 * The player's rating is the prototype's estimated-ELO stand-in, resolved
 * from the best rating the account actually holds: FIDE, then USCF, then the
 * two site ratings, then 1500.
 */
import { and, asc, eq, gte, lte, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import type { WeaknessKind } from '../analysis/leak.ts';
import { windowGameIds } from '../analysis/retirement.ts';
import * as schema from '../db/schema.ts';
import { patternState, player, puzzle, puzzleAttempt } from '../db/schema.ts';
import { FOCUS_WINDOW_GAMES } from '../focus/verify.ts';
import { RetirementState } from '../contract/schemas.ts';
import { themeForGroup } from './themes.ts';
import { ECO_OPENINGS } from './eco-openings.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];

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

/**
 * One assembled drill, with the theme the ladder matched and the rating band
 * used. `opening` names the ECO family the opening rungs preferred, humanized
 * for the card ("Scandinavian Defense"); null when the deal fell through to
 * the theme rungs.
 */
export interface DrillSet {
  kind: WeaknessKind;
  group: string;
  theme: string;
  rating: number;
  puzzles: DrillPuzzle[];
  opening: string | null;
  /** ST-150. The group's retirement state in the dealt stream; null when the group never became a candidate. */
  retirementState: z.infer<typeof RetirementState> | null;
}

async function gather(
  db: Db,
  playerId: string,
  theme: string | null,
  openingPrefix: string | null,
  low: number,
  high: number,
  into: Map<string, DrillPuzzle>,
): Promise<void> {
  if (into.size >= DRILL_SIZE) return;
  // Exactly one of `theme` and `openingPrefix` is set: the theme rungs match
  // the dump's tag array, the opening rungs prefix-match the family slug.
  const familyMatch =
    openingPrefix === null ? undefined : sql`${puzzle.opening} LIKE ${openingPrefix + '%'}`;
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
        theme === null ? familyMatch : sql`${puzzle.themes} @> ARRAY[${theme}]::text[]`,
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
  stream: Stream,
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

  const picked = new Map<string, DrillPuzzle>();
  // ST-107. The deal a player left unfinished is honored first: the assigned
  // rows with no recorded attempt open the next drill, so a closed tab is a
  // pause, not a loss.
  const pending = await db
    .select({
      lichessId: puzzle.lichessId,
      fen: puzzle.fen,
      moves: puzzle.moves,
      rating: puzzle.rating,
    })
    .from(puzzleAttempt)
    .innerJoin(puzzle, eq(puzzle.lichessId, puzzleAttempt.puzzleId))
    .where(
      and(
        eq(puzzleAttempt.playerId, playerId),
        eq(puzzleAttempt.kind, kind),
        eq(puzzleAttempt.groupKey, group),
        eq(puzzleAttempt.attempts, 0),
      ),
    )
    .orderBy(puzzleAttempt.assignedAt)
    .limit(DRILL_SIZE);
  for (const p of pending) {
    picked.set(p.lichessId, { id: p.lichessId, fen: p.fen, moves: p.moves, rating: p.rating });
  }

  // ST-124. The group's due reviews open the drill before any fresh material:
  // puzzles the player has solved on the ladder whose review time has passed,
  // soonest first, filling whatever the deal still needs. Failed or revealed
  // puzzles (level 0) are not reviews and stay out; the fresh rungs below
  // still exclude every row the player holds, so the ladder is the only way
  // a drilled puzzle returns.
  if (picked.size < DRILL_SIZE) {
    const due = await db
      .select({
        lichessId: puzzle.lichessId,
        fen: puzzle.fen,
        moves: puzzle.moves,
        rating: puzzle.rating,
      })
      .from(puzzleAttempt)
      .innerJoin(puzzle, eq(puzzle.lichessId, puzzleAttempt.puzzleId))
      .where(
        and(
          eq(puzzleAttempt.playerId, playerId),
          eq(puzzleAttempt.kind, kind),
          eq(puzzleAttempt.groupKey, group),
          gte(puzzleAttempt.reviewLevel, 1),
          lte(puzzleAttempt.nextReviewAt, sql`now()`),
        ),
      )
      .orderBy(asc(puzzleAttempt.nextReviewAt))
      .limit(DRILL_SIZE - picked.size);
    for (const p of due) {
      picked.set(p.lichessId, { id: p.lichessId, fen: p.fen, moves: p.moves, rating: p.rating });
    }
  }

  // ST-122. An opening group drills the opening first: the ECO's mapped
  // family prefix inside the rating bands, then the prototype's theme ladder
  // verbatim. The family comes from the generated ECO_OPENINGS map; an ECO
  // it does not cover, or whose family the pool does not carry, falls
  // through to the theme rungs.
  const family = kind === 'opening' ? (ECO_OPENINGS[group.toUpperCase()] ?? null) : null;
  let openingMatched: string | null = null;
  if (family !== null) {
    const before = picked.size;
    await gather(db, playerId, null, family, rating - 400, rating + 400, picked);
    await gather(db, playerId, null, family, rating - 800, rating + 800, picked);
    if (picked.size > before) openingMatched = family.replaceAll('_', ' ');
  }

  // The prototype's ladder: exact theme near the player's rating, then the
  // same theme wider, then the crushing fallback wider, then any theme wider.
  // Every rung excludes everything the player holds a row for, dealt or
  // drilled, so fresh material is never a repeat; only the ladder's due
  // reviews above bring a drilled puzzle back.
  await gather(db, playerId, theme, null, rating - 400, rating + 400, picked);
  await gather(db, playerId, theme, null, rating - 800, rating + 800, picked);
  if (theme !== 'crushing') {
    await gather(db, playerId, 'crushing', null, rating - 800, rating + 800, picked);
  }
  await gather(db, playerId, null, null, rating - 800, rating + 800, picked);

  if (picked.size < DRILL_SIZE) return 'pool_empty';

  // ST-150. The group's retirement state in the dealt stream, read the same
  // way the report reads it: a candidate whose verification window has not
  // closed reads as not_yet_verifiable, everything else as its stored state.
  // Null when the group never became a candidate. The group key is known
  // directly here, so no groupKeyOf derivation is needed.
  let retirementState: z.infer<typeof RetirementState> | null = null;
  const [pattern] = await db
    .select({
      state: patternState.state,
      masteredAt: patternState.masteredAt,
    })
    .from(patternState)
    .where(
      and(
        eq(patternState.playerId, playerId),
        eq(patternState.kind, kind),
        eq(patternState.groupKey, group),
        eq(patternState.stream, stream),
      ),
    )
    .limit(1);
  if (pattern !== undefined) {
    retirementState =
      pattern.state === 'candidate' &&
      (await windowGameIds(db, playerId, stream, pattern.masteredAt)).length < FOCUS_WINDOW_GAMES
        ? 'not_yet_verifiable'
        : pattern.state;
  }

  // ST-107. Persist the deal the moment it is dealt, not only when drills are
  // recorded: an abandoned session keeps its assignment, so the same puzzles
  // never come back. ponytail: assigned-never-drilled rows shrink the usable
  // pool one puzzle each; with the import's per-theme caps that is a slow
  // ceiling, and the review queue is the upgrade path if it ever shows.
  await db
    .insert(puzzleAttempt)
    .values(
      [...picked.values()].map((p) => ({
        playerId,
        puzzleId: p.id,
        kind,
        groupKey: group,
        attempts: 0,
        solved: false,
        reviewLevel: 0,
        nextReviewAt: new Date(),
        assignedAt: new Date(),
      })),
    )
    .onConflictDoNothing({
      target: [puzzleAttempt.playerId, puzzleAttempt.puzzleId],
    });

  return {
    kind,
    group,
    theme,
    rating,
    puzzles: [...picked.values()],
    opening: openingMatched,
    retirementState,
  };
}
