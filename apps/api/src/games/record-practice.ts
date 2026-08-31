/**
 * ST-102. The endpoint that turns a report's named weakness into a record of
 * work done: one completed drill on a mistake, solved or revealed, lands here
 * and the report's evidence can then show what the player has already
 * practised (R8). `attempts` counts completed drills rather than raw wrong
 * moves because one drill is the event the client records — a player who
 * fat-fingers a move before the drill even starts has not attempted anything —
 * and `solved` is sticky (`or excluded.solved`), so a position solved once
 * stays solved even when a later attempt ended in a reveal.
 *
 * Ownership runs through the player rather than the game, exactly as
 * set-game-color does: absence and refusal are answered apart — 404 for a game
 * that does not exist, 403 for one that is not the caller's — because the ids
 * are UUIDs, so a 404 for another account's game would tell the caller nothing
 * they could act on anyway. The ply check is a semantic boundary, not a format
 * one: the shape of the body is a contract question (400), whether the ply is
 * one of this game's mistakes is a question about stored state (422, the code
 * every other semantic refusal here uses). No row is written for a ply the
 * ST-103: a solved drill is also the day's activity — `recordActivity` runs in
 * the same transaction, so practice joins the streak and XP loop on the same
 * terms as reviewing a game, and a reveal never pays.
 */
import type { Context } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { recordPractice } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, mistake, player, practiceAttempt } from '../db/schema.ts';
import { recordActivity } from '../players/activity.ts';
import { readSession } from '../session.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountRecordPractice(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(recordPractice, async (c) => {
    const { gameId } = c.req.valid('param');
    const { ply, solved } = c.req.valid('json');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    // No `.for('update')`: nothing else writes this table, so a plain read
    // inside the transaction orders the upsert without a lock nobody needs.
    const outcome = await deps.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ ownerUserId: player.ownerUserId, playerId: player.id })
        .from(game)
        .innerJoin(player, eq(game.playerId, player.id))
        .where(eq(game.id, gameId));
      if (owner === undefined) return { kind: 'not_found' as const };
      if (owner.ownerUserId !== session.userId) return { kind: 'forbidden' as const };
      const [classified] = await tx
        .select({ gameId: mistake.gameId })
        .from(mistake)
        .where(and(eq(mistake.gameId, gameId), eq(mistake.ply, ply)))
        .limit(1);
      if (classified === undefined) return { kind: 'not_a_mistake' as const };
      const [row] = await tx
        .insert(practiceAttempt)
        .values({ playerId: owner.playerId, gameId, ply, attempts: 1, solved })
        .onConflictDoUpdate({
          target: [practiceAttempt.playerId, practiceAttempt.gameId, practiceAttempt.ply],
          set: {
            attempts: sql`${practiceAttempt.attempts} + 1`,
            solved: sql`${practiceAttempt.solved} or excluded.solved`,
            lastAttemptAt: sql`now()`,
          },
        })
        .returning();
      // ST-103: a solved drill is the day's activity. Gated on this request
      // being a solve, so a reveal never pays, and inside the transaction so
      // an attempt that fails to record cannot either; the day-granular
      // compare-and-swap makes every repeat a no-op.
      if (solved) await recordActivity(tx, owner.playerId);
      return { kind: 'recorded' as const, row: row! };
    });

    if (outcome.kind === 'not_found') {
      return c.json({ code: 'not_found', message: 'No such game.' }, 404);
    }
    if (outcome.kind === 'forbidden') {
      return c.json({ code: 'forbidden', message: 'Not your game.' }, 403);
    }
    if (outcome.kind === 'not_a_mistake') {
      return c.json(
        {
          code: 'not_a_mistake',
          message: 'Practising a ply that is not one of this game’s mistakes is not recorded.',
        },
        422,
      );
    }

    return c.json(
      {
        gameId: outcome.row.gameId,
        ply: outcome.row.ply,
        attempts: outcome.row.attempts,
        solved: outcome.row.solved,
      },
      200,
    );
  });
}
