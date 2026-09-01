/**
 * ST-107. The review queue the puzzles page shows, in the three buckets the
 * prototype's training page used: what is pending now (due reviews, plus the
 * deal that has not been started - both sit at `next_review_at <= now`),
 * what is coming up for review, and what has climbed out of the ladder into
 * the mastered box. One indexed read per bucket, soonest first.
 */
import { and, asc, desc, eq, gt, lte, ne, sql } from 'drizzle-orm';
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
          ne(puzzleAttempt.reviewLevel, 4),
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
          ne(puzzleAttempt.reviewLevel, 4),
        ),
      )
      .orderBy(asc(puzzleAttempt.nextReviewAt))
      .limit(BUCKET_LIMIT),
    db
      .select(QUEUE_COLUMNS)
      .from(puzzleAttempt)
      .innerJoin(puzzle, eq(puzzle.lichessId, puzzleAttempt.puzzleId))
      .where(and(eq(puzzleAttempt.playerId, playerId), eq(puzzleAttempt.reviewLevel, 4)))
      .orderBy(desc(puzzleAttempt.lastAttemptAt))
      .limit(BUCKET_LIMIT),
  ]);
  return {
    due: due,
    upcoming: upcoming,
    mastered: mastered,
  };
}
