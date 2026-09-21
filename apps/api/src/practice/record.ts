/**
 * ST-106. Record one completed drill on a pool puzzle.
 *
 * The shape record-practice used carries over: `attempts` counts completed
 * drills rather than raw wrong moves, `solved` is sticky (`solved or
 * excluded.solved`), so a puzzle solved once stays solved even when a later
 * attempt ended in a reveal, and the group identity is claimed by the first
 * drill - a puzzle later re-drilled under another group does not move rows
 * between counts. ST-175. The aggregate keeps each field's newest *known*
 * value, so a skipped confidence prompt leaves the last answer standing
 * rather than erasing it; which way the latest drill went is the ladder's
 * question, and `review_level` answers it. The activity write runs in the
 * same transaction and only
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
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { HUMAN_LABELS, type WeaknessKind } from '../analysis/leak.ts';
import * as schema from '../db/schema.ts';
import { patternState, puzzle, puzzleAttempt } from '../db/schema.ts';
import { recordActivity } from '../players/activity.ts';
import { themeForGroup } from './themes.ts';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ST-156. The confidence the player rated their answer with, asked before
 * any reveal. Null means the prompt was skipped: absent from the
 * overconfidence arithmetic, never read as a guess.
 */
export type Confidence = 'sure' | 'not_sure' | 'guessed';

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
  confidence: Confidence | null = null,
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
        // ST-156. The prompt asked before any reveal; the answer lands with
        // the outcome. Null is a skipped prompt.
        confidence,
      })
      .onConflictDoUpdate({
        target: [puzzleAttempt.playerId, puzzleAttempt.puzzleId],
        set: {
          attempts: sql`${puzzleAttempt.attempts} + 1`,
          solved: sql`${puzzleAttempt.solved} or excluded.solved`,
          lastAttemptAt: sql`now()`,
          // ST-156, ST-175. The row aggregates drills, so the newest answer
          // stands; a skipped prompt carries no answer and so leaves the last
          // one we hold in place rather than erasing it.
          confidence: sql`coalesce(excluded.confidence, ${puzzleAttempt.confidence})`,
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

    // ST-150. The mastered definition is the queue's: every puzzle the group
    // has dealt reaches reviewLevel 3. When that first happens with no
    // pattern_state row yet, the group becomes a retirement candidate,
    // written for both streams inside the same transaction so a drill that
    // masters a group cannot leave the state unseen. ST-152: a row that came
    // back re-masters here too - it flips to candidate with a fresh window,
    // and its relapse history survives the flip; a retired row in the other
    // stream fails the guarded where and keeps its retirement.
    if (solved) {
      const [unmastered] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(puzzleAttempt)
        .where(
          and(
            eq(puzzleAttempt.playerId, playerId),
            eq(puzzleAttempt.kind, kind),
            eq(puzzleAttempt.groupKey, group),
            sql`${puzzleAttempt.reviewLevel} < 3`,
          ),
        );
      if (unmastered?.n === 0) {
        const label = HUMAN_LABELS[group] ?? group;
        await tx
          .insert(patternState)
          .values(
            (['tournament', 'online'] as const).map((stream) => ({
              playerId,
              kind,
              groupKey: group,
              stream,
              label,
              state: 'candidate' as const,
            })),
          )
          .onConflictDoUpdate({
            target: [
              patternState.playerId,
              patternState.kind,
              patternState.groupKey,
              patternState.stream,
            ],
            set: { state: 'candidate', masteredAt: sql`now()` },
            setWhere: eq(patternState.state, 'came_back'),
          });
      }
    }

    return {
      attempts: row!.attempts,
      solved: row!.solved,
      reviewLevel: row!.reviewLevel,
      nextReviewAt: row!.nextReviewAt,
    };
  });
}
