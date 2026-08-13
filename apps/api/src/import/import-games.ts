/**
 * The PGN upload import endpoint.
 *
 * The order here is the security assessment made real. The framework has
 * already validated the body shape and the 5,000,000-character cap by the time
 * this runs (ADR-0008). This handler then decides authorization before it
 * parses anything, so an unauthorized caller never makes the parser run, and
 * writes the job and its games in one transaction so a partial file cannot
 * leave a job without its games. Malformed input is a 400 naming the game;
 * nothing is stored on a rejected upload (F2).
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { startImport } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, importJob, player } from '../db/schema.ts';
import { enqueueAnalysis } from '../analysis/queue.ts';
import { parsePgn, type ParsedGame } from './parse-pgn.ts';
import { decidePlayerColor } from './player-color.ts';
import { attachGames } from '../tournaments/attach.ts';
import { readSession } from '../session.ts';

type Db = PostgresJsDatabase<typeof schema>;

export interface ImportGamesInput {
  playerId: string;
  stream: 'tournament' | 'online';
  displayName: string;
  games: ParsedGame[];
}

export interface ImportGamesResult {
  /** The finished import job row, as the route returns it. */
  job: typeof importJob.$inferSelect;
  /** Game ids the route enqueues for analysis after commit. */
  queued: string[];
}

/**
 * The importer's write path (ST-011): store a parsed PGN's games and attach
 * them to tournaments, in one transaction. The HTTP route calls this after
 * authorization, and it parses before the call; the dev-only seed calls it
 * directly, which is what lets the seed exercise the same `attachGames` as the
 * route rather than a copy of it.
 */
export async function importGames(db: Db, input: ImportGamesInput): Promise<ImportGamesResult> {
  const { playerId, stream, displayName, games } = input;
  const queued: string[] = [];
  const { job } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(importJob)
      .values({
        playerId,
        source: 'pgn_upload',
        kind: 'backfill',
        stream,
        status: 'complete',
        gamesFound: games.length,
        startedAt: new Date(),
        finishedAt: new Date(),
      })
      .returning({ id: importJob.id });

    const inserted = await tx
      .insert(game)
      .values(
        games.map((g) => ({
          playerId,
          importJobId: created.id,
          stream,
          source: 'pgn_upload' as const,
          pgnHash: g.pgnHash,
          pgn: g.pgn,
          playerColor: decidePlayerColor(displayName, g.whiteName, g.blackName),
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
        })),
      )
      .onConflictDoNothing({ target: [game.playerId, game.pgnHash] })
      .returning({
        id: game.id,
        playerColor: game.playerColor,
        stream: game.stream,
        event: game.event,
        site: game.site,
        playedAt: game.playedAt,
      });

    const undetermined = inserted.filter((row) => row.playerColor === null).length;

    queued.push(...inserted.filter((row) => row.playerColor !== null).map((row) => row.id));

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
      .where(eq(importJob.id, created.id))
      .returning();

    return { job: updated };
  });

  return { job, queued };
}

export function mountImport(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(startImport, async (c) => {
    const { playerId } = c.req.valid('param');
    const body = c.req.valid('json');

    // Backlog item 6. A source is added by adding a source, not by reworking
    // the endpoint.
    if (body.source !== 'pgn_upload') {
      return c.json(
        {
          code: 'not_implemented',
          message: 'Username import is not built yet; upload a PGN.',
        },
        501,
      );
    }

    // Authorization before parsing. The session is present (the guard proved
    // it); ownership is this handler's to check.
    const session = await readSession(deps.getSession, c);
    if (session == null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const owner = await deps.db
      .select({
        ownerUserId: player.ownerUserId,
        displayName: player.displayName,
      })
      .from(player)
      .where(eq(player.id, playerId));
    if (owner.length === 0) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }
    if (owner[0].ownerUserId !== session.userId) {
      return c.json({ code: 'forbidden', message: 'Not your player.' }, 403);
    }

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

    const { job, queued } = await importGames(deps.db, {
      playerId,
      stream: body.stream,
      displayName: owner[0].displayName,
      games: parsed.games,
    });

    // After the commit, never inside it. A message pointing at a game the
    // transaction went on to roll back is a job that fails forever, and a queue
    // send inside a database transaction is the usual way to write one.
    //
    // A queue that is down does not fail the import: the games are stored, and
    // they keep `analysis_status = 'pending'`, which is a state someone can see
    // and re-queue. Failing the upload would instead ask the player to re-send
    // a file that is already safely in the database.
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
