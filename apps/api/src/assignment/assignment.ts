/**
 * ST-117. The assignment link handlers: the share act's second caller (ST-067).
 *
 * Create (POST), list (GET), and revoke (DELETE) mirror the proof sheet's
 * management surface. The shared read (GET /shared/assignments/{token}) is the
 * one unauthenticated route: it resolves the catalogue focus live and serves
 * the payload and nothing else. Confirm (POST .../confirm) is the act that
 * needs the player's session, and it writes the focus through the same path
 * PUT /focus uses, so an unmeasurable instruction lands paired with a
 * measurable focus and never stands alone.
 */
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  confirmAssignment,
  createAssignmentLink,
  getSharedAssignment,
  listAssignmentLinks,
  revokeAssignmentLink,
} from '../contract/routes.ts';
import { SharedAssignment } from '../contract/schemas.ts';
import { z } from '@hono/zod-openapi';
import * as schema from '../db/schema.ts';
import { assignmentLink, focusCatalogue } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId, hasPlayerClaim } from '../players/claim.ts';
import { setFocusForPlayer } from '../focus/set-focus.ts';
import { generateToken } from '../proof-sheet/compose.ts';

type Db = PostgresJsDatabase<typeof schema>;

const NO_LINK = {
  code: 'not_found',
  message: 'No such assignment, or it was revoked or has expired.',
} as const;
const APP_ORIGIN_DEFAULT = 'http://localhost:3000';

export function mountAssignments(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(createAssignmentLink, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const body = c.req.valid('json');
    const [catalogue] = await deps.db
      .select()
      .from(focusCatalogue)
      .where(and(eq(focusCatalogue.key, body.catalogueKey), isNull(focusCatalogue.retiredAt)))
      .limit(1);
    if (!catalogue) {
      return c.json({ code: 'not_found', message: 'No such catalogue key.' }, 404);
    }

    const token = generateToken();
    const url = `${process.env.APP_ORIGIN ?? APP_ORIGIN_DEFAULT}/shared/assignments/${token}`;
    const [created] = await deps.db
      .insert(assignmentLink)
      .values({
        createdByPlayerId: playerId,
        catalogueId: catalogue.id,
        instruction: body.instruction,
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

  app.openapi(listAssignmentLinks, async (c) => {
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
    const now = new Date();
    const rows = await deps.db
      .select({
        id: assignmentLink.id,
        token: assignmentLink.token,
        createdAt: assignmentLink.createdAt,
        expiresAt: assignmentLink.expiresAt,
      })
      .from(assignmentLink)
      .where(
        and(
          eq(assignmentLink.createdByPlayerId, playerId),
          isNull(assignmentLink.revokedAt),
          or(isNull(assignmentLink.expiresAt), gt(assignmentLink.expiresAt, now)),
        ),
      )
      .orderBy(desc(assignmentLink.createdAt));

    return c.json(
      rows.map((row) => ({
        id: row.id,
        token: row.token,
        url: `${process.env.APP_ORIGIN ?? APP_ORIGIN_DEFAULT}/shared/assignments/${row.token}`,
        createdAt: row.createdAt.toISOString(),
        revokedAt: null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      })),
      200,
    );
  });

  app.openapi(getSharedAssignment, async (c) => {
    const { token } = c.req.valid('param');
    const [row] = await deps.db
      .select()
      .from(assignmentLink)
      .where(eq(assignmentLink.token, token))
      .limit(1);
    if (
      !row ||
      row.revokedAt !== null ||
      (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now())
    ) {
      return c.json(NO_LINK, 404);
    }

    const [catalogue] = await deps.db
      .select()
      .from(focusCatalogue)
      .where(eq(focusCatalogue.id, row.catalogueId))
      .limit(1);
    if (!catalogue) {
      // The foreign key makes this unreachable today; if it ever moves, the
      // honest answer is still the same 404, not a half-page.
      return c.json(NO_LINK, 404);
    }

    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        focusTitle: catalogue.title,
        focusDescription: catalogue.description,
        instruction: row.instruction,
      } satisfies z.infer<typeof SharedAssignment>,
      200,
    );
  });

  app.openapi(confirmAssignment, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const { token } = c.req.valid('param');
    const [row] = await deps.db
      .select()
      .from(assignmentLink)
      .where(eq(assignmentLink.token, token))
      .limit(1);
    if (
      !row ||
      row.revokedAt !== null ||
      (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now())
    ) {
      return c.json(NO_LINK, 404);
    }

    const [catalogue] = await deps.db
      .select()
      .from(focusCatalogue)
      .where(and(eq(focusCatalogue.id, row.catalogueId), isNull(focusCatalogue.retiredAt)))
      .limit(1);
    if (!catalogue) {
      return c.json(
        { code: 'not_found', message: 'The focus this link names is no longer available.' },
        404,
      );
    }

    // The F13 coach branch: the instruction verbatim, paired with the link's
    // catalogue focus, never standing alone as the active focus.
    const result = await setFocusForPlayer(deps.db, playerId, {
      source: 'coach',
      coachInstruction: row.instruction,
      pairedCatalogueKey: catalogue.key,
    });
    if (!result.ok) {
      return c.json(
        { code: 'not_found', message: 'The focus this link names is no longer available.' },
        404,
      );
    }

    return c.body(null, 204);
  });

  app.openapi(revokeAssignmentLink, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'No session.' }, 401);
    }

    const { assignmentId } = c.req.valid('param');
    const [row] = await deps.db
      .select({ id: assignmentLink.id, createdByPlayerId: assignmentLink.createdByPlayerId })
      .from(assignmentLink)
      .where(eq(assignmentLink.id, assignmentId))
      .limit(1);
    if (!row) {
      return c.json({ code: 'not_found', message: 'No such assignment link.' }, 404);
    }

    if (!(await hasPlayerClaim(deps.db, session.userId, row.createdByPlayerId))) {
      return c.json({ code: 'forbidden', message: 'Not your assignment link.' }, 403);
    }

    await deps.db
      .update(assignmentLink)
      .set({ revokedAt: new Date() })
      .where(eq(assignmentLink.id, assignmentId));

    return c.body(null, 204);
  });
}
