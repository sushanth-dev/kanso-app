/**
 * GET /focuses (F10). The catalogue, excluding retired entries.
 */
import { isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { listFocuses } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { focusCatalogue } from '../db/schema.ts';
import { toCatalogueEntry } from './view.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountListFocuses(app: OpenAPIHono, deps: { db: Db }): void {
  app.openapi(listFocuses, async (c) => {
    const rows = await deps.db
      .select()
      .from(focusCatalogue)
      .where(isNull(focusCatalogue.retiredAt));
    return c.json(rows.map(toCatalogueEntry), 200);
  });
}
