/**
 * A stored player row in the contract's `Player` shape.
 *
 * The projection the account handlers return: identity and rating metadata,
 * never the owner's user id, which is the claim boundary rather than something
 * a client needs to see.
 */
import type { player } from '../db/schema.ts';
import { levelFromXp } from '../players/activity.ts';

export function toPlayer(row: typeof player.$inferSelect) {
  return {
    id: row.id,
    displayName: row.displayName,
    birthYear: row.birthYear,
    fideId: row.fideId,
    fideRating: row.fideRating,
    uscfId: row.uscfId,
    uscfRating: row.uscfRating,
    chesscomUsername: row.chesscomUsername,
    lichessUsername: row.lichessUsername,
    chesscomRating: row.chesscomRating,
    lichessRating: row.lichessRating,
    currentStreak: row.currentStreak,
    xp: row.xp,
    level: levelFromXp(row.xp),
    createdAt: row.createdAt.toISOString(),
  };
}
