/**
 * ST-156. The overconfidence signal per weakness group: of the player's
 * failed drills that carry a confidence answer, the share rated `sure`,
 * overall and across the trailing week. One grouped read over
 * `puzzle_attempt` serves both render surfaces - the debt card through the
 * patterns read and the puzzles page through the queue - so the two cannot
 * disagree.
 *
 * Skipped prompts are absent from both numerator and denominator, the
 * honest reading of "absent, never as guessed". The figure is practice
 * instrumentation under the ST-129 rule: nothing in the verdict, streak,
 * or ladder arithmetic reads the column.
 *
 * ST-175. "Failed" is the row's current outcome, read from the ladder: a fail
 * or a reveal drops `review_level` to 0 and a solve climbs it, so level 0 is
 * exactly "the latest drill did not solve it". The sticky `solved` column
 * cannot stand in for that - a puzzle solved once and then failed reads
 * `solved = true, review_level = 0`, and it is a failure now.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { puzzleAttempt } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

export interface Calibration {
  /** Rows whose latest drill failed and which carry an answer. */
  failedAnswered: number;
  /** The share of those rated sure, 0 when nothing is answered yet. */
  overconfidence: number;
  /** The same share over the trailing week; 0 when nothing is answered yet. */
  weekOverconfidence: number;
  /** Failed answered drills in the trailing week. */
  weekFailedAnswered: number;
}

interface AggregateRow {
  kind: string;
  groupKey: string;
  failedAnswered: number;
  failedSure: number;
  weekFailedAnswered: number;
  weekFailedSure: number;
}

/**
 * Per group the player has drilled: the overconfidence figures. The query
 * counts the rows whose latest drill failed - the ladder is back at 0 - and
 * which carry an answer, split by whether the row's `last_attempt_at` sits
 * inside the trailing week. The answer is the newest one the player gave, so
 * where a failed re-drill skipped the prompt the row is counted against the
 * last answer it holds. A row with no answer at all lands in no bucket.
 */
export async function readCalibration(db: Db, playerId: string): Promise<Map<string, Calibration>> {
  const rows: AggregateRow[] = await db
    .select({
      kind: puzzleAttempt.kind,
      groupKey: puzzleAttempt.groupKey,
      failedAnswered: sql<number>`count(*) filter (where ${puzzleAttempt.reviewLevel} = 0)::int`,
      failedSure: sql<number>`count(*) filter (where ${puzzleAttempt.reviewLevel} = 0 and ${puzzleAttempt.confidence} = 'sure')::int`,
      weekFailedAnswered: sql<number>`count(*) filter (where ${puzzleAttempt.reviewLevel} = 0 and ${puzzleAttempt.lastAttemptAt} >= now() - interval '7 days')::int`,
      weekFailedSure: sql<number>`count(*) filter (where ${puzzleAttempt.reviewLevel} = 0 and ${puzzleAttempt.confidence} = 'sure' and ${puzzleAttempt.lastAttemptAt} >= now() - interval '7 days')::int`,
    })
    .from(puzzleAttempt)
    .where(
      and(
        eq(puzzleAttempt.playerId, playerId),
        // Only rows that carry an answer enter the arithmetic; a prompt the
        // player never answered is absent, never a guess.
        sql`${puzzleAttempt.confidence} is not null`,
        // ST-175. The latest drill's outcome, not the sticky ever-solved flag.
        sql`${puzzleAttempt.reviewLevel} = 0`,
      ),
    )
    .groupBy(puzzleAttempt.kind, puzzleAttempt.groupKey);

  const map = new Map<string, Calibration>();
  for (const row of rows) {
    map.set(`${row.kind}:${row.groupKey}`, {
      failedAnswered: row.failedAnswered,
      overconfidence: share(row.failedSure, row.failedAnswered),
      weekOverconfidence: share(row.weekFailedSure, row.weekFailedAnswered),
      weekFailedAnswered: row.weekFailedAnswered,
    });
  }
  return map;
}

function share(sure: number, answered: number): number {
  if (answered === 0) return 0;
  return Math.round((sure / answered) * 100) / 100;
}
