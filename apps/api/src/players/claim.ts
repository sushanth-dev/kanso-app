/**
 * ST-072. The one authorization rule the API has, in two entry points to the
 * same rule: the account owns exactly one player, and every object a route
 * resolves owns back to it.
 *
 * `getOwnPlayerId` is the player-scoped routes' answer: the session's single
 * player id, resolved server-side rather than from a client id. `hasPlayerClaim`
 * is the object-scoped routes' answer (a game, tournament, or proof sheet names
 * its owning player in its row): does that player id belong to the session's
 * user. Both resolve to `player.ownerUserId = session.userId`. There is exactly
 * one rule; two entry points to one rule are not an abstraction.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { player } from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * The session's single player id, or null when the user has no player row (a
 * session outliving its player after a delete). A player-scoped handler answers
 * 404 on null rather than fabricating a player.
 */
export async function getOwnPlayerId(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: player.id })
    .from(player)
    .where(eq(player.ownerUserId, userId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Whether `playerId` belongs to the session's user. Used by the routes that
 * take an object id rather than a player id: the object's row names its owning
 * player, and this asks whether that player is the session's one. A player that
 * does not exist and a player the session does not own both answer false, so a
 * caller naming someone else's id cannot tell a real object from an invented
 * one.
 */
export async function hasPlayerClaim(db: Db, userId: string, playerId: string): Promise<boolean> {
  const rows = await db
    .select({ id: player.id })
    .from(player)
    .where(and(eq(player.id, playerId), eq(player.ownerUserId, userId)))
    .limit(1);
  return rows.length > 0;
}
