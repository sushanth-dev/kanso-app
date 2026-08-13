/**
 * The endpoint that lists a player's stored games, filtered by stream.
 *
 * This is the first read endpoint over stored game data, and the first place
 * the tournament/online partition is visible from outside the database. The
 * order here is the security assessment made real: the claim check runs before
 * any query, and the query filters on `player_id` in the database rather than
 * reading broadly and filtering after, so another account's games are never
 * loaded in the first place.
 *
 * Absence and refusal are answered the same way on purpose. A player that does
 * not exist and a player the caller has no claim on both answer 403, so naming
 * someone else's id in the path cannot be used to discover which ids are real.
 * A player the caller does own, with no games, is a 200 with an empty page.
 */
import type { Context } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { listGames } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, tournament } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { toGameSummary } from './game-summary.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountListGames(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(listGames, async (c) => {
    const { playerId } = c.req.valid('param');
    const { stream, limit, page, tournament: tournamentId } = c.req.valid('query');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    if (!(await hasPlayerClaim(deps.db, session.userId, playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your player.' }, 403);
    }

    // A tournament id names something other than the player in the path, so it
    // is claim-checked before it is used as a filter, the same rule and helper
    // as the tournament endpoints. Absence and refusal both answer 403, so the
    // id cannot be used to enumerate which tournaments exist.
    if (tournamentId) {
      const [t] = await deps.db
        .select({ playerId: tournament.playerId })
        .from(tournament)
        .where(eq(tournament.id, tournamentId))
        .limit(1);
      if (!t || !(await hasPlayerClaim(deps.db, session.userId, t.playerId))) {
        return c.json({ code: 'forbidden', message: 'Not your tournament.' }, 403);
      }
    }

    // `and` drops `undefined` members, so the stream and tournament filters
    // compose when both are given and are each optional on their own.
    const where = and(
      eq(game.playerId, playerId),
      stream ? eq(game.stream, stream) : undefined,
      tournamentId ? eq(game.tournamentId, tournamentId) : undefined,
    );

    const rows = await deps.db
      .select()
      .from(game)
      .where(where)
      // Newest first. A game with no `played_at` has an unknown date, not the
      // oldest one, so it sorts last rather than jumping to the top. `imported_at`
      // breaks ties so the same page is the same order on every request.
      .orderBy(sql`${game.playedAt} desc nulls last`, desc(game.importedAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const [row] = await deps.db
      .select({ total: sql<number>`count(*)::int` })
      .from(game)
      .where(where);

    return c.json({ games: rows.map(toGameSummary), total: row!.total, page, limit }, 200);
  });
}
