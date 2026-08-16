/**
 * The migration as a Lambda handler, run once after a deploy from `sst shell`
 * with `aws lambda invoke`. `migrate.ts` carries the shared body; this is the
 * small amount of code that gives it a Lambda shape.
 *
 * The migrations folder is copied into the bundle by `infra/api.ts`'s
 * `copyFiles`, and resolved from `process.cwd()`, because `import.meta.url`
 * would point at the esbuild output rather than the checked-in folder.
 */
import { join } from 'node:path';
import { runMigrations } from './migrate.ts';

export async function handler(): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. See docs/guides/deploy.md.');
  }
  await runMigrations(databaseUrl, join(process.cwd(), 'drizzle'));
  return 'Migrations applied.';
}
