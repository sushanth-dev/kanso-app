/**
 * ST-105. The record that a player closed one of the report's action items:
 * the summary a model accepted against one weakness's advice, and the one-off
 * XP that verdict pays.
 *
 * Two guards do the whole job. The write is an INSERT ... ON CONFLICT DO
 * NOTHING against the unique (player, kind, group key) index, so a
 * re-submission finds the row already there and pays nothing - the prototype's
 * PENDING-to-COMPLETED guard, expressed as schema instead of a status check.
 * And the XP award runs in the same transaction as the insert, so a verdict
 * that pays is a verdict that stored.
 *
 * The key is `groupKeyOf`'s, never the weakness row's id: a report
 * regenerates whenever its scope's games change and writes fresh weakness
 * rows, and the done state has to survive that. Rows exist only for done
 * items - a failed verdict stores nothing.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WeaknessKind } from '../analysis/leak.ts';
import * as schema from '../db/schema.ts';
import { adviceProgress, player } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** ST-105. The prototype's award for one verified item (`award_curriculum_xp`). */
export const XP_PER_VERIFIED_ADVICE = 100;

/** One read for a whole report: `kind:groupKey` to the time it was completed. */
export async function readAdviceProgress(db: Db, playerId: string): Promise<Map<string, Date>> {
  const rows = await db
    .select({
      kind: adviceProgress.kind,
      groupKey: adviceProgress.groupKey,
      completedAt: adviceProgress.completedAt,
    })
    .from(adviceProgress)
    .where(eq(adviceProgress.playerId, playerId));
  return new Map(rows.map((r) => [`${r.kind}:${r.groupKey}`, r.completedAt]));
}

/** The completion time of one weakness group's row, when it is already done. */
export async function completedAdviceAt(
  db: Db,
  playerId: string,
  kind: WeaknessKind,
  groupKey: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ completedAt: adviceProgress.completedAt })
    .from(adviceProgress)
    .where(
      and(
        eq(adviceProgress.playerId, playerId),
        eq(adviceProgress.kind, kind),
        eq(adviceProgress.groupKey, groupKey),
      ),
    )
    .limit(1);
  return row?.completedAt ?? null;
}

/**
 * Store the accepted summary and pay the award exactly once. Returns the
 * completion time of this transition, or null when the row already existed,
 * which means another submission got there first.
 */
export async function completeAdvice(
  db: Db,
  playerId: string,
  kind: WeaknessKind,
  groupKey: string,
  summary: string,
): Promise<Date | null> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(adviceProgress)
      .values({ playerId, kind, groupKey, summary })
      .onConflictDoNothing({
        target: [adviceProgress.playerId, adviceProgress.kind, adviceProgress.groupKey],
      })
      .returning({ id: adviceProgress.id, completedAt: adviceProgress.completedAt });
    if (inserted.length === 0) return null;
    await tx
      .update(player)
      .set({ xp: sql`${player.xp} + ${XP_PER_VERIFIED_ADVICE}` })
      .where(eq(player.id, playerId));
    return inserted[0]!.completedAt;
  });
}
