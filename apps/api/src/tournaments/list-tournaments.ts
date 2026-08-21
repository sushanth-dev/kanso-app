/**
 * The endpoint that lists a player's tournaments, most recent first.
 *
 * A tournament exists only because a player has games in it, so the list is a
 * grouped read over `game.tournament_id` rather than a read of the tournament
 * table on its own: a tournament row with no games attached is an artifact of a
 * partial backfill and has nothing to show. The claim check runs before any
 * query, and the query filters on `player_id` in the database, so another
 * account's tournaments are never loaded in the first place.
 *
 * A player with no tournaments gets an empty list and a 200, not a 404, which
 * is the same convention the games list set for a player with no games.
 */
import type { Context } from 'hono';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { listTournaments } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, tournament } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountListTournaments(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(listTournaments, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    // Group the player's games by tournament. Only games with a tournament are
    // counted; an unattached game has no tournament to appear under. `ended_at`
    // breaks ties so the same list is the same order on every request.
    const rows = await deps.db
      .select({
        id: tournament.id,
        name: tournament.name,
        site: tournament.site,
        startedAt: tournament.startedAt,
        endedAt: tournament.endedAt,
        gameCount: sql<number>`count(*)::int`,
        analysedCount: sql<number>`count(*) filter (where ${game.analysisStatus} = 'complete')::int`,
      })
      .from(tournament)
      .innerJoin(game, eq(game.tournamentId, tournament.id))
      .where(eq(tournament.playerId, playerId))
      .groupBy(tournament.id)
      .orderBy(
        sql`${tournament.endedAt} desc nulls last`,
        sql`${tournament.startedAt} desc nulls last`,
        tournament.name,
      );

    return c.json(
      {
        tournaments: rows.map((row) => ({
          id: row.id,
          name: row.name,
          site: row.site,
          startedAt: row.startedAt?.toISOString() ?? null,
          endedAt: row.endedAt?.toISOString() ?? null,
          gameCount: row.gameCount,
          analysedCount: row.analysedCount,
        })),
      },
      200,
    );
  });
}
