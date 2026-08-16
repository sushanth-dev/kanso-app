/**
 * The one authorization rule the API has: a session has a claim on the players
 * it plays as (B4).
 *
 * "Plays as" is `player.ownerUserId`. The former "pays for" guardian claim is
 * gone: a guardian is now a bare email that confirms consent, not an account
 * (ADR-0035), so there is no second identity holding a claim. This is the first
 * handler to need the check (ST-005) and every later handler that takes a
 * `playerId` needs the same one, so it lives here rather than inline. It is
 * deliberately not a permission framework: there is exactly one rule, and one
 * rule does not need an abstraction.
 *
 * A player that does not exist and a player the session has no claim on both
 * return false. The list endpoint answers 403 to both, so a caller naming
 * someone else's id cannot tell a real player from an invented one.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { player } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

export async function hasPlayerClaim(db: Db, userId: string, playerId: string): Promise<boolean> {
  const rows = await db
    .select({ id: player.id })
    .from(player)
    .where(and(eq(player.id, playerId), eq(player.ownerUserId, userId)))
    .limit(1);
  return rows.length > 0;
}
