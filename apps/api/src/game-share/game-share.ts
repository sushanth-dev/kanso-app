/**
 * ST-118. The game share link handlers: the share act's third caller (ST-067).
 *
 * Create (POST), list (GET), and revoke (DELETE) mirror the assignment's
 * management surface, scoped to one game. The shared read
 * (GET /shared/games/{token}) is the one unauthenticated route: it serves
 * exactly one reviewed game - the plies with their evaluations and best moves,
 * the mistakes with their cost - and nothing else on the account. The coach
 * explanation is omitted at the mapper, so sharing never spends a budget unit
 * and no generated prose leaves the account.
 */
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import {
  createGameShareLink,
  getSharedGame,
  listGameShareLinks,
  revokeGameShareLink,
} from '../contract/routes.ts';
import { SharedGame } from '../contract/schemas.ts';
import * as schema from '../db/schema.ts';
import { game, gameShareLink, mistake, movePly } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { generateToken } from '../proof-sheet/compose.ts';
import { toMovePlyResponse, toMistakeResponse } from '../games/get-game.ts';
import { opponentEloOf } from '../analysis/severity.ts';

type Db = PostgresJsDatabase<typeof schema>;

const NO_LINK = {
  code: 'not_found',
  message: 'No such shared game, or it was revoked or has expired.',
} as const;
const APP_ORIGIN_DEFAULT = 'http://localhost:3000';

export function mountGameShare(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(createGameShareLink, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const { gameId } = c.req.valid('param');
    const [row] = await deps.db
      .select({ playerId: game.playerId })
      .from(game)
      .where(eq(game.id, gameId))
      .limit(1);
    if (row === undefined) {
      return c.json({ code: 'not_found', message: 'No such game.' }, 404);
    }
    if (!(await hasPlayerClaim(deps.db, session.userId, row.playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your game.' }, 403);
    }

    const body = c.req.valid('json');
    const token = generateToken();
    const url = `${process.env.APP_ORIGIN ?? APP_ORIGIN_DEFAULT}/shared/games/${token}`;
    const [created] = await deps.db
      .insert(gameShareLink)
      .values({
        createdByPlayerId: row.playerId,
        gameId,
        token,
        expiresAt: body.expiresAt !== undefined ? new Date(body.expiresAt) : null,
      })
      .returning();

    return c.json(
      {
        id: created!.id,
        token,
        url,
        createdAt: created!.createdAt.toISOString(),
        revokedAt: null,
        expiresAt: created!.expiresAt?.toISOString() ?? null,
      },
      201,
    );
  });

  app.openapi(listGameShareLinks, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const { gameId } = c.req.valid('param');
    const [row] = await deps.db
      .select({ playerId: game.playerId })
      .from(game)
      .where(eq(game.id, gameId))
      .limit(1);
    if (row === undefined) {
      return c.json({ code: 'not_found', message: 'No such game.' }, 404);
    }
    if (!(await hasPlayerClaim(deps.db, session.userId, row.playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your game.' }, 403);
    }

    // Live links only: revoked and expired ones are gone, so an empty list is
    // the honest "none".
    const links = await deps.db
      .select({
        id: gameShareLink.id,
        token: gameShareLink.token,
        createdAt: gameShareLink.createdAt,
        expiresAt: gameShareLink.expiresAt,
      })
      .from(gameShareLink)
      .where(
        and(
          eq(gameShareLink.gameId, gameId),
          isNull(gameShareLink.revokedAt),
          or(isNull(gameShareLink.expiresAt), gt(gameShareLink.expiresAt, new Date())),
        ),
      )
      .orderBy(desc(gameShareLink.createdAt));

    return c.json(
      links.map((link) => ({
        id: link.id,
        token: link.token,
        url: `${process.env.APP_ORIGIN ?? APP_ORIGIN_DEFAULT}/shared/games/${link.token}`,
        createdAt: link.createdAt.toISOString(),
        revokedAt: null,
        expiresAt: link.expiresAt?.toISOString() ?? null,
      })),
      200,
    );
  });

  app.openapi(getSharedGame, async (c) => {
    const { token } = c.req.valid('param');
    const [link] = await deps.db
      .select()
      .from(gameShareLink)
      .where(eq(gameShareLink.token, token))
      .limit(1);
    if (
      !link ||
      link.revokedAt !== null ||
      (link.expiresAt !== null && link.expiresAt.getTime() <= Date.now())
    ) {
      return c.json(NO_LINK, 404);
    }

    const [row] = await deps.db.select().from(game).where(eq(game.id, link.gameId)).limit(1);
    if (row === undefined) {
      // The foreign key makes this unreachable today; if it ever moves, the
      // honest answer is still the same 404, not a half-page.
      return c.json(NO_LINK, 404);
    }

    const [plies, mistakes] = await Promise.all([
      deps.db.select().from(movePly).where(eq(movePly.gameId, row.id)).orderBy(movePly.ply),
      deps.db.select().from(mistake).where(eq(mistake.gameId, row.id)).orderBy(mistake.ply),
    ]);

    c.header('Cache-Control', 'no-store');
    const opponentElo = opponentEloOf(row);
    return c.json(
      {
        whiteName: row.whiteName,
        blackName: row.blackName,
        result: row.result,
        playerColor: row.playerColor,
        plies: plies.map(toMovePlyResponse),
        mistakes: mistakes.map((row2) => {
          // ST-118. The coach explanation is generated prose on the account's
          // budget; the shared payload never carries it.
          const { explanation: _coachText, ...publicMistake } = toMistakeResponse(
            row2,
            opponentElo,
          );
          return publicMistake;
        }),
      } satisfies z.infer<typeof SharedGame>,
      200,
    );
  });

  app.openapi(revokeGameShareLink, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'No session.' }, 401);
    }

    const { gameId, shareLinkId } = c.req.valid('param');
    const [row] = await deps.db
      .select({
        id: gameShareLink.id,
        createdByPlayerId: gameShareLink.createdByPlayerId,
      })
      .from(gameShareLink)
      .where(and(eq(gameShareLink.id, shareLinkId), eq(gameShareLink.gameId, gameId)))
      .limit(1);
    if (!row) {
      return c.json({ code: 'not_found', message: 'No such share link.' }, 404);
    }

    if (!(await hasPlayerClaim(deps.db, session.userId, row.createdByPlayerId))) {
      return c.json({ code: 'forbidden', message: 'Not your share link.' }, 403);
    }

    await deps.db
      .update(gameShareLink)
      .set({ revokedAt: new Date() })
      .where(eq(gameShareLink.id, shareLinkId));

    return c.body(null, 204);
  });
}
