/**
 * The endpoint a guardian reaches by clicking the link in the notice email
 * (N7).
 *
 * It is the first unauthenticated path that changes state, which is why the
 * token is verified before any write and the consent fields are written here
 * and nowhere else. A bad link answers 404 rather than 403 or 409, so a link
 * cannot be used to discover whether a consent request exists, the same reason
 * the shared proof sheet answers 404.
 *
 * Confirming is idempotent: a link that is already consented is a no-op, and
 * the story's "replayed token" and "re-confirm" are the same property, that
 * consent is recorded exactly once.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { confirmGuardian } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { guardianLink } from '../db/schema.ts';
import { verifyConsentToken } from './consent-token.ts';

type Db = PostgresJsDatabase<typeof schema>;

const NOT_FOUND = {
  code: 'not_found',
  message: 'No such consent request, or the link was tampered with or has expired.',
} as const;

export function mountConfirmGuardian(app: OpenAPIHono, deps: { db: Db }): void {
  app.openapi(confirmGuardian, async (c) => {
    const { token } = c.req.valid('param');
    const verified = verifyConsentToken(token);
    if (!verified.ok) {
      return c.json(NOT_FOUND, 404);
    }

    const [link] = await deps.db
      .select({ id: guardianLink.id, consentGrantedAt: guardianLink.consentGrantedAt })
      .from(guardianLink)
      .where(eq(guardianLink.id, verified.linkId))
      .limit(1);
    if (!link) {
      return c.json(NOT_FOUND, 404);
    }

    if (link.consentGrantedAt === null) {
      await deps.db
        .update(guardianLink)
        .set({ consentGrantedAt: new Date(), consentMethod: 'email' })
        .where(eq(guardianLink.id, link.id));
    }

    return c.body(null, 204);
  });
}
