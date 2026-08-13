/**
 * The attach step (ST-011): resolve a batch of games to tournaments, creating
 * a tournament when there is no match and extending its date range when there
 * is.
 *
 * This is the only code that writes `game.tournament_id` and the only code
 * that creates tournament rows. Both the importer and the backfill call it
 * inside their own transaction, so the identity rule has exactly one caller
 * and uniqueness is enforced in one place.
 *
 * Only tournament-stream games are ever attached. An online game is left
 * unattached even when its `[Event]` tag matches a tournament exactly, and a
 * tournament-stream game whose event normalises to nothing stays unattached.
 *
 * The function returns the per-game outcome so a caller can report how many
 * games it attached and how many it could not and why.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js/session';
import * as schema from '../db/schema.ts';
import { game, tournament } from '../db/schema.ts';
import { belongsToTournament, identityOf, normaliseSite } from './identity.ts';

/** The transaction both the importer and the backfill attach inside. */
export type TournamentTx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export interface AttachInput {
  /** The game's stored row. Only `stream`, `event`, `site`, and `playedAt` are read. */
  id: string;
  stream: 'tournament' | 'online';
  event: string | null;
  site: string | null;
  playedAt: Date | null;
}

export type AttachOutcome =
  | { status: 'attached'; tournamentId: string }
  | { status: 'unattached'; reason: 'online' | 'no_event' };

export interface AttachResult {
  /** Per-game outcome, keyed by game id. */
  outcomes: Map<string, AttachOutcome>;
  /** The ids of tournaments created by this call. */
  createdIds: string[];
}

/**
 * The stored shape of a tournament row that the matcher reads.
 */
interface TournamentRow {
  id: string;
  key: string;
  site: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
}

/**
 * Attach a batch of games to tournaments for one player, in one transaction.
 *
 * The identity rule matches on the normalised event key, the site, and the
 * date window, and there is no unique index on the grouping key (two
 * tournaments can share a key a year apart), so this loads the player's
 * tournaments for the keys present and matches in memory.
 *
 * Each game is matched individually against the stored tournaments, then
 * against any tournament this batch created. A game that matches neither
 * creates a new tournament, so two games at the same event in the same week
 * share one new tournament while two games a year apart become two.
 */
export async function attachGames(
  tx: TournamentTx,
  playerId: string,
  games: AttachInput[],
): Promise<AttachResult> {
  const outcomes = new Map<string, AttachOutcome>();
  const createdIds: string[] = [];

  const attachable = games.filter((g) => g.stream === 'tournament');
  for (const g of games) {
    if (g.stream !== 'tournament') outcomes.set(g.id, { status: 'unattached', reason: 'online' });
  }

  const keys = new Set<string>();
  for (const g of attachable) {
    const identity = identityOf(g.event, g.site);
    if (identity.key == null) {
      outcomes.set(g.id, { status: 'unattached', reason: 'no_event' });
    } else {
      keys.add(identity.key);
    }
  }

  // Load the player's tournaments for the keys present. Filtering in the
  // database on the key keeps the read small; the date window is applied in
  // memory because it is relative to each tournament's own range.
  const existing: TournamentRow[] =
    keys.size === 0
      ? []
      : await tx
          .select({
            id: tournament.id,
            key: tournament.key,
            site: tournament.site,
            startedAt: tournament.startedAt,
            endedAt: tournament.endedAt,
          })
          .from(tournament)
          .where(and(eq(tournament.playerId, playerId), inArray(tournament.key, [...keys])));

  // Tournaments this batch created, keyed by their normalised identity, so a
  // later game in the batch with the same identity and a compatible date joins
  // the same new tournament rather than creating another.
  const batchCreated = new Map<string, TournamentRow>();

  for (const g of attachable) {
    const identity = identityOf(g.event, g.site);
    if (identity.key == null) continue; // already recorded as unattached

    const match = findMatch(g, existing) ?? findMatch(g, [...batchCreated.values()]);
    if (match) {
      outcomes.set(g.id, { status: 'attached', tournamentId: match.id });
      const range = await extendRange(tx, match.id, g.playedAt);
      // Keep the in-memory row in step with the database, or a later game in
      // the batch that would match an extended range would wrongly create a
      // duplicate tournament.
      const inBatch = batchCreated.get(`${match.key}\u0000${match.site ?? ''}`);
      if (inBatch) {
        inBatch.startedAt = range.startedAt;
        inBatch.endedAt = range.endedAt;
      }
      await tx
        .update(game)
        .set({ tournamentId: match.id })
        .where(and(eq(game.playerId, playerId), eq(game.id, g.id)));
      continue;
    }

    // No match: create a tournament for this game and remember it so a
    // compatible later game in the batch shares it.
    const [row] = await tx
      .insert(tournament)
      .values({
        playerId,
        name: g.event ?? identity.key,
        key: identity.key,
        site: g.site,
        startedAt: g.playedAt,
        endedAt: g.playedAt,
      })
      .returning({
        id: tournament.id,
        key: tournament.key,
        site: tournament.site,
        startedAt: tournament.startedAt,
        endedAt: tournament.endedAt,
      });
    createdIds.push(row.id);
    batchCreated.set(`${identity.key}\u0000${identity.site ?? ''}`, row);
    outcomes.set(g.id, { status: 'attached', tournamentId: row.id });
    await tx
      .update(game)
      .set({ tournamentId: row.id })
      .where(and(eq(game.playerId, playerId), eq(game.id, g.id)));
  }

  return { outcomes, createdIds };
}

/** The stored tournament a game belongs to, if any. */
function findMatch(g: AttachInput, candidates: TournamentRow[]): TournamentRow | null {
  const identity = identityOf(g.event, g.site);
  for (const candidate of candidates) {
    // `key` is stored normalised; `site` is stored as the file wrote it, so it
    // is normalised here for comparison.
    if (candidate.key !== identity.key) continue;
    if (normaliseSite(candidate.site) !== identity.site) continue;
    if (
      belongsToTournament(
        { event: g.event, site: g.site, playedAt: g.playedAt },
        {
          key: candidate.key,
          site: candidate.site,
          startedAt: candidate.startedAt,
          endedAt: candidate.endedAt,
        },
      )
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Extend a tournament's date range to include a game's date, if it has one.
 * Returns the range as it now stands, so the caller can keep an in-memory copy
 * in step with the database.
 */
async function extendRange(
  tx: TournamentTx,
  tournamentId: string,
  playedAt: Date | null,
): Promise<{ startedAt: Date | null; endedAt: Date | null }> {
  if (playedAt == null) {
    const [row] = await tx
      .select({ startedAt: tournament.startedAt, endedAt: tournament.endedAt })
      .from(tournament)
      .where(eq(tournament.id, tournamentId));
    return { startedAt: row?.startedAt ?? null, endedAt: row?.endedAt ?? null };
  }
  const [row] = await tx
    .select({
      startedAt: tournament.startedAt,
      endedAt: tournament.endedAt,
    })
    .from(tournament)
    .where(eq(tournament.id, tournamentId));
  if (!row) return { startedAt: null, endedAt: null };
  const at = playedAt.getTime();
  const startedAt =
    row.startedAt == null || at < row.startedAt.getTime() ? playedAt : row.startedAt;
  const endedAt = row.endedAt == null || at > row.endedAt.getTime() ? playedAt : row.endedAt;
  await tx
    .update(tournament)
    .set({ startedAt, endedAt, updatedAt: new Date() })
    .where(eq(tournament.id, tournamentId));
  return { startedAt, endedAt };
}
