/**
 * The integration test harness.
 *
 * Every `*.integration.test.ts` file gets a real PostgreSQL database with the
 * committed migrations applied, and a `reset` that truncates every table
 * between tests. The testing policy forbids mocking the database because our
 * uniqueness rules are partial indexes with `where` clauses, and a stand-in
 * would accept the rows a real database rejects.
 *
 * The suite creates its own database on the server `DATABASE_URL` points at
 * and drops it on the way out, so it never runs against a database that was
 * set up by hand, and never touches `kanso_dev`.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.ts';

const MIGRATIONS_FOLDER = new URL('../../drizzle', import.meta.url).pathname;

export interface IntegrationDatabase {
  db: PostgresJsDatabase<typeof schema>;
  sql: Sql;
  /** Truncate every table. Call in `beforeEach` so test order cannot matter. */
  reset: () => Promise<void>;
  /** Close connections and drop the database. Call in `afterAll`. */
  close: () => Promise<void>;
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The integration suite needs a real ' +
        'PostgreSQL; see docs/guides/local-setup.md for the container ' +
        'command, then copy .env.example to .env.',
    );
  }
  return url;
}

export async function setupIntegrationDatabase(): Promise<IntegrationDatabase> {
  // One connection to the server for create/drop, one to the fresh database
  // for the tests themselves. max: 1 on both: a test that leaks a connection
  // should fail, not queue.
  const admin = postgres(databaseUrl(), { max: 1 });
  const name = `kanso_test_${crypto.randomUUID().replaceAll('-', '')}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  await admin.end();

  const url = new URL(databaseUrl());
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 1 });
  const db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  const reset = async () => {
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
    `;
    if (tables.length === 0) return;
    await sql.unsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  };

  const close = async () => {
    await sql.end();
    const drop = postgres(databaseUrl(), { max: 1 });
    await drop`DROP DATABASE ${drop(name)}`;
    await drop.end();
  };

  return { db, sql, reset, close };
}
