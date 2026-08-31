/**
 * ST-080, amended by ST-105. The daily streak and XP the reader asked for (R8).
 *
 * The activity is a solved practice drill: `record-practice` is the only
 * caller, and a drill answered by "show me" is not a solve. One calendar day,
 * UTC, counts once no matter how many drills are solved that day. A gap of
 * exactly one day since the last counted day extends the streak; any larger
 * gap, or no prior activity, resets it to one.
 *
 * `lastActivityDate <> today` in the `WHERE` clause is the compare-and-swap:
 * two concurrent requests racing to record the same day can both read the
 * same stale row, but only one `UPDATE` matches the guard, so at most one of
 * them writes and XP is never double-counted.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { player } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** XP awarded once per calendar day an activity is recorded. */
export const XP_PER_ACTIVITY_DAY = 10;

/** Today's UTC calendar date, in the `date` column's `YYYY-MM-DD` format. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days between two `YYYY-MM-DD` dates, both read as UTC midnight. */
function daysBetween(from: string, to: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(to) - Date.parse(from)) / msPerDay);
}

export async function recordActivity(db: Db, playerId: string): Promise<void> {
  const [row] = await db
    .select({ currentStreak: player.currentStreak, lastActivityDate: player.lastActivityDate })
    .from(player)
    .where(eq(player.id, playerId))
    .limit(1);
  if (row === undefined) return;

  const today = todayUtc();
  if (row.lastActivityDate === today) return;

  const gap = row.lastActivityDate === null ? null : daysBetween(row.lastActivityDate, today);
  const nextStreak = gap === 1 ? row.currentStreak + 1 : 1;

  await db
    .update(player)
    .set({
      currentStreak: nextStreak,
      xp: sql`${player.xp} + ${XP_PER_ACTIVITY_DAY}`,
      lastActivityDate: today,
    })
    .where(and(eq(player.id, playerId), sql`${player.lastActivityDate} is distinct from ${today}`));
}

/** Level reads off `xp` rather than being stored: one level per 100 XP. */
export function levelFromXp(xp: number): number {
  return Math.floor(xp / 100) + 1;
}
