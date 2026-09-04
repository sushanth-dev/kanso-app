/**
 * The Lambda entry point. `server.ts` gives the same application a port for
 * local development and the integration harness; this gives it the Lambda
 * shape `infra/api.ts` deploys. The application is unchanged: `createApp` is
 * the same Hono app, and `handle` from `hono/aws-lambda` translates the API
 * Gateway event into the `Request` the app already answers.
 *
 * Everything here runs once per execution environment, on the cold start, so
 * the pool, the database handle, and the auth instance are shared by every
 * request that environment serves rather than rebuilt per request.
 */
import { handle } from 'hono/aws-lambda';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createApp } from './app.ts';
import { createAuth } from './auth.ts';
import { resendConfigFromEnv, resendMailer } from './account/mailer.ts';
import * as schema from './db/schema.ts';
import { fixtureGameFetcher } from './import/fixture-game-fetcher.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. See docs/guides/deploy.md.');
}

// One connection per execution environment, not a pool of ten. A Lambda runs
// one invocation at a time, so one connection serves the whole request and
// concurrency comes from the environment count, not this pool. ADR-0014 names
// connection exhaustion as the burst risk and RDS Proxy as the answer if it
// shows up; this is the setting that decides whether it does.
const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql, { schema });

// The real session provider (ADR-0011). `createAuth` throws on a missing
// `BETTER_AUTH_SECRET`, so a function that cannot authenticate fails its first
// request rather than answering 401 forever.
const auth = createAuth(db, { mailer: resendMailer(resendConfigFromEnv()) });

// The Playwright import journey (ST-029) stubs the provider with the captured
// fixtures; production never sets this flag and keeps the real HTTP fetcher.
const gameFetcher = process.env.IMPORT_PROVIDER_STUB === '1' ? fixtureGameFetcher : undefined;

export const handler = handle(createApp({ db, auth, gameFetcher }));
