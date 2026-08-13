/**
 * The process. Everything above this file is a Hono app that answers a
 * `Request`, which is what makes it testable without a port; this is the small
 * amount of code that gives it one.
 *
 * It fails loudly and immediately on a missing `DATABASE_URL` rather than
 * starting and answering 503 forever, because a container that starts and does
 * nothing useful is one a load balancer has to diagnose, and a container that
 * refuses to start says why in its own logs.
 */
import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createApp } from './app.ts';
import { createAuth } from './auth.ts';
import * as schema from './db/schema.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. See docs/guides/deploy.md.');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);

// One pool per process, sized well under the connection limit of the smallest
// RDS instance. ADR-0014 names connection exhaustion as the burst risk and RDS
// Proxy as the answer if it shows up; this is the setting that decides whether
// it does.
const sql = postgres(databaseUrl, { max: 10 });
const db = drizzle(sql, { schema });

// The real session provider (ADR-0011). `createAuth` throws on a missing
// `BETTER_AUTH_SECRET`, so a server that cannot authenticate refuses to start
// rather than answering 401 forever.
const auth = createAuth(db);

const server = serve(
  { fetch: createApp({ db, auth }).fetch, port, hostname: '0.0.0.0' },
  (info) => {
    console.log(`API listening on ${info.address}:${info.port}`);
  },
);

// Fargate sends SIGTERM and waits before it sends SIGKILL. Closing the pool in
// that window is what stops a deploy from cutting live queries.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void sql.end({ timeout: 5 }).then(() => process.exit(0));
    });
  });
}
