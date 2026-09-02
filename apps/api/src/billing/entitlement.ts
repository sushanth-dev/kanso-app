/**
 * ST-044, ST-074, ST-111. The entitlement helpers the tier gate, the
 * per-plan analysis cap, and the per-plan coach budget share. `tierFor`
 * answers from the account's `subscription` row; the budgets count this
 * calendar month's usage across the account's players.
 */
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, mistake, player, subscription } from '../db/schema.ts';
import { ANALYSIS_MONTHLY_CAP, EXPLANATION_MONTHLY_CAP, type Tier } from './plans.ts';

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

/**
 * ST-111. Coach texts generated this calendar month, across the account's
 * players: one generated explanation and one generated Socratic question
 * each cost 1, so a mistake that generated both costs 2. Reading an
 * already-generated text is free and never enters this count.
 */
export async function coachUnitsThisMonth(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [row] = await db
    .select({
      units: sql<number>`count(*) filter (where ${mistake.explanationGeneratedAt} >= ${start}::timestamptz) + count(*) filter (where ${mistake.socraticQuestionGeneratedAt} >= ${start}::timestamptz)`,
    })
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .innerJoin(player, eq(game.playerId, player.id))
    .where(eq(player.ownerUserId, userId));
  return Number(row?.units ?? 0);
}
/**
 * How many more coach texts the account's plan may generate this month; 0
 * at the cap, `null` when the plan has none (pro).
 */
export async function coachRemaining(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<number | null> {
  const cap = EXPLANATION_MONTHLY_CAP[await tierFor(db, userId)];
  if (cap === null) return null;
  return Math.max(0, cap - (await coachUnitsThisMonth(db, userId, now)));
}
