/**
 * better-auth, the session provider ADR-0011 chose.
 *
 * This is the security boundary of the application: sessions, hashing, and
 * token rotation come from here rather than from us, which is the reason the
 * ADR chose a library for this. Everything that reaches a handler through a
 * session cookie is decided by this file's configuration.
 *
 * The base path is `/api/auth`, so better-auth's routes live outside the
 * OpenAPI contract, as `contract/routes.ts` already states they will.
 *
 * `db` is injected rather than built here so the same configuration serves
 * the running server and the integration tests, which point at different
 * databases. `auth.config.ts` is the CLI-only bootstrap that default-exports
 * an instance for `@better-auth/cli generate`; it exists because the CLI can
 * only read a config that exports the auth instance, and this file is a
 * factory because the tests need one bound to their own database.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { account, session, user, verification } from './db/auth-schema.ts';
import * as schema from './db/schema.ts';
import {
  maybeCreateGuardianConsent,
  validateMinorSignup,
  type MinorSignup,
  type NewUser,
} from './account/consent-request.ts';
import type { Mailer } from './account/mailer.ts';

export function createAuth(db: PostgresJsDatabase<typeof schema>, deps: { mailer: Mailer }) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is not set. See .env.example.');
  }
  // The ST-021 rate limit, shared by sign-in and both reset endpoints so there
  // is one throttle rather than three to reason about.
  const rateLimitWindow = Number(process.env.SIGN_IN_RATE_LIMIT_WINDOW_SECONDS ?? 300);
  const rateLimitMax = Number(process.env.SIGN_IN_RATE_LIMIT_MAX ?? 5);

  return betterAuth({
    // The schema is passed explicitly rather than read off `db._.fullSchema`,
    // because the adapter needs the auth tables keyed by their model names and
    // the test harness constructs the db from the combined schema. Passing the
    // auth tables here is what lets the adapter find `user`, `session`,
    // `account`, and `verification`.
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    secret,
    basePath: '/api/auth',
    // The origins better-auth accepts cross-origin requests from (ST-030 Part
    // 2). Read from the same CORS_ORIGINS the Hono middleware uses, so there
    // is one allowlist rather than two to drift. Unset in local dev, where the
    // Vite proxy keeps everything same-origin.
    trustedOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: ({ user, token }) =>
        deps.mailer.sendPasswordReset({
          to: user.email,
          resetUrl: `${process.env.APP_ORIGIN ?? 'http://localhost:3000'}/reset-password/${token}`,
        }),
    },
    user: {
      additionalFields: {
        dateOfBirth: { type: 'string', required: false },
        guardianEmail: { type: 'string', required: false },
        // ST-166. Declared so the sign-up payload may carry it and so the
        // adapter maps it to `user.privacy_acknowledged_at`. The value is
        // replaced below; only its presence matters here.
        privacyAcknowledgedAt: { type: 'date', required: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: (user) => {
            const candidate = user as unknown as MinorSignup & {
              privacyAcknowledgedAt?: unknown;
            };
            validateMinorSignup(candidate);
            // ST-166 + the audit's 26.10. The acknowledgement is required,
            // not merely recorded: a sign-up that omits it has asserted
            // nothing, so it is refused the same way a bad birth date is.
            // The instant recorded is still ours when the claim is present -
            // a client-chosen timestamp would let a caller backdate the
            // acknowledgement it is the whole point of keeping. better-auth
            // merges this return value into the create payload, so nothing
            // else the caller sent is dropped.
            if (
              candidate.privacyAcknowledgedAt === undefined ||
              candidate.privacyAcknowledgedAt === null
            ) {
              throw new Error('The privacy notice must be acknowledged before sign-up.');
            }
            return Promise.resolve({ data: { privacyAcknowledgedAt: new Date() } });
          },
          after: async (created) => {
            const newUser = created as unknown as NewUser & { name: string };
            await maybeCreateGuardianConsent(db, deps.mailer, newUser);
            // ST-072. One account is one player: the player is born at sign-up,
            // not by a route. `displayName` starts as the account name and is
            // editable later.
            await db.insert(schema.player).values({
              ownerUserId: newUser.id,
              displayName: newUser.name,
              birthYear: newUser.dateOfBirth ? Number(newUser.dateOfBirth.slice(0, 4)) : null,
            });
          },
        },
      },
    },
    rateLimit: {
      // The ST-021 sign-in throttle. Enabled only by the explicit deploy flag,
      // never by NODE_ENV: the Lambda sets SIGN_IN_RATE_LIMIT_ENABLED in
      // infra/api.ts, and a deploy review sees the setting rather than an
      // environment variable that the Fargate images used to set and the
      // Lambda never did. The integration suite opts in the same way.
      // better-auth's default store is per-process memory, so on the Lambda
      // fleet the limiter is per-instance; a shared store is the upgrade path
      // if the throttle needs to hold across instances.
      enabled: process.env.SIGN_IN_RATE_LIMIT_ENABLED === 'true',
      customRules: {
        '/sign-in/email': { window: rateLimitWindow, max: rateLimitMax },
        '/request-password-reset': { window: rateLimitWindow, max: rateLimitMax },
        '/reset-password': { window: rateLimitWindow, max: rateLimitMax },
      },
    },
    advanced: {
      cookiePrefix: 'kanso',
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
  });
}
