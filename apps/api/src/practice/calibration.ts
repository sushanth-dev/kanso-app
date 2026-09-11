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
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { puzzleAttempt } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

export interface Calibration {
  /** Failed drills that carry an answer. */
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
 * counts failed drills (`solved` false on the aggregated row) that carry a
 * non-null confidence, split by answer and by whether the drill's
 * `last_attempt_at` sits inside the trailing week. A null answer - a
 * skipped prompt - lands in no bucket.
 */
export async function readCalibration(db: Db, playerId: string): Promise<Map<string, Calibration>> {
  const rows: AggregateRow[] = await db
    .select({
      kind: puzzleAttempt.kind,
      groupKey: puzzleAttempt.groupKey,
      failedAnswered: sql<number>`count(*) filter (where ${puzzleAttempt.solved} = false)::int`,
      failedSure: sql<number>`count(*) filter (where ${puzzleAttempt.solved} = false and ${puzzleAttempt.confidence} = 'sure')::int`,
      weekFailedAnswered: sql<number>`count(*) filter (where ${puzzleAttempt.solved} = false and ${puzzleAttempt.lastAttemptAt} >= now() - interval '7 days')::int`,
      weekFailedSure: sql<number>`count(*) filter (where ${puzzleAttempt.solved} = false and ${puzzleAttempt.confidence} = 'sure' and ${puzzleAttempt.lastAttemptAt} >= now() - interval '7 days')::int`,
    })
    .from(puzzleAttempt)
    .where(
      and(
        eq(puzzleAttempt.playerId, playerId),
        // Only rows that carry an answer enter the arithmetic; a skipped
        // prompt is absent, never a guess.
        sql`${puzzleAttempt.confidence} is not null`,
        sql`${puzzleAttempt.solved} = false`,
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
