/**
 * The selection query for the post-tournament nudge (ST-126).
 *
 * One query decides everything, so the rules cannot drift apart: the
 * unsubscribe flag is read on the same table the send writes to, and the send
 * log is both the 7-day exclusion and the 24-hour pacing ledger (AC 6). The
 * budget is `min(90, 99 - sends in the last 24 hours)`: 90 is the per-run cap,
 * and 99 keeps one slot of Resend's daily 100 free for consent notices on
 * send day. If consent volume ever competes for real, the ledger widens to
 * record consent sends too.
 *
 * A consent-gated minor holds no games, so gated accounts fall out
 * structurally; there is no separate consent join.
 */
import { and, asc, eq, exists, gt, isNull, notExists, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema.ts';
import { game, nudgeSend, player } from '../db/schema.ts';
import { session, user } from '../db/auth-schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

export interface NudgeCandidate {
  userId: string;
  email: string;
}

/** AC 3: at most 90 sends per run. */
export const SENDS_PER_RUN = 90;

/** Resend's free-tier daily cap (AC 3). */
export const DAILY_SEND_CAP = 100;

/** One slot of the daily cap stays free for consent notices on send day. */
const CONSENT_HEADROOM = 1;

export async function dailyNudgeSendCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nudgeSend)
    .where(gt(nudgeSend.sentAt, sql`now() - interval '24 hours'`));
  return row?.count ?? 0;
}

export async function nudgeSendBudget(db: Db): Promise<number> {
  const sent = await dailyNudgeSendCount(db);
  return Math.min(SENDS_PER_RUN, DAILY_SEND_CAP - CONSENT_HEADROOM - sent);
}

export async function selectNudgeCandidates(db: Db, limit: number): Promise<NudgeCandidate[]> {
  return (
    db
      .select({ userId: user.id, email: user.email })
      .from(player)
      .innerJoin(user, eq(user.id, player.ownerUserId))
      .where(
        and(
          // Unsubscribed accounts are excluded by the same query that selects,
          // so the flag and the send cannot drift apart.
          isNull(player.nudgeUnsubscribedAt),
          // At least one stored game (AC 1).
          exists(
            db
              .select({ one: sql`1` })
              .from(game)
              .where(eq(game.playerId, player.id)),
          ),
          // No tournament-stream game created in the last 7 days (AC 1). Import
          // is the timestamp, not play: someone who imported this week is
          // already back in the app.
          notExists(
            db
              .select({ one: sql`1` })
              .from(game)
              .where(
                and(
                  eq(game.playerId, player.id),
                  eq(game.stream, 'tournament'),
                  gt(game.importedAt, sql`now() - interval '7 days'`),
                ),
              ),
          ),
          // Signed in within 30 days (AC 1): the nudge reaches a live account.
          exists(
            db
              .select({ one: sql`1` })
              .from(session)
              .where(
                and(
                  eq(session.userId, user.id),
                  gt(session.createdAt, sql`now() - interval '30 days'`),
                ),
              ),
          ),
          // One nudge a week: the send log is the exclusion window (AC 6).
          notExists(
            db
              .select({ one: sql`1` })
              .from(nudgeSend)
              .where(
                and(
                  eq(nudgeSend.userId, user.id),
                  gt(nudgeSend.sentAt, sql`now() - interval '7 days'`),
                ),
              ),
          ),
        ),
      )
      // Deterministic order, the oldest accounts first. Above the daily cap the
      // remainder waits a week, and because sent accounts are excluded for 7
      // days, the never-sent stand first in line next Sunday.
      .orderBy(asc(user.createdAt))
      .limit(limit)
  );
}
