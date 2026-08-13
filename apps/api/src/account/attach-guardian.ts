/**
 * The endpoint that attaches a paying adult to a playing child and mails the
 * consent notice (B4, N7).
 *
 * The consent fields are written nowhere here: the row is inserted with
 * `consent_method` and `consent_granted_at` both null, so only the confirm
 * route can record consent. The insert names its columns explicitly and the
 * body only carries `guardianEmail` and `relationship`, so a caller cannot
 * smuggle a consent timestamp in. This is the mass-assignment mitigation the
 * security assessment names.
 */
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { attachGuardian } from '../contract/routes.ts';
import { user } from '../db/auth-schema.ts';
import * as schema from '../db/schema.ts';
import { guardianLink } from '../db/schema.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { readSession } from '../session.ts';
import { signConsentToken } from './consent-token.ts';
import type { Mailer } from './mailer.ts';

type Db = PostgresJsDatabase<typeof schema>;

const APP_ORIGIN_DEFAULT = 'http://localhost:3000';

/** The public origin the confirm route is served from. */
function confirmUrlFor(token: string): string {
  const origin = process.env.APP_ORIGIN ?? APP_ORIGIN_DEFAULT;
  return `${origin}/guardians/confirm/${token}`;
}

export function mountAttachGuardian(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; mailer: Mailer },
): void {
  app.openapi(attachGuardian, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const { playerId } = c.req.valid('param');
    const body = c.req.valid('json');

    if (!(await hasPlayerClaim(deps.db, session.userId, playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your player.' }, 403);
    }

    const [guardian] = await deps.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, body.guardianEmail))
      .limit(1);
    if (!guardian) {
      return c.json(
        { code: 'guardian_not_found', message: 'No account has that email address.' },
        404,
      );
    }

    const [link] = await deps.db
      .insert(guardianLink)
      .values({
        guardianUserId: guardian.id,
        playerId,
        relationship: body.relationship,
      })
      .onConflictDoNothing()
      .returning();
    if (!link) {
      // The unique index on (guardian_user_id, player_id) answers 409: this
      // guardian is already attached, whether or not they have consented yet.
      return c.json(
        { code: 'already_attached', message: 'That adult is already attached to this player.' },
        409,
      );
    }

    const token = signConsentToken(link.id);
    await deps.mailer.sendConsentNotice({
      to: body.guardianEmail,
      confirmUrl: confirmUrlFor(token),
    });

    return c.body(null, 204);
  });
}
