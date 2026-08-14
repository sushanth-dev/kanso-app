/**
 * ST-018. The online-to-over-the-board transfer gap.
 *
 * The endpoint fetches, snapshots, and reports. A view fetches only when there
 * is no snapshot or it is older than the TTL, and `refresh=true` is the
 * deliberate second fetch, so viewing twice does not hit Chess.com or Lichess
 * twice. Absence and refusal both answer 403, the same rule as every other
 * player-scoped route, so a player id cannot be enumerated.
 *
 * The over-the-board baseline is FIDE when present, else USCF. Each online gap
 * is `online - overTheBoard`, null when either side is unknown. A failed fetch
 * is null, never zero, so the database cannot mistake a failure for a real
 * rating.
 */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getTransferGap } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { player } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { RATING_TTL_SECONDS } from './constants.ts';
import type { RatingFetcher } from './rating-fetcher.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountTransferGap(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; ratingFetcher: RatingFetcher },
): void {
  app.openapi(getTransferGap, async (c) => {
    const { playerId } = c.req.valid('param');
    const { refresh } = c.req.valid('query');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    if (!(await hasPlayerClaim(deps.db, session.userId, playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your player.' }, 403);
    }

    const [row] = await deps.db.select().from(player).where(eq(player.id, playerId)).limit(1);
    // `hasPlayerClaim` just loaded this row, so it exists.
    const current = row!;

    const hasUsername = current.chesscomUsername !== null || current.lichessUsername !== null;
    const stale =
      current.ratingFetchedAt === null ||
      Date.now() - current.ratingFetchedAt.getTime() > RATING_TTL_SECONDS * 1000;

    let chesscomRating = current.chesscomRating;
    let lichessRating = current.lichessRating;

    if (hasUsername && (refresh === 'true' || stale)) {
      const [fetchedChesscom, fetchedLichess] = await Promise.all([
        current.chesscomUsername ? deps.ratingFetcher.chesscom(current.chesscomUsername) : null,
        current.lichessUsername ? deps.ratingFetcher.lichess(current.lichessUsername) : null,
      ]);
      chesscomRating = fetchedChesscom;
      lichessRating = fetchedLichess;
      await deps.db
        .update(player)
        .set({
          chesscomRating: fetchedChesscom,
          lichessRating: fetchedLichess,
          ratingFetchedAt: new Date(),
        })
        .where(eq(player.id, playerId));
    }

    const overTheBoardRating = current.fideRating ?? current.uscfRating;

    return c.json(
      {
        playerId,
        overTheBoardRating,
        chesscom: {
          rating: chesscomRating,
          gap:
            chesscomRating === null || overTheBoardRating === null
              ? null
              : chesscomRating - overTheBoardRating,
        },
        lichess: {
          rating: lichessRating,
          gap:
            lichessRating === null || overTheBoardRating === null
              ? null
              : lichessRating - overTheBoardRating,
        },
      },
      200,
    );
  });
}
