/**
 * ST-107. The review queue the puzzles page shows, in the three buckets the
 * prototype's training page used: what is pending now (due reviews, plus the
 * deal that has not been started - both sit at `next_review_at <= now`),
 * what is coming up for review, and what sits in the ladder's top rung.
 * One indexed read per bucket, soonest first.
 *
 * ST-124. The practice surface's due-for-review section comes from
 * `readDueReviews`: the player's due ladder rows - a puzzle that has been
 * solved and whose review time has passed - limited to what is left of ten
 * review solves per calendar day. The count reads `review_solved_at` stamps
 * in UTC, the same calendar the streak's once-per-day path uses. The cap is
 * the guard against the ladder becoming an engagement trap; the deal and the
 * queue page stay uncapped.
 */
import { and, asc, desc, eq, gt, gte, lte, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { puzzle, puzzleAttempt } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** The bucket cap: a queue page, not a scroll through a career. */
const BUCKET_LIMIT = 60;

export interface QueueRow {
  puzzleId: string;
  fen: string;
  moves: string;
  rating: number;
  kind: 'opening' | 'motif' | 'phase' | 'time_trouble';
  group: string;
  reviewLevel: number;
  nextReviewAt: Date;
  solved: boolean;
  attempts: number;
}

const QUEUE_COLUMNS = {
  puzzleId: puzzleAttempt.puzzleId,
  fen: puzzle.fen,
  moves: puzzle.moves,
  rating: puzzle.rating,
  kind: puzzleAttempt.kind,
  group: puzzleAttempt.groupKey,
  reviewLevel: puzzleAttempt.reviewLevel,
  nextReviewAt: puzzleAttempt.nextReviewAt,
  solved: puzzleAttempt.solved,
  attempts: puzzleAttempt.attempts,
};

export async function readQueue(
  db: Db,
  playerId: string,
): Promise<{ due: QueueRow[]; upcoming: QueueRow[]; mastered: QueueRow[] }> {
  const [due, upcoming, mastered] = await Promise.all([
    db
      .select(QUEUE_COLUMNS)
      .from(puzzleAttempt)
      .innerJoin(puzzle, eq(puzzle.lichessId, puzzleAttempt.puzzleId))
      .where(
        and(
          eq(puzzleAttempt.playerId, playerId),
          lte(puzzleAttempt.nextReviewAt, sql`now()`),
          ne(puzzleAttempt.reviewLevel, 3),
        ),
      )
      .orderBy(asc(puzzleAttempt.nextReviewAt))
      .limit(BUCKET_LIMIT),
    db
      .select(QUEUE_COLUMNS)
      .from(puzzleAttempt)
      .innerJoin(puzzle, eq(puzzle.lichessId, puzzleAttempt.puzzleId))
      .where(
        and(
          eq(puzzleAttempt.playerId, playerId),
          gt(puzzleAttempt.nextReviewAt, sql`now()`),
          ne(puzzleAttempt.reviewLevel, 3),
        ),
      )
      .orderBy(asc(puzzleAttempt.nextReviewAt))
      .limit(BUCKET_LIMIT),
    db
      .select(QUEUE_COLUMNS)
      .from(puzzleAttempt)
      .innerJoin(puzzle, eq(puzzle.lichessId, puzzleAttempt.puzzleId))
      .where(and(eq(puzzleAttempt.playerId, playerId), eq(puzzleAttempt.reviewLevel, 3)))
      .orderBy(desc(puzzleAttempt.lastAttemptAt))
      .limit(BUCKET_LIMIT),
  ]);
  return {
    due: due,
    upcoming: upcoming,
    mastered: mastered,
  };
}

/** The ten-a-day cap on the due-for-review section, the story's guard. */
export const DAILY_REVIEW_CAP = 10;

/** One due review as the practice surface's section receives it. */
export interface DueReview {
  puzzleId: string;
  kind: QueueRow['kind'];
  group: string;
  reviewLevel: number;
}

export async function readDueReviews(
  db: Db,
  playerId: string,
): Promise<{ reviews: DueReview[]; remaining: number }> {
  const [stamped] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(puzzleAttempt)
    .where(
      and(
        eq(puzzleAttempt.playerId, playerId),
        // The stamp's UTC date is today - the same calendar the streak reads.
        sql`(${puzzleAttempt.reviewSolvedAt} at time zone 'utc')::date
            = (now() at time zone 'utc')::date`,
      ),
    );
  const remaining = Math.max(0, DAILY_REVIEW_CAP - (stamped?.count ?? 0));
  if (remaining === 0) return { reviews: [], remaining: 0 };

  const rows = await db
    .select({
      puzzleId: puzzleAttempt.puzzleId,
      kind: puzzleAttempt.kind,
      group: puzzleAttempt.groupKey,
      reviewLevel: puzzleAttempt.reviewLevel,
    })
    .from(puzzleAttempt)
    .where(
      and(
        eq(puzzleAttempt.playerId, playerId),
        gte(puzzleAttempt.reviewLevel, 1),
        lte(puzzleAttempt.nextReviewAt, sql`now()`),
      ),
    )
    .orderBy(asc(puzzleAttempt.nextReviewAt))
    .limit(remaining);
  return { reviews: rows, remaining };
}
