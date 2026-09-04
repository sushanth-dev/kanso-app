/**
 * ST-106. The drill routes: assemble a weakness group's 20-puzzle set, and
 * record a completed drill on one pool puzzle.
 *
 * The GET is the prototype's resolve-to-training hop with the wait removed:
 * the pool is local, so the set is one indexed query and the drill can start
 * the moment the route answers. The POST is record-practice's shape carried
 * over: one completed drill is the event the client records, `solved` is
 * sticky, and a solved drill is the day's activity - the same ST-103 rule,
 * unchanged, so the streak keeps counting work rather than pages. The kind
 * and group ride the attempt row (first group to drill a puzzle claims it),
 * which is what lets the report show what a weakness group has been drilled
 * with from one indexed read.
 *
 * Ownership runs through the player the way set-game-color does: the session
 * names the account, the account owns one player, and every query filters on
 * that player. The group must be one the theme map knows, so a client cannot
 * invent groups; the puzzle must exist in the pool, which the foreign key
 * also enforces.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  getPracticePuzzles,
  getPracticeQueue,
  getPracticeReviews,
  recordPracticePuzzle,
} from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { player } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { assembleDrill } from './assemble.ts';
import { readDueReviews, readQueue } from './queue.ts';
import { recordDrill } from './record.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** The signed-in caller's player id, or null for a session with no player. */
async function ownPlayerId(
  db: Db,
  getSession: (c: Context) => unknown,
  c: Context,
): Promise<string | null> {
  const session = await readSession(getSession, c);
  if (session === null) return null;
  const [row] = await db
    .select({ id: player.id })
    .from(player)
    .where(eq(player.ownerUserId, session.userId))
    .limit(1);
  return row?.id ?? null;
}

export function mountPractice(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getPracticePuzzles, async (c) => {
    const { kind, group } = c.req.valid('query');

    const playerId = await ownPlayerId(deps.db, deps.getSession, c);
    if (playerId === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const set = await assembleDrill(deps.db, playerId, kind, group);
    if (set === 'no_such_group') {
      return c.json(
        { code: 'no_such_group', message: 'That weakness group has no puzzle drill.' },
        422,
      );
    }
    if (set === 'pool_empty') {
      return c.json(
        {
          code: 'pool_empty',
          message: 'The puzzle pool cannot supply a drill yet. Run the puzzle import.',
        },
        503,
      );
    }
    return c.json(set, 200);
  });

  app.openapi(getPracticeQueue, async (c) => {
    const playerId = await ownPlayerId(deps.db, deps.getSession, c);
    if (playerId === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const queue = await readQueue(deps.db, playerId);
    return c.json(
      {
        due: queue.due.map((r) => ({ ...r, nextReviewAt: r.nextReviewAt.toISOString() })),
        upcoming: queue.upcoming.map((r) => ({
          ...r,
          nextReviewAt: r.nextReviewAt.toISOString(),
        })),
        mastered: queue.mastered.map((r) => ({
          ...r,
          nextReviewAt: r.nextReviewAt.toISOString(),
        })),
      },
      200,
    );
  });

  app.openapi(getPracticeReviews, async (c) => {
    const playerId = await ownPlayerId(deps.db, deps.getSession, c);
    if (playerId === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    return c.json(await readDueReviews(deps.db, playerId), 200);
  });

  app.openapi(recordPracticePuzzle, async (c) => {
    const { puzzleId, kind, group, solved } = c.req.valid('json');

    const playerId = await ownPlayerId(deps.db, deps.getSession, c);
    if (playerId === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const outcome = await recordDrill(deps.db, playerId, puzzleId, kind, group, solved);
    if (outcome === 'no_such_puzzle') {
      return c.json({ code: 'no_such_puzzle', message: 'No such puzzle in the pool.' }, 422);
    }
    if (outcome === 'no_such_group') {
      return c.json(
        { code: 'no_such_group', message: 'That weakness group has no puzzle drill.' },
        422,
      );
    }
    return c.json(
      {
        attempts: outcome.attempts,
        solved: outcome.solved,
        reviewLevel: outcome.reviewLevel,
        nextReviewAt: outcome.nextReviewAt.toISOString(),
      },
      200,
    );
  });
}
