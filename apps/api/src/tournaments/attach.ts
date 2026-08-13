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
import { identityOf, normaliseSite, WINDOW_MS } from './identity.ts';

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

/** A game with the fields the clustering reads. */
interface GameRow {
  id: string;
  event: string | null;
  site: string | null;
  playedAt: Date | null;
  tournamentId: string | null;
}

/** A tournament row, as the reconciliation reads it. */
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
 * A tournament is a maximal set of games at the same (player, event, site)
 * whose consecutive play dates are within 30 days. That is a clustering, not an
 * incremental range, and it must be computed from all of a player's games for a
 * key at once: a real export can list a single tournament's games out of
 * chronological order, and growing a range game by game in file order would
 * split one tournament wherever a gap happened to fall.
 *
 * So this loads every tournament-stream game the player already holds for the
 * keys present, merges in the batch, clusters each key by date chaining, and
 * reconciles each cluster to a tournament. A cluster whose games already sit in
 * one tournament reuses it (idempotent on re-import); a cluster that spans two
 * tournaments merges them; a cluster with no tournament creates one.
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

  // Every tournament-stream game the player holds for the keys present, both
  // already-attached and not. The batch is merged in below; the identity rule
  // is applied in memory because it is relative to each game's own tags.
  const held: GameRow[] =
    keys.size === 0
      ? []
      : await tx
          .select({
            id: game.id,
            event: game.event,
            site: game.site,
            playedAt: game.playedAt,
            tournamentId: game.tournamentId,
          })
          .from(game)
          .where(and(eq(game.playerId, playerId), eq(game.stream, 'tournament')));

  // Merge the batch into the held set, deduplicating on id so a re-import that
  // re-sends already-stored games does not double them.
  const byId = new Map(held.map((g) => [g.id, g]));
  for (const g of attachable) {
    byId.set(g.id, {
      id: g.id,
      event: g.event,
      site: g.site,
      playedAt: g.playedAt,
      // The batch is the games this call is attaching; they are not yet
      // attached to anything by this call.
      tournamentId: null,
    });
  }
  const all = [...byId.values()];

  // Group by normalised identity so clustering happens per (key, site).
  const byIdentity = new Map<string, GameRow[]>();
  for (const g of all) {
    const identity = identityOf(g.event, g.site);
    if (identity.key == null) continue;
    const slot = `${identity.key}\u0000${identity.site ?? ''}`;
    const list = byIdentity.get(slot) ?? [];
    list.push(g);
    byIdentity.set(slot, list);
  }

  // The player's tournaments for every key present in the held set, for
  // reconciliation. This is all of `byIdentity`'s keys, not just the batch's:
  // a held game from a previous upload can cluster under a key the current
  // batch does not carry, and its tournament must still be found.
  const identityKeys = [...byIdentity.keys()].map((slot) => slot.split('\u0000')[0]);
  const existingTournaments: TournamentRow[] =
    identityKeys.length === 0
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
          .where(
            and(
              eq(tournament.playerId, playerId),
              inArray(tournament.key, [...new Set(identityKeys)]),
            ),
          );

  for (const group of byIdentity.values()) {
    const identity = identityOf(group[0].event, group[0].site);
    const key = identity.key!;
    const site = identity.site;

    // Cluster by date chaining: a new cluster starts when a game is more than
    // 30 days from the previous game's date. Games with no date form their own
    // cluster, because they cannot be placed on a timeline.
    const clusters = clusterByDate(group);

    for (const cluster of clusters) {
      // The distinct tournaments the cluster's already-attached games sit in.
      const attachedIds = new Set(
        cluster.filter((g) => g.tournamentId != null).map((g) => g.tournamentId!),
      );

      let target: TournamentRow | null = null;
      if (attachedIds.size === 1) {
        target = existingTournaments.find((t) => t.id === [...attachedIds][0]) ?? null;
      } else if (attachedIds.size === 0) {
        // No game in this cluster is attached yet (a fresh batch game). Reuse
        // an existing tournament of the same key and site whose range is within
        // 30 days of the cluster, so games imported in separate uploads join
        // the same tournament instead of each creating one.
        const range = clusterRange(cluster);
        target =
          existingTournaments.find(
            (t) => t.key === key && normaliseSite(t.site) === site && rangesOverlap(t, range),
          ) ?? null;
      } else if (attachedIds.size > 1) {
        // The cluster spans two tournaments (a previous split). Merge them:
        // reuse the first, reassign the rest.
        target = existingTournaments.find((t) => t.id === [...attachedIds][0]) ?? null;
        if (target) {
          const others = [...attachedIds].slice(1);
          await tx
            .update(game)
            .set({ tournamentId: target.id })
            .where(and(eq(game.playerId, playerId), inArray(game.tournamentId, others)));
        }
      }

      if (target == null) {
        // No tournament owns this cluster: create one.
        const dates = cluster.map((g) => g.playedAt).filter((d): d is Date => d != null);
        const [row] = await tx
          .insert(tournament)
          .values({
            playerId,
            name: cluster[0].event ?? key,
            key,
            site,
            startedAt: dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
            endedAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
          })
          .returning({ id: tournament.id });
        createdIds.push(row.id);
        target = { id: row.id, key, site, startedAt: null, endedAt: null };
      }

      // Extend the target's range to cover the cluster, then attach every game
      // in the cluster to it.
      const dates = cluster.map((g) => g.playedAt).filter((d): d is Date => d != null);
      const startedAt = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
      const endedAt = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
      await tx
        .update(tournament)
        .set({
          startedAt: mergeStart(target.startedAt, startedAt),
          endedAt: mergeEnd(target.endedAt, endedAt),
          updatedAt: new Date(),
        })
        .where(eq(tournament.id, target.id));

      await tx
        .update(game)
        .set({ tournamentId: target.id })
        .where(
          and(
            eq(game.playerId, playerId),
            inArray(
              game.id,
              cluster.map((g) => g.id),
            ),
          ),
        );

      for (const g of cluster) {
        if (outcomes.has(g.id)) continue; // an existing game already has an outcome
        outcomes.set(g.id, { status: 'attached', tournamentId: target.id });
      }
    }
  }

  return { outcomes, createdIds };
}

/**
 * Cluster games by date chaining: a new cluster starts when a game is more
 * than 30 days from the previous game's date.
 *
 * Undated games all form one cluster together. They are the same event and
 * site, so they belong to the same tournament, but they cannot be placed on a
 * timeline, so they never merge two dated clusters they cannot be placed
 * between.
 */
function clusterByDate(games: GameRow[]): GameRow[][] {
  const dated = games
    .filter((g) => g.playedAt != null)
    .sort((a, b) => a.playedAt!.getTime() - b.playedAt!.getTime());
  const undated = games.filter((g) => g.playedAt == null);

  const clusters: GameRow[][] = [];
  let current: GameRow[] = [];
  let prev: Date | null = null;
  for (const g of dated) {
    if (prev != null && g.playedAt!.getTime() - prev.getTime() > WINDOW_MS) {
      if (current.length) clusters.push(current);
      current = [];
    }
    current.push(g);
    prev = g.playedAt;
  }
  if (current.length) clusters.push(current);

  if (undated.length) clusters.push(undated);
  return clusters;
}

/** The date range a cluster spans, from its dated games. */
function clusterRange(cluster: GameRow[]): { startedAt: Date | null; endedAt: Date | null } {
  const dates = cluster.map((g) => g.playedAt).filter((d): d is Date => d != null);
  if (dates.length === 0) return { startedAt: null, endedAt: null };
  return {
    startedAt: new Date(Math.min(...dates.map((d) => d.getTime()))),
    endedAt: new Date(Math.max(...dates.map((d) => d.getTime()))),
  };
}

/**
 * Whether a cluster's range is within 30 days of an existing tournament's
 * range. A cluster with no dates is treated as within any tournament of the
 * same key and site, because it cannot be placed on a timeline.
 */
function rangesOverlap(
  tournament: TournamentRow,
  range: { startedAt: Date | null; endedAt: Date | null },
): boolean {
  if (range.startedAt == null || range.endedAt == null) return true;
  const clusterStart = range.startedAt.getTime();
  const clusterEnd = range.endedAt.getTime();
  const tStart = tournament.startedAt?.getTime();
  const tEnd = tournament.endedAt?.getTime();
  // No tournament range: nothing bounds it.
  if (tStart == null && tEnd == null) return true;
  // Overlap, or within the window of either end.
  if (tStart != null && tEnd != null && clusterEnd >= tStart && clusterStart <= tEnd) return true;
  if (tStart != null && Math.abs(clusterStart - tStart) <= WINDOW_MS) return true;
  if (tStart != null && Math.abs(clusterEnd - tStart) <= WINDOW_MS) return true;
  if (tEnd != null && Math.abs(clusterStart - tEnd) <= WINDOW_MS) return true;
  if (tEnd != null && Math.abs(clusterEnd - tEnd) <= WINDOW_MS) return true;
  return false;
}

/** The earlier of two starts; a null existing start is replaced by the new one. */
function mergeStart(existing: Date | null, incoming: Date | null): Date | null {
  if (incoming == null) return existing;
  if (existing == null) return incoming;
  return existing.getTime() <= incoming.getTime() ? existing : incoming;
}

/** The later of two ends; a null existing end is replaced by the new one. */
function mergeEnd(existing: Date | null, incoming: Date | null): Date | null {
  if (incoming == null) return existing;
  if (existing == null) return incoming;
  return existing.getTime() >= incoming.getTime() ? existing : incoming;
}
