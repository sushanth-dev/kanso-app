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

export function createAuth(db: PostgresJsDatabase<typeof schema>) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is not set. See .env.example.');
  }

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
    emailAndPassword: {
      enabled: true,
    },
    advanced: {
      cookiePrefix: 'kanso',
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
  });
}
