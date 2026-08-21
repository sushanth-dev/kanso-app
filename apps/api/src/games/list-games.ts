/**
 * The endpoint that lists the account's stored games, filtered by stream.
 *
 * ST-072. The player is the account, so the player id is resolved from the
 * session before any query, and the query filters on `player_id` in the
 * database rather than reading broadly and filtering after, so another
 * account's games are never loaded in the first place. A player with no games
 * gets a 200 with an empty page.
 */
import type { Context } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { listGames } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, tournament } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';
import { toGameSummary } from './game-summary.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountListGames(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(listGames, async (c) => {
    const { stream, limit, page, tournament: tournamentId } = c.req.valid('query');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    // A tournament id names something other than the player, so it is checked
    // against the session's player before it is used as a filter. Absence and
    // refusal both answer 403, so the id cannot be used to enumerate which
    // tournaments exist.
    if (tournamentId) {
      const [t] = await deps.db
        .select({ playerId: tournament.playerId })
        .from(tournament)
        .where(eq(tournament.id, tournamentId))
        .limit(1);
      if (!t || t.playerId !== playerId) {
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
