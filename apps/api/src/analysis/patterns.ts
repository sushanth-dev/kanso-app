/**
 * ST-150. The read side of verified retirement: `GET /patterns` answers every
 * weakness group the player has dealt in one stream, with where each stands.
 *
 * Four states are stored on `pattern_state` and read straight through. The
 * fifth, `not_yet_verifiable`, is derived at read time: a `candidate` whose
 * stream window (analysed games since `masteredAt`, the same filter
 * `applyRetirement` counts) is thinner than the verification floor is not a
 * promise the machine can keep yet, so the API says so rather than answering
 * with a stale stored word. Deriving it at read time means it can never drift
 * from the window.
 *
 * A came-back group names the game whose analysis triggered the relapse,
 * joined through `lastAlertGameId`, so the alert copy can say which game it
 * was.
 */
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getPatterns } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, patternState } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';
import { FOCUS_WINDOW_GAMES } from '../focus/verify.ts';
import { windowCount } from './retirement.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountPatterns(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getPatterns, async (c) => {
    const { stream } = c.req.valid('query');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const rows = await deps.db
      .select({
        kind: patternState.kind,
        groupKey: patternState.groupKey,
        label: patternState.label,
        state: patternState.state,
        masteredAt: patternState.masteredAt,
        retiredAt: patternState.retiredAt,
        cameBackAt: patternState.cameBackAt,
        lastAlertGameId: patternState.lastAlertGameId,
        alertPlayedAt: game.playedAt,
        alertWhiteName: game.whiteName,
        alertBlackName: game.blackName,
      })
      .from(patternState)
      .leftJoin(game, eq(game.id, patternState.lastAlertGameId))
      .where(and(eq(patternState.playerId, playerId), eq(patternState.stream, stream)));

    const patterns = await Promise.all(
      rows.map(async (row) => {
        const state: 'active' | 'candidate' | 'retired' | 'came_back' | 'not_yet_verifiable' =
          row.state === 'candidate' &&
          (await windowCount(deps.db, playerId, stream, row.masteredAt)) < FOCUS_WINDOW_GAMES
            ? 'not_yet_verifiable'
            : row.state;
        return {
          kind: row.kind,
          groupKey: row.groupKey,
          label: row.label,
          stream,
          state,
          masteredAt: row.masteredAt.toISOString(),
          retiredAt: row.retiredAt?.toISOString() ?? null,
          cameBackAt: row.cameBackAt?.toISOString() ?? null,
          lastAlertGame:
            row.lastAlertGameId === null
              ? null
              : {
                  gameId: row.lastAlertGameId,
                  playedAt: row.alertPlayedAt?.toISOString() ?? null,
                  whiteName: row.alertWhiteName,
                  blackName: row.alertBlackName,
                },
        };
      }),
    );

    return c.json({ playerId, stream, patterns }, 200);
  });
}
