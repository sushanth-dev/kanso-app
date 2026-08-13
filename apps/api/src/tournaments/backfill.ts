/**
 * The tournament backfill (ST-011): attach the tournament-stream games already
 * stored to tournaments, without a re-import.
 *
 * This is operator-run, not reachable over HTTP. It is re-runnable by
 * construction: it only ever processes tournament-stream games whose
 * `tournament_id` is null, so a run interrupted halfway can be repeated rather
 * than repaired, and running it twice produces the same rows as running it
 * once. It only inserts tournament rows and sets `tournament_id`; it never
 * deletes or rewrites a game.
 *
 * The report is the sprint's evidence. A run that prints nothing is a failed
 * run, so the caller is required to read the three counts: tournaments
 * created, games attached, and tournament-stream games it could not attach and
 * why (a missing event tag, or an event name that normalised to nothing).
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game } from '../db/schema.ts';
import { attachGames } from './attach.ts';

type Db = PostgresJsDatabase<typeof schema>;

export interface BackfillReport {
  tournamentsCreated: number;
  gamesAttached: number;
  /** Tournament-stream games that could not be attached, by reason. */
  unattached: { reason: 'no_event'; count: number }[];
}

/**
 * Attach every unattached tournament-stream game to a tournament, per player.
 *
 * The identity rule scopes a tournament to one player, so games are processed
 * one player at a time. Only games with a null `tournament_id` are considered,
 * which is what makes the backfill re-runnable and purely additive: a run
 * interrupted halfway is repeated, not repaired, and running it twice produces
 * the same rows as running it once.
 */
export async function runBackfill(db: Db): Promise<BackfillReport> {
  const report: BackfillReport = { tournamentsCreated: 0, gamesAttached: 0, unattached: [] };

  const players = await db
    .selectDistinct({ playerId: game.playerId })
    .from(game)
    .where(eq(game.stream, 'tournament'));

  for (const { playerId } of players) {
    const rows = await db
      .select({
        id: game.id,
        stream: game.stream,
        event: game.event,
        site: game.site,
        playedAt: game.playedAt,
      })
      .from(game)
      .where(and(eq(game.playerId, playerId), isNull(game.tournamentId)));

    // Only tournament-stream games are attachable; the query already restricts
    // to them, but the filter keeps the call honest about what it is given.
    const attachable = rows.filter((r) => r.stream === 'tournament');

    const result = await db.transaction(async (tx) => {
      return attachGames(tx, playerId, attachable);
    });

    report.tournamentsCreated += result.createdIds.length;
    for (const outcome of result.outcomes.values()) {
      if (outcome.status === 'attached') report.gamesAttached += 1;
      if (outcome.status === 'unattached' && outcome.reason === 'no_event') {
        const entry = report.unattached.find((u) => u.reason === 'no_event');
        if (entry) entry.count += 1;
        else report.unattached.push({ reason: 'no_event', count: 1 });
      }
    }
  }

  return report;
}
