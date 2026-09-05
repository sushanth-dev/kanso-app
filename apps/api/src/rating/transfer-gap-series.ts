/**
 * ST-120. The rating gap as a series across the season, beside ST-018's
 * snapshot read.
 *
 * One point per imported tournament: x by the event's date, y by the gap
 * between the latest online rating and the over-the-board rating the event's
 * own games carry. The partition is S5's: only tournament-stream games are
 * read, so an online game never puts a point on this line whatever its
 * headers claim. The online side is the stored snapshot - this read never
 * fetches, and never moves the rating a refresh would move.
 *
 * The over-the-board side of a point is the player's Elo from the event's
 * games, read from the colour the player occupied (the inverse of `leak.ts`'s
 * opponent read). When a tournament's games disagree - ratings published
 * mid-event - the latest dated game wins, because that is the rating the
 * player carried out of the event.
 */
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getTransferGapSeries } from '../contract/routes.ts';
import { game, player, tournament } from '../db/schema.ts';
import * as schema from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountTransferGapSeries(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getTransferGapSeries, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const [row] = await deps.db.select().from(player).where(eq(player.id, playerId)).limit(1);
    // `getOwnPlayerId` just resolved this id, so the row exists.
    const current = row!;

    // Chess.com first, mirroring the FIDE-else-USCF preference on the other side.
    const platform =
      current.chesscomRating !== null
        ? ('chesscom' as const)
        : current.lichessRating !== null
          ? ('lichess' as const)
          : null;
    const onlineRating = current.chesscomRating ?? current.lichessRating;

    const events = await deps.db
      .select({ id: tournament.id, name: tournament.name, startedAt: tournament.startedAt })
      .from(tournament)
      .where(eq(tournament.playerId, playerId));

    const games = await deps.db
      .select({
        tournamentId: game.tournamentId,
        playedAt: game.playedAt,
        playerColor: game.playerColor,
        whiteElo: game.whiteElo,
        blackElo: game.blackElo,
      })
      .from(game)
      .where(and(eq(game.playerId, playerId), eq(game.stream, 'tournament')));

    // Per event: the latest dated game carrying a player-side Elo, and the
    // earliest dated game for the x axis when the row has no range of its own.
    const ratingOf = new Map<string, { rating: number; playedAt: Date }>();
    const firstPlayed = new Map<string, Date>();
    for (const g of games) {
      if (g.tournamentId === null) continue;
      const rating =
        g.playerColor === 'white' ? g.whiteElo : g.playerColor === 'black' ? g.blackElo : null;
      if (rating !== null && g.playedAt !== null) {
        const prev = ratingOf.get(g.tournamentId);
        if (prev === undefined || g.playedAt > prev.playedAt) {
          ratingOf.set(g.tournamentId, { rating, playedAt: g.playedAt });
        }
      }
      if (g.playedAt !== null) {
        const prev = firstPlayed.get(g.tournamentId);
        if (prev === undefined || g.playedAt < prev) firstPlayed.set(g.tournamentId, g.playedAt);
      }
    }

    let skippedTournaments = 0;
    const points: Array<{
      tournamentId: string;
      name: string;
      date: string;
      rating: number;
      gap: number | null;
    }> = [];
    for (const t of events) {
      const rated = ratingOf.get(t.id);
      const date = t.startedAt ?? firstPlayed.get(t.id) ?? null;
      if (rated === undefined || date === null) {
        // No player-side Elo in the games, or no date to plot against: no
        // point, and the count says so rather than the chart staying quiet.
        skippedTournaments += 1;
        continue;
      }
      points.push({
        tournamentId: t.id,
        name: t.name,
        date: date.toISOString(),
        rating: rated.rating,
        gap: onlineRating === null ? null : onlineRating - rated.rating,
      });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));

    return c.json({ playerId, platform, onlineRating, points, skippedTournaments }, 200);
  });
}
