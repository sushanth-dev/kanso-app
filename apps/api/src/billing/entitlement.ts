/**
 * ST-044, ST-074. The entitlement helpers the tier gate and the per-plan
 * analysis cap share. `tierFor` answers from the account's `subscription`
 * row; the analysis budget counts games analysed this calendar month across
 * the account's players.
 */
import { and, count, eq, gte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, player, subscription } from '../db/schema.ts';
import { ANALYSIS_MONTHLY_CAP, type Tier } from './plans.ts';

type Db = PostgresJsDatabase<typeof schema>;

export type { Tier };

export async function tierFor(db: Db, userId: string): Promise<Tier> {
  const [sub] = await db
    .select({ tier: subscription.tier })
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .limit(1);
  return sub?.tier ?? 'beginner';
}

/** Games with `analyzed_at` this calendar month, across the account's players. */
export async function analysedThisMonth(db: Db, userId: string, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({ n: count() })
    .from(game)
    .innerJoin(player, eq(game.playerId, player.id))
    .where(and(eq(player.ownerUserId, userId), gte(game.analyzedAt, start)));
  return Number(row?.n ?? 0);
}

/**
 * How many more games the account's plan may analyse this month; 0 at the
 * cap, `null` when the plan has none (pro).
 */
export async function analysisRemaining(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<number | null> {
  const cap = ANALYSIS_MONTHLY_CAP[await tierFor(db, userId)];
  if (cap === null) return null;
  return Math.max(0, cap - (await analysedThisMonth(db, userId, now)));
}
