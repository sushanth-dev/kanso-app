/**
 * Apply the checked-in migrations to whatever `DATABASE_URL` points at.
 *
 * The same migrator the integration harness uses, so a deployed database and a
 * test database are brought to the same schema by the same code path. That is
 * the point: a migration that CI has run and production has not is a schema
 * nobody has actually tested.
 *
 * One connection, not a pool, because this runs once and exits.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = new URL('../../drizzle', import.meta.url).pathname;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. See docs/guides/deploy.md.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
  console.log('Migrations applied.');
} finally {
  await sql.end();
}
