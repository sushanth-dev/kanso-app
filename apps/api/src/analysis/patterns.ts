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
 *
 * ST-152. Each row also carries its balance: the instances the current
 * window holds and the half-points they cost, with the window's size. The
 * figures come from `windowBalance`, whose instance definitions are the
 * leak's, so the board and the report can never disagree about what an
 * instance is. `relapses` is the row's relapse count - the history that
 * survives a re-mastery, which only rewrites `masteredAt`.
 */
import type { Context } from 'hono';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getPatterns } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly, patternState } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId } from '../players/claim.ts';
import { FOCUS_WINDOW_GAMES } from '../focus/verify.ts';
import { TROUBLE_CLOCK_MS } from '../phases/phases.ts';
import type { WeaknessKind } from './leak.ts';
import { windowGameIds } from './retirement.ts';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * The group's balance across the window games: how many instances of the
 * group they carry and what those instances cost in half-points. The
 * definitions are the leak's - a mistake is an instance for its motif or
 * phase, an opening group counts the mistakes in its ECO games, and time
 * trouble counts the mistakes played at or under the trouble clock - scoped
 * to the window games the caller already filtered.
 */
export async function windowBalance(
  db: Db,
  kind: WeaknessKind,
  groupKey: string,
  gameIds: string[],
): Promise<{ instances: number; cost: number }> {
  if (gameIds.length === 0) return { instances: 0, cost: 0 };
  const figures = {
    instances: sql<number>`count(${mistake.id})::int`,
    cost: sql<number>`coalesce(sum(${mistake.halfPointsLost}), 0)::float8`,
  };
  if (kind === 'time_trouble') {
    const [row] = await db
      .select(figures)
      .from(mistake)
      .innerJoin(movePly, and(eq(movePly.gameId, mistake.gameId), eq(movePly.ply, mistake.ply)))
      .where(and(inArray(mistake.gameId, gameIds), lte(movePly.clockMs, TROUBLE_CLOCK_MS)));
    return { instances: row?.instances ?? 0, cost: row?.cost ?? 0 };
  }
  const groupFilter =
    kind === 'motif'
      ? eq(mistake.motif, groupKey)
      : kind === 'phase'
        ? // The row's groupKey is a stored phase name; a parameterized
          // comparison answers it without casting the column's type.
          sql`${mistake.phase} = ${groupKey}`
        : eq(game.eco, groupKey);
  const [row] = await db
    .select(figures)
    .from(mistake)
    .innerJoin(game, eq(mistake.gameId, game.id))
    .where(and(inArray(mistake.gameId, gameIds), groupFilter));
  return { instances: row?.instances ?? 0, cost: row?.cost ?? 0 };
}

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
        relapses: patternState.relapses,
      })
      .from(patternState)
      .leftJoin(game, eq(game.id, patternState.lastAlertGameId))
      .where(and(eq(patternState.playerId, playerId), eq(patternState.stream, stream)));

    const patterns = await Promise.all(
      rows.map(async (row) => {
        const windowIds = await windowGameIds(deps.db, playerId, stream, row.masteredAt);
        const state: 'active' | 'candidate' | 'retired' | 'came_back' | 'not_yet_verifiable' =
          row.state === 'candidate' && windowIds.length < FOCUS_WINDOW_GAMES
            ? 'not_yet_verifiable'
            : row.state;
        const balance = await windowBalance(deps.db, row.kind, row.groupKey, windowIds);
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
          windowGames: windowIds.length,
          windowInstances: balance.instances,
          windowCost: balance.cost,
          relapses: row.relapses,
        };
      }),
    );

    return c.json({ playerId, stream, verificationFloor: FOCUS_WINDOW_GAMES, patterns }, 200);
  });
}
