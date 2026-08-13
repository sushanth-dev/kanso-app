/**
 * The endpoint that reads one tournament with its games in round order.
 *
 * This is the first endpoint in the API that takes an id which is not a player
 * id, so the claim check cannot run on the path parameter directly. The handler
 * resolves the tournament's owning player first and then calls `hasPlayerClaim`
 * on that, which is the one authorization rule the API has rather than a second
 * one beside it. Absence and refusal both answer 403, so naming a tournament id
 * cannot be used to discover which ids are real.
 *
 * The score is counted only from games where the player's side is known, and
 * the excluded count is reported beside it, so a score over an incomplete set
 * is a number a coach can check rather than trust.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getTournament } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, tournament } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { resultPoints, toTournamentGame } from './tournament-game.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountGetTournament(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getTournament, async (c) => {
    const { tournamentId } = c.req.valid('param');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const [row] = await deps.db
      .select({ playerId: tournament.playerId })
      .from(tournament)
      .where(eq(tournament.id, tournamentId))
      .limit(1);

    // A tournament that does not exist and one the caller has no claim on both
    // answer 403, so the id cannot be used to enumerate which tournaments exist.
    if (!row || !(await hasPlayerClaim(deps.db, session.userId, row.playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your tournament.' }, 403);
    }

    const [meta] = await deps.db
      .select({
        id: tournament.id,
        name: tournament.name,
        site: tournament.site,
        startedAt: tournament.startedAt,
        endedAt: tournament.endedAt,
      })
      .from(tournament)
      .where(eq(tournament.id, tournamentId))
      .limit(1);

    // Round order, then board order within a round. Games with no round sort
    // last rather than first, because an unnumbered game is the exception and
    // burying the numbered ones behind it would be backwards.
    const games = await deps.db
      .select()
      .from(game)
      .where(eq(game.tournamentId, tournamentId))
      .orderBy(game.round, game.board);

    const views = games.map(toTournamentGame);
    let score = 0;
    let scoreGames = 0;
    for (const g of views) {
      if (g.result !== null) {
        score += resultPoints(g.result);
        scoreGames++;
      }
    }

    return c.json(
      {
        id: meta.id,
        name: meta.name,
        site: meta.site,
        startedAt: meta.startedAt?.toISOString() ?? null,
        endedAt: meta.endedAt?.toISOString() ?? null,
        games: views,
        score,
        scoreGames,
        scoreExcluded: views.length - scoreGames,
      },
      200,
    );
  });
}
