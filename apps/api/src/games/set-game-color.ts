/**
 * The endpoint a player uses to say which side of the board they were on.
 *
 * The importer leaves the colour unset when the player's name matched both tags
 * or neither, because a guessed colour shows a player an analysis of their
 * opponent. This is the only way that game stops being undecided, and colour is
 * the only field it accepts: everything else on a game is what the PGN said.
 *
 * Ownership runs through the player rather than the game, so a game is
 * reachable only by the account that owns the player it belongs to. Absence and
 * refusal are answered apart — 404 for a game that does not exist, 403 for one
 * that is not the caller's — because the ids are UUIDs, so a 404 for another
 * account's game would tell the caller nothing they could act on anyway.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { setGameColor } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, player } from '../db/schema.ts';
import { readSession } from '../session.ts';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * A stored row in the contract's `GameSummary` shape.
 *
 * ponytail: this belongs beside the list handler, and ST-005 is the story that
 * writes one. Two callers is when it moves; one caller is when it stays here.
 */
function toGameSummary(row: typeof game.$inferSelect) {
  return {
    id: row.id,
    stream: row.stream,
    source: row.source,
    playerColor: row.playerColor,
    result: row.result,
    playedAt: row.playedAt?.toISOString() ?? null,
    event: row.event,
    round: row.round,
    board: row.board,
    whiteName: row.whiteName,
    blackName: row.blackName,
    whiteElo: row.whiteElo,
    blackElo: row.blackElo,
    eco: row.eco,
    opening: row.opening,
    moveCount: row.moveCount,
    hasClockData: row.hasClockData,
    analysisStatus: row.analysisStatus,
    analyzedAt: row.analyzedAt?.toISOString() ?? null,
  };
}

export function mountSetGameColor(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(setGameColor, async (c) => {
    const { gameId } = c.req.valid('param');
    const { playerColor } = c.req.valid('json');

    const session = readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    // ponytail: the third copy of an ownership check is the one worth
    // extracting. ST-005 writes it, and this one joins through the player
    // rather than reading it directly, so a shared helper now would have one
    // shape and two exceptions.
    const owner = await deps.db
      .select({ ownerUserId: player.ownerUserId })
      .from(game)
      .innerJoin(player, eq(game.playerId, player.id))
      .where(eq(game.id, gameId));
    if (owner.length === 0) {
      return c.json({ code: 'not_found', message: 'No such game.' }, 404);
    }
    if (owner[0].ownerUserId !== session.userId) {
      return c.json({ code: 'forbidden', message: 'Not your game.' }, 403);
    }

    const [updated] = await deps.db
      .update(game)
      .set({ playerColor })
      .where(eq(game.id, gameId))
      .returning();

    return c.json(toGameSummary(updated), 200);
  });
}
