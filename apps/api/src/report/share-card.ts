/**
 * ST-127. The report's share card: the share act's fourth caller (ST-067).
 *
 * Create (POST), list (GET), and revoke (DELETE) mirror the game share's
 * management surface. The shared read (GET /shared/cards/{token}) is the one
 * unauthenticated route: it serves exactly the two fields the player chose to
 * share - the headline leak number and its weakness label, frozen at creation
 * - and nothing else on the account. The payload is two columns on the row,
 * so the card cannot grow into a profile by accident.
 */
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  createReportShareCard,
  getSharedReportCard,
  listReportShareCards,
  revokeReportShareCard,
} from '../contract/routes.ts';
import { SharedReportCard } from '../contract/schemas.ts';
import * as schema from '../db/schema.ts';
import { reportCardLink } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId, hasPlayerClaim } from '../players/claim.ts';
import { generateToken } from '../proof-sheet/compose.ts';
import { produceReport } from './report.ts';
import type { AiClient } from '../coaching/zai.ts';
import type { z } from 'zod';

const NO_CARD = {
  code: 'not_found',
  message: 'No such shared card, or it was revoked or has expired.',
} as const;

type Db = PostgresJsDatabase<typeof schema>;
const APP_ORIGIN_DEFAULT = 'http://localhost:3000';

function cardUrl(token: string): string {
  return `${process.env.APP_ORIGIN ?? APP_ORIGIN_DEFAULT}/shared/cards/${token}`;
}

export function mountReportShareCard(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; aiClient: AiClient | null },
): void {
  app.openapi(createReportShareCard, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const body = c.req.valid('json');
    const inTournament = body.tournamentId;
    // The same client the report endpoint carries, so a stale report
    // regenerates identically - a card creation must not strip the narrative
    // the report screen would have written.
    const produced = await produceReport(
      deps.db,
      deps.aiClient,
      playerId,
      body.stream,
      inTournament,
    );
    if (!produced.ok) {
      return c.json(produced.body, produced.status);
    }
    // Rank 1 is the headline: worst first is the report's own ordering.
    const headline = produced.report.weaknesses[0];
    if (headline === undefined) {
      return c.json(
        { code: 'not_found', message: 'No weakness to share in this report yet.' },
        404,
      );
    }

    const token = generateToken();
    const [created] = await deps.db
      .insert(reportCardLink)
      .values({
        createdByPlayerId: playerId,
        token,
        ratingLeak: headline.ratingLeak,
        label: headline.label,
        expiresAt: body.expiresAt !== undefined ? new Date(body.expiresAt) : null,
      })
      .returning();

    return c.json(
      {
        id: created!.id,
        token,
        url: cardUrl(token),
        createdAt: created!.createdAt.toISOString(),
        revokedAt: null,
        expiresAt: created!.expiresAt?.toISOString() ?? null,
        ratingLeak: created!.ratingLeak,
        label: created!.label,
      },
      201,
    );
  });

  app.openapi(listReportShareCards, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }
    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    // Live links only: revoked and expired ones are gone, so an empty list is
    // the honest "none".
    const cards = await deps.db
      .select()
      .from(reportCardLink)
      .where(
        and(
          eq(reportCardLink.createdByPlayerId, playerId),
          isNull(reportCardLink.revokedAt),
          or(isNull(reportCardLink.expiresAt), gt(reportCardLink.expiresAt, new Date())),
        ),
      )
      .orderBy(desc(reportCardLink.createdAt));

    return c.json(
      cards.map((card) => ({
        id: card.id,
        token: card.token,
        url: cardUrl(card.token),
        createdAt: card.createdAt.toISOString(),
        revokedAt: null,
        expiresAt: card.expiresAt?.toISOString() ?? null,
        ratingLeak: card.ratingLeak,
        label: card.label,
      })),
      200,
    );
  });

  app.openapi(getSharedReportCard, async (c) => {
    const { token } = c.req.valid('param');
    const [card] = await deps.db
      .select()
      .from(reportCardLink)
      .where(eq(reportCardLink.token, token))
      .limit(1);
    if (
      !card ||
      card.revokedAt !== null ||
      (card.expiresAt !== null && card.expiresAt.getTime() <= Date.now())
    ) {
      return c.json(NO_CARD, 404);
    }

    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        ratingLeak: card.ratingLeak,
        label: card.label,
      } satisfies z.infer<typeof SharedReportCard>,
      200,
    );
  });
  app.openapi(revokeReportShareCard, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'No session.' }, 401);
    }

    const { shareLinkId } = c.req.valid('param');
    const [row] = await deps.db
      .select({
        id: reportCardLink.id,
        createdByPlayerId: reportCardLink.createdByPlayerId,
      })
      .from(reportCardLink)
      .where(eq(reportCardLink.id, shareLinkId))
      .limit(1);
    if (!row) {
      return c.json({ code: 'not_found', message: 'No such share card.' }, 404);
    }

    if (!(await hasPlayerClaim(deps.db, session.userId, row.createdByPlayerId))) {
      return c.json({ code: 'forbidden', message: 'Not your share card.' }, 403);
    }

    await deps.db
      .update(reportCardLink)
      .set({ revokedAt: new Date() })
      .where(eq(reportCardLink.id, shareLinkId));

    return c.body(null, 204);
  });
}
