/**
 * ST-106. Record one completed drill on a pool puzzle.
 *
 * The shape record-practice used carries over: `attempts` counts completed
 * drills rather than raw wrong moves, `solved` is sticky (`solved or
 * excluded.solved`), so a puzzle solved once stays solved even when a later
 * attempt ended in a reveal, and the group identity is claimed by the first
 * drill - a puzzle later re-drilled under another group does not move rows
 * between counts. The activity write runs in the same transaction and only
 * on a solve, so a reveal never pays; the once-per-day compare-and-swap in
 * `recordActivity` makes every repeat a no-op.
 *
 * ST-124. A solve advances the review ladder one rung - two days at level 1,
 * seven at level 2, thirty at level 3, capped at 3 - and a reveal or a fail
 * drops back to 0, due immediately. A review solve, meaning a solved drill
 * on a puzzle that was already on the ladder with its review time passed,
 * stamps `review_solved_at`; the due-reviews read counts today's stamps in
 * UTC to hold the section to ten puzzles a day. Re-drilling a puzzle early,
 * or re-solving one that failed, is extra practice and stamps nothing.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WeaknessKind } from '../analysis/leak.ts';
import * as schema from '../db/schema.ts';
import { puzzle, puzzleAttempt } from '../db/schema.ts';
import { recordActivity } from '../players/activity.ts';
import { themeForGroup } from './themes.ts';

type Db = PostgresJsDatabase<typeof schema>;

export interface DrillOutcome {
  attempts: number;
  solved: boolean;
  /** The review-ladder rung after this attempt: 0 failed or fresh, 3 the top. */
  reviewLevel: number;
  /** When the puzzle returns for review. */
  nextReviewAt: Date;
}

export async function recordDrill(
  db: Db,
  playerId: string,
  puzzleId: string,
  kind: WeaknessKind,
  group: string,
  solved: boolean,
): Promise<DrillOutcome | 'no_such_puzzle' | 'no_such_group'> {
  if (themeForGroup(kind, group) === null) return 'no_such_group';

  // The pool never shrinks mid-drill, so a plain read answers existence; the
  // foreign key backs the answer up for any race this check could miss.
  const [inPool] = await db
    .select({ lichessId: puzzle.lichessId })
    .from(puzzle)
    .where(eq(puzzle.lichessId, puzzleId))
    .limit(1);
  if (inPool === undefined) return 'no_such_puzzle';

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(puzzleAttempt)
      .values({
        playerId,
        puzzleId,
        kind,
        groupKey: group,
        attempts: 1,
        solved,
        // A first-attempt solve enters rung 1 (back in two days); a reveal
        // or a fail stays at 0, due now.
        reviewLevel: solved ? 1 : 0,
        nextReviewAt: solved ? sql`now() + interval '2 days'` : sql`now()`,
        assignedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [puzzleAttempt.playerId, puzzleAttempt.puzzleId],
        set: {
          attempts: sql`${puzzleAttempt.attempts} + 1`,
          solved: sql`${puzzleAttempt.solved} or excluded.solved`,
          lastAttemptAt: sql`now()`,
          // A solve climbs one rung (capped at 3, the thirty-day rung);
          // a reveal drops back to 0, due now, and the queue re-deals it.
          reviewLevel: solved ? sql`least(${puzzleAttempt.reviewLevel} + 1, 3)` : sql`0`,
          nextReviewAt: solved
            ? sql`(case least(${puzzleAttempt.reviewLevel} + 1, 3)
                when 1 then now() + interval '2 days'
                when 2 then now() + interval '7 days'
                else now() + interval '30 days' end)`
            : sql`now()`,
          // The pre-update columns in a DO UPDATE SET read the existing row,
          // so `review_level >= 1 and next_review_at <= now()` is exactly
          // "the puzzle was due on the ladder": a review solve. A redo of a
          // failed puzzle (level 0) or an early re-drill stamps nothing.
          reviewSolvedAt: solved
            ? sql`case when ${puzzleAttempt.reviewLevel} >= 1
                       and ${puzzleAttempt.nextReviewAt} <= now()
                  then now() else ${puzzleAttempt.reviewSolvedAt} end`
            : sql`${puzzleAttempt.reviewSolvedAt}`,
        },
      })
      .returning();
    if (solved) await recordActivity(tx, playerId);
    return {
      attempts: row!.attempts,
      solved: row!.solved,
      reviewLevel: row!.reviewLevel,
      nextReviewAt: row!.nextReviewAt,
    };
  });
}
