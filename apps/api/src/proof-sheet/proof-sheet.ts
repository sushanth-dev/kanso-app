/**
 * ST-037. The proof sheet handlers: create (POST), read the shared page (GET),
 * and revoke (DELETE).
 *
 * Creation composes and freezes a snapshot; the shared read serves that
 * snapshot and nothing else; revocation marks the row. The three security
 * properties - frozen, token-only, and immediate revocation - are enforced by
 * the shape of these handlers rather than by a comment.
 */
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import {
  createProofSheet,
  getSharedProofSheet,
  listProofSheets,
  revokeProofSheet,
} from '../contract/routes.ts';
import { SharedProofSheet } from '../contract/schemas.ts';
import * as schema from '../db/schema.ts';
import { focusCatalogue, player, playerFocus, proofSheet } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { getOwnPlayerId, hasPlayerClaim } from '../players/claim.ts';
import { FOCUS_COMPUTE } from '../focus/computations.ts';
import { FOCUS_SPECS, measureFocusStream, trendFor } from '../focus/verify.ts';
import { composeSharedProofSheet, generateToken, type MeasuredStream } from './compose.ts';

type Db = PostgresJsDatabase<typeof schema>;

const NO_FOCUS = {
  code: 'not_found',
  message: 'No such player, or no active focus to prove anything about.',
} as const;

const NO_SHEET = {
  code: 'not_found',
  message: 'No such page, or it was revoked or has expired.',
} as const;

const APP_ORIGIN_DEFAULT = 'http://localhost:3000';

function shareUrlFor(token: string): string {
  const origin = process.env.APP_ORIGIN ?? APP_ORIGIN_DEFAULT;
  return `${origin}/shared/proof-sheets/${token}`;
}

/** Measure the active focus in each stream it can be measured in. */
async function measureAll(
  db: Db,
  playerId: string,
  focus: typeof playerFocus.$inferSelect,
  measurable: typeof focusCatalogue.$inferSelect,
): Promise<MeasuredStream[]> {
  const spec = FOCUS_SPECS[measurable.key];
  const compute = FOCUS_COMPUTE[measurable.key];
  if (spec === undefined || compute === undefined) return [];

  const measurements: MeasuredStream[] = [];
  for (const stream of measurable.measurableStreams) {
    const draft = await measureFocusStream(db, playerId, stream, focus.startedAt, (gameIds) =>
      compute(db, playerId, gameIds),
    );
    measurements.push({
      stream,
      unit: spec.unit,
      trend: trendFor(spec, draft.baselineValue, draft.currentValue),
      windowGames: draft.windowGames,
      gamesBefore: draft.gamesBefore,
      baselineValue: draft.baselineValue,
      currentValue: draft.currentValue,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
    });
  }
  return measurements;
}

export function mountProofSheets(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(createProofSheet, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    const [focus] = await deps.db
      .select()
      .from(playerFocus)
      .where(and(eq(playerFocus.playerId, playerId), isNull(playerFocus.endedAt)))
      .limit(1);
    if (!focus) return c.json(NO_FOCUS, 404);

    // The measurable focus is the focus itself, or the paired focus for the
    // F13 case where the instruction names no catalogue key.
    const measurableId = focus.catalogueId ?? focus.pairedFocusId;
    const [measurable] = measurableId
      ? await deps.db
          .select()
          .from(focusCatalogue)
          .where(eq(focusCatalogue.id, measurableId))
          .limit(1)
      : [];
    if (!measurable) return c.json(NO_FOCUS, 404);

    const [owner] = await deps.db
      .select({ displayName: player.displayName })
      .from(player)
      .where(eq(player.id, playerId))
      .limit(1);
    if (!owner) return c.json(NO_FOCUS, 404);

    const measurements = await measureAll(deps.db, playerId, focus, measurable);
    if (measurements.length === 0) return c.json(NO_FOCUS, 404);

    const { snapshot } = composeSharedProofSheet({
      playerDisplayName: owner.displayName,
      focusTitle: measurable.title,
      coachInstruction: focus.coachInstruction,
      startedAt: focus.startedAt,
      measurements,
    });

    const body = c.req.valid('json');
    const token = generateToken();
    const [created] = await deps.db
      .insert(proofSheet)
      .values({
        playerFocusId: focus.id,
        token,
        snapshot,
        expiresAt: body.expiresAt !== undefined ? new Date(body.expiresAt) : null,
      })
      .returning();

    return c.json(
      {
        id: created!.id,
        token,
        url: shareUrlFor(token),
        createdAt: created!.createdAt.toISOString(),
        revokedAt: null,
        expiresAt: created!.expiresAt?.toISOString() ?? null,
      },
      201,
    );
  });

  app.openapi(listProofSheets, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const playerId = await getOwnPlayerId(deps.db, session.userId);
    if (playerId === null) {
      return c.json({ code: 'not_found', message: 'No such player.' }, 404);
    }

    // Live sheets only: revoked and expired links are gone, and a nonexistent
    // player already answered 404 above, so an empty list is the honest "none".
    const now = new Date();
    const rows = await deps.db
      .select({
        id: proofSheet.id,
        token: proofSheet.token,
        createdAt: proofSheet.createdAt,
        expiresAt: proofSheet.expiresAt,
      })
      .from(proofSheet)
      .innerJoin(playerFocus, eq(proofSheet.playerFocusId, playerFocus.id))
      .where(
        and(
          eq(playerFocus.playerId, playerId),
          isNull(proofSheet.revokedAt),
          or(isNull(proofSheet.expiresAt), gt(proofSheet.expiresAt, now)),
        ),
      )
      .orderBy(desc(proofSheet.createdAt));

    return c.json(
      rows.map((row) => ({
        id: row.id,
        token: row.token,
        url: shareUrlFor(row.token),
        createdAt: row.createdAt.toISOString(),
        revokedAt: null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      })),
      200,
    );
  });

  app.openapi(getSharedProofSheet, async (c) => {
    const { token } = c.req.valid('param');
    const [row] = await deps.db
      .select()
      .from(proofSheet)
      .where(eq(proofSheet.token, token))
      .limit(1);

    const now = Date.now();
    if (
      !row ||
      row.revokedAt !== null ||
      (row.expiresAt !== null && row.expiresAt.getTime() <= now)
    ) {
      return c.json(NO_SHEET, 404);
    }

    c.header('Cache-Control', 'no-store');
    return c.json(row.snapshot as z.infer<typeof SharedProofSheet>, 200);
  });

  app.openapi(revokeProofSheet, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'No session.' }, 401);
    }

    const { proofSheetId } = c.req.valid('param');
    const [row] = await deps.db
      .select({ id: proofSheet.id, playerFocusId: proofSheet.playerFocusId })
      .from(proofSheet)
      .where(eq(proofSheet.id, proofSheetId))
      .limit(1);
    if (!row) {
      return c.json({ code: 'not_found', message: 'No such proof sheet.' }, 404);
    }

    const [focus] = await deps.db
      .select({ playerId: playerFocus.playerId })
      .from(playerFocus)
      .where(eq(playerFocus.id, row.playerFocusId))
      .limit(1);
    if (!focus || !(await hasPlayerClaim(deps.db, session.userId, focus.playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your proof sheet.' }, 403);
    }

    await deps.db
      .update(proofSheet)
      .set({ revokedAt: new Date() })
      .where(eq(proofSheet.id, proofSheetId));

    return c.body(null, 204);
  });
}
