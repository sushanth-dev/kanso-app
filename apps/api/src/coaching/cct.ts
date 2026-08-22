/**
 * ST-080, ADR-0029. The CCT scan: the checks, captures and threats available
 * at the mistake position.
 *
 * Unlike the explanation and Socratic-question routes, this is pure
 * computation over the stored FEN (`findCCT`, already wired into motif
 * attribution and focus scoring), not a model call. There is nothing to
 * cache: the same FEN always gives the same scan, and it is cheap enough to
 * recompute on every read.
 */
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getCctScan } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { findCCT } from '../chess/diagnostic-utils.ts';
import { loadOwnedMistake } from './explanation.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountCctScan(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(getCctScan, async (c) => {
    const { mistakeId } = c.req.valid('param');
    const loaded = await loadOwnedMistake(deps.db, deps.getSession, c, mistakeId);
    if ('status' in loaded) return c.json(loaded.body, loaded.status);

    const { checks, captures, threats } = findCCT(loaded.mistake.fen, loaded.mistake.bestMoveSan);

    return c.json({ mistakeId, checks, captures, threats }, 200);
  });
}
