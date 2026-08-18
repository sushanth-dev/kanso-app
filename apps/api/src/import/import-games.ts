/**
 * The game import endpoint: a PGN upload, or a Chess.com/Lichess username.
 *
 * The order here is the security assessment made real. The framework has
 * already validated the body shape (ADR-0008), including the 5,000,000-character
 * cap on an upload. This handler decides authorization before it parses or
 * fetches anything, so an unauthorized caller never makes the parser run or
 * an outbound call, and it writes the job and its games in one transaction so
 * a partial import cannot leave a job without its games.
 *
 * An upload rejects the whole file when any game is malformed (F2); a username
 * import rejects one malformed game and keeps the rest, because the player did
 * not assemble the provider's page.
 */
import type { Context } from 'hono';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { startImport } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, importJob, player } from '../db/schema.ts';
import { enqueueAnalysis } from '../analysis/queue.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { parseOne, parsePgn, type ParsedGame } from './parse-pgn.ts';
import { decidePlayerColor } from './player-color.ts';
import { attachGames } from '../tournaments/attach.ts';
import { readSession } from '../session.ts';
import type { GameFetcher } from './game-fetcher.ts';
import { ONLINE_IMPORT_DAILY_CAP_GAMES } from './game-fetch-constants.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** A parsed game plus the provider's own id, which only a username import has. */
export interface ImportGame extends ParsedGame {
  externalId: string | null;
}

export interface ImportGamesInput {
  playerId: string;
  source: 'chesscom' | 'lichess' | 'pgn_upload' | 'uscf';
  /** The provider account a username import reads; null for a PGN upload. */
  username: string | null;
  stream: 'tournament' | 'online';
  /** The name to match against `[White]`/`[Black]`: display name or username. */
  matchName: string;
  games: ImportGame[];
  /** Malformed games rejected at the parse boundary; `gamesFound` adds these to `games`. */
  gamesRejected: number;
}

export interface ImportGamesResult {
  /** The finished import job row, as the route returns it. */
  job: typeof importJob.$inferSelect;
  /** Game ids the route enqueues for analysis after commit. */
  queued: string[];
}

/**
 * The importer's write path (ST-011): store parsed games and attach
 * them to tournaments, in one transaction. The HTTP route calls this after
 * authorization, and it parses before the call; the dev-only seed calls it
 * directly, which is what lets the seed exercise the same `attachGames` as the
 * route rather than a copy of it.
 */
export async function importGames(db: Db, input: ImportGamesInput): Promise<ImportGamesResult> {
  const { playerId, source, username, stream, matchName, games, gamesRejected } = input;
  const queued: string[] = [];
  const { job } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(importJob)
      .values({
        playerId,
        source,
        kind: 'backfill',
        username,
        stream,
        status: 'complete',
        gamesFound: games.length + gamesRejected,
        gamesRejected,
        startedAt: new Date(),
        finishedAt: new Date(),
      })
      .returning({ id: importJob.id });

    // A provider game dedupes on its own id; an upload dedupes on the PGN hash.
    // The partial index needs its predicate in the target or PostgreSQL cannot
    // infer it.
    const conflictTarget =
      source === 'pgn_upload'
        ? { target: [game.playerId, game.pgnHash] }
        : {
            target: [game.playerId, game.source, game.externalId],
            where: sql`${game.externalId} is not null`,
          };

    const inserted =
      games.length === 0
        ? []
        : await tx
            .insert(game)
            .values(
              games.map((g) => ({
                playerId,
                importJobId: created!.id,
                stream,
                source,
                externalId: g.externalId,
                pgnHash: g.pgnHash,
                pgn: g.pgn,
                playerColor: decidePlayerColor(matchName, g.whiteName, g.blackName),
                result: g.result,
                playedAt: g.playedAt,
                moveCount: g.moveCount,
                event: g.event,
                site: g.site,
                round: g.round,
                board: g.board,
                whiteName: g.whiteName,
                blackName: g.blackName,
                whiteElo: g.whiteElo,
                blackElo: g.blackElo,
                eco: g.eco,
                opening: g.opening,
                timeControl: g.timeControl,
                hasClockData: g.hasClockData,
                analysisStatus: g.moveCount === 0 ? ('failed' as const) : ('pending' as const),
                analysisError: g.moveCount === 0 ? 'no moves' : null,
              })),
            )
            .onConflictDoNothing(conflictTarget)
            .returning({
              id: game.id,
              playerColor: game.playerColor,
              stream: game.stream,
              event: game.event,
              site: game.site,
              playedAt: game.playedAt,
              moveCount: game.moveCount,
            });

    const undetermined = inserted.filter((row) => row.playerColor === null).length;

    queued.push(
      ...inserted
        .filter((row) => row.playerColor !== null && (row.moveCount ?? 0) > 0)
        .map((row) => row.id),
    );

    await attachGames(
      tx,
      playerId,
      inserted.map((row) => ({
        id: row.id,
        stream: row.stream,
        event: row.event,
        site: row.site,
        playedAt: row.playedAt,
      })),
    );

    const [updated] = await tx
      .update(importJob)
      .set({ gamesImported: inserted.length, gamesUndetermined: undetermined })
      .where(eq(importJob.id, created!.id))
      .returning();

    return { job: updated! };
  });

  return { job, queued };
}

/**
 * The default username-import period: one rolling year, ST-023's stated choice.
 * A caller narrows it with `since`.
 */
const DEFAULT_PERIOD_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * DEBT-011. Games of one stream this player imported in the given rolling
 * window, summed from the jobs the import path already writes. Counts
 * `games_imported` rather than colour-known games, which slightly over-counts
 * undetermined games and errs conservative against the day's budget.
 */
async function countGamesImportedSince(
  db: Db,
  playerId: string,
  stream: 'online' | 'tournament',
  since: Date,
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${importJob.gamesImported}), 0)` })
    .from(importJob)
    .where(
      and(
        eq(importJob.playerId, playerId),
        eq(importJob.stream, stream),
        gte(importJob.createdAt, since),
      ),
    );
  return rows[0]?.total ?? 0;
}

export function mountImport(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; gameFetcher: GameFetcher },
): void {
  app.openapi(startImport, async (c) => {
    const { playerId } = c.req.valid('param');
    const body = c.req.valid('json');

    // Authorization before any work. The session is present (the guard proved
    // it); existence is this handler's 404; the claim is the 403, and it covers
    // owners and guardians, the same rule as every other player-scoped route.
    const session = await readSession(deps.getSession, c);
    if (session == null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const owner = await deps.db
      .select({ displayName: player.displayName })
      .from(player)
      .where(eq(player.id, playerId));
    if (owner.length === 0) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }
    if (!(await hasPlayerClaim(deps.db, session.userId, playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your player.' }, 403);
    }

    let job: typeof importJob.$inferSelect;
    let queued: string[];

    if (body.source === 'pgn_upload') {
      const parsed = parsePgn(body.pgn);
      if (!parsed.ok) {
        return c.json(
          {
            code: 'invalid_pgn',
            message: 'The upload contains a game that could not be parsed.',
            // ParseFault.index is 0-based; players count games from 1.
            issues: parsed.faults.map((f) => ({
              path: `game ${f.index + 1}`,
              message: f.reason,
            })),
          },
          400,
        );
      }

      ({ job, queued } = await importGames(deps.db, {
        playerId,
        source: 'pgn_upload',
        username: null,
        stream: body.stream,
        matchName: owner[0]!.displayName,
        games: parsed.games.map((g) => ({ ...g, externalId: null })),
        gamesRejected: 0,
      }));
    } else if (body.source === 'uscf') {
      // DEBT-011, counted on the tournament stream: a crosstable import is
      // bounded by the same daily allowance, so one request cannot pull a year
      // of a large event.
      const importedToday = await countGamesImportedSince(
        deps.db,
        playerId,
        'tournament',
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      );
      const remaining = ONLINE_IMPORT_DAILY_CAP_GAMES - importedToday;
      if (remaining <= 0) {
        return c.json(
          {
            code: 'daily_import_cap',
            message: 'Daily tournament import cap reached. Try again tomorrow.',
          },
          429,
        );
      }

      const outcome = await deps.gameFetcher.uscf(body.tournamentName, body.playerName, remaining);

      if (!outcome.ok) {
        if (outcome.code === 'tournament_not_found') {
          return c.json(
            { code: 'tournament_not_found', message: 'No USCF tournament found by that name.' },
            422,
          );
        }
        if (outcome.code === 'name_mismatch') {
          return c.json(
            {
              code: 'name_mismatch',
              message: outcome.detail ?? 'No matching player name in that tournament.',
            },
            422,
          );
        }
        return c.json(
          { code: 'upstream_error', message: 'USCF is unreachable; try again later.' },
          502,
        );
      }

      // A crosstable is results, not game scores: each round is a header-only
      // PGN the same `parseOne` boundary parses, and the zero-move games are
      // stored without analysis.
      const games: ImportGame[] = [];
      let gamesRejected = 0;
      outcome.games.forEach((providerGame, index) => {
        const parsed = parseOne(providerGame.pgn, index);
        if ('reason' in parsed) {
          gamesRejected += 1;
          return;
        }
        games.push({ ...parsed, externalId: providerGame.externalId });
      });

      ({ job, queued } = await importGames(deps.db, {
        playerId,
        source: 'uscf',
        username: null,
        stream: 'tournament',
        matchName: body.playerName,
        games,
        gamesRejected,
      }));
    } else {
      const username = body.username;
      const since = body.since ? new Date(body.since) : new Date(Date.now() - DEFAULT_PERIOD_MS);
      const providerName = body.source === 'chesscom' ? 'Chess.com' : 'Lichess';

      // DEBT-011. A username import is bounded by the day's remaining online
      // allowance, so one request can never fetch a year of a 14,000-game
      // account. The counter reads the jobs this import path already writes.
      const importedToday = await countGamesImportedSince(
        deps.db,
        playerId,
        'online',
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      );
      const remaining = ONLINE_IMPORT_DAILY_CAP_GAMES - importedToday;
      if (remaining <= 0) {
        return c.json(
          {
            code: 'daily_import_cap',
            message: 'Daily online import cap reached. Try again tomorrow.',
          },
          429,
        );
      }

      const outcome =
        body.source === 'chesscom'
          ? await deps.gameFetcher.chesscom(username, since, remaining)
          : await deps.gameFetcher.lichess(username, since, remaining);

      if (!outcome.ok) {
        if (outcome.code === 'username_not_found') {
          return c.json(
            { code: 'username_not_found', message: `No ${providerName} account by that username.` },
            422,
          );
        }
        return c.json(
          { code: 'upstream_error', message: `${providerName} is unreachable; try again later.` },
          502,
        );
      }

      // A provider page the player did not assemble can carry one game the
      // parser dislikes among hundreds; reject that one and keep the rest. The
      // boundary is the same `parseOne` an upload runs through, only the batch
      // handling differs.
      const games: ImportGame[] = [];
      let gamesRejected = 0;
      outcome.games.forEach((providerGame, index) => {
        const parsed = parseOne(providerGame.pgn, index);
        if ('reason' in parsed) {
          gamesRejected += 1;
          return;
        }
        games.push({ ...parsed, externalId: providerGame.externalId });
      });

      ({ job, queued } = await importGames(deps.db, {
        playerId,
        source: body.source,
        username,
        stream: 'online',
        matchName: username,
        games,
        gamesRejected,
      }));
    }

    // After the commit, never inside it. A message pointing at a game the
    // transaction went on to roll back is a job that fails forever, and a queue
    // send inside a database transaction is the usual way to write one.
    //
    // A queue that is down does not fail the import: the games are stored, and
    // they keep `analysis_status = 'pending'`, which is a state someone can see
    // and re-queue. Failing the import would instead ask the player to re-send
    // games that are already safely in the database.
    try {
      await enqueueAnalysis(queued);
    } catch (error) {
      console.error('import stored its games but could not queue them for analysis', error);
    }

    return c.json(
      {
        id: job.id,
        playerId: job.playerId,
        source: job.source,
        kind: job.kind,
        stream: job.stream,
        status: job.status,
        gamesFound: job.gamesFound,
        gamesImported: job.gamesImported,
        gamesRejected: job.gamesRejected,
        gamesUndetermined: job.gamesUndetermined,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
        finishedAt: job.finishedAt?.toISOString() ?? null,
      },
      202,
    );
  });
}
