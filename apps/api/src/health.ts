/**
 * The one route that answers without a session, because the thing that calls it
 * most is a load balancer and a load balancer does not sign in.
 *
 * It asks the database a question rather than reporting on itself. A process
 * that is up with a database it cannot reach is a process that answers every
 * useful route with a 500, and a health check that only proved the process was
 * running would hold it in service while it did.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getHealth } from './contract/routes.ts';
import type * as schema from './db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountHealth(app: OpenAPIHono, deps: { db: Db }): void {
  app.openapi(getHealth, async (c) => {
    try {
      await deps.db.execute(sql`select 1`);
    } catch (error) {
      // The message is not passed on. A driver error routinely carries the
      // host, the user, and sometimes the whole connection string, and this
      // route is public.
      console.error('Health check could not reach the database', error);
      return c.json({ code: 'database_unavailable', message: 'The database did not answer.' }, 503);
    }
    return c.json({ status: 'ok', database: 'ok' } as const, 200);
  });
}
