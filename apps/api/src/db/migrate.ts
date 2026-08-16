/**
 * Apply the checked-in migrations to whatever `DATABASE_URL` points at.
 *
 * The same migrator the integration harness uses, so a deployed database and a
 * test database are brought to the same schema by the same code path. That is
 * the point: a migration that CI has run and production has not is a schema
 * nobody has actually tested.
 *
 * One connection, not a pool, because this runs once and exits.
 *
 * `runMigrations` is the shared body. The bottom half runs it when this file is
 * the entry point (`node src/db/migrate.ts`), and `migrate-lambda.ts` runs the
 * same body inside the deployed migration function.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export async function runMigrations(databaseUrl: string, migrationsFolder: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
    console.log('Migrations applied.');
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set. See docs/guides/deploy.md.');
    process.exit(1);
  }
  const migrationsFolder = new URL('../../drizzle', import.meta.url).pathname;
  await runMigrations(databaseUrl, migrationsFolder);
}
