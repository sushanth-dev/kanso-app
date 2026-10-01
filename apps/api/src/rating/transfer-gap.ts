/**
 * ST-018. The online-to-over-the-board transfer gap.
 *
 * The endpoint fetches, snapshots, and reports. A view fetches only when there
 * is no snapshot or it is older than the TTL, and `refresh=true` is the
 * deliberate second fetch, so viewing twice does not hit Chess.com or Lichess
 * twice. The player is resolved from the session, so there is no id to
 * enumerate.
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
import { getOwnPlayerId } from '../players/claim.ts';
import { RATING_REFRESH_FLOOR_MS, RATING_TTL_SECONDS } from './constants.ts';
import type { RatingFetcher } from './rating-fetcher.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountTransferGap(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; ratingFetcher: RatingFetcher },
): void {
  app.openapi(getTransferGap, async (c) => {
    const { refresh } = c.req.valid('query');

    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const [row] = await deps.db.select().from(player).where(eq(player.id, playerId)).limit(1);
    // `getOwnPlayerId` just resolved this id, so the row exists.
    const current = row!;

    const hasUsername = current.chesscomUsername !== null || current.lichessUsername !== null;
    const stale =
      current.ratingFetchedAt === null ||
      Date.now() - current.ratingFetchedAt.getTime() > RATING_TTL_SECONDS * 1000;

    let chesscomRating = current.chesscomRating;
    let lichessRating = current.lichessRating;

    // An explicit refresh is throttled: a re-click younger than the floor is
    // served from the snapshot, so the platforms are not hammered on demand.
    const lastFetchMs = current.ratingFetchedAt?.getTime() ?? 0;
    const refreshTooSoon =
      refresh === 'true' && lastFetchMs !== 0 && Date.now() - lastFetchMs < RATING_REFRESH_FLOOR_MS;

    if (hasUsername && (refresh === 'true' || stale) && !refreshTooSoon) {
      const [fetchedChesscom, fetchedLichess] = await Promise.all([
        current.chesscomUsername ? deps.ratingFetcher.chesscom(current.chesscomUsername) : null,
        current.lichessUsername ? deps.ratingFetcher.lichess(current.lichessUsername) : null,
      ]);
      // A fetch that fails is null, but null must not erase a good stored
      // snapshot: keep the older rating on the row and in the report, and
      // refresh the snapshot time only so an outage does not make the next
      // view hammer the upstream. The next explicit refresh retries.
      chesscomRating = fetchedChesscom ?? current.chesscomRating;
      lichessRating = fetchedLichess ?? current.lichessRating;
      await deps.db
        .update(player)
        .set({
          chesscomRating,
          lichessRating,
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
