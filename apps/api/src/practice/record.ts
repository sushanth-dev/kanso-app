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
      .values({ playerId, puzzleId, kind, groupKey: group, attempts: 1, solved })
      .onConflictDoUpdate({
        target: [puzzleAttempt.playerId, puzzleAttempt.puzzleId],
        set: {
          attempts: sql`${puzzleAttempt.attempts} + 1`,
          solved: sql`${puzzleAttempt.solved} or excluded.solved`,
          lastAttemptAt: sql`now()`,
        },
      })
      .returning();
    if (solved) await recordActivity(tx, playerId);
    return { attempts: row!.attempts, solved: row!.solved };
  });
}
