/**
 * DEBT-014. The cache ceiling: `evictEvaluationCache` keeps the newest
 * `maxRows` and drops the rest, and does nothing when the table is under the
 * cap. Real PostgreSQL, because the eviction is SQL over `created_at`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { evaluationCache } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { evictEvaluationCache } from './evaluation-cache.ts';

let harness: IntegrationDatabase;

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

function cacheRow(fen: string, createdAt: Date) {
  return {
    fen,
    engineVersion: 'sf_18',
    depth: 21,
    evalCp: 0,
    bestMoveUci: null,
    nodes: 100,
    createdAt,
  };
}

describe('evictEvaluationCache', () => {
  test('keeps the newest rows and drops the rest', async () => {
    const fens = ['f0', 'f1', 'f2', 'f3', 'f4'];
    await harness.db
      .insert(evaluationCache)
      .values(fens.map((fen, i) => cacheRow(fen, new Date(Date.UTC(2026, 0, 1 + i)))));

    await evictEvaluationCache(harness.db, 3);

    const rows = await harness.db.select({ fen: evaluationCache.fen }).from(evaluationCache);
    expect(rows.map((r) => r.fen).sort()).toEqual(['f2', 'f3', 'f4']);
  });

  test('deletes nothing when the table is under the cap', async () => {
    await harness.db
      .insert(evaluationCache)
      .values([
        cacheRow('f0', new Date(Date.UTC(2026, 0, 1))),
        cacheRow('f1', new Date(Date.UTC(2026, 0, 2))),
      ]);

    await evictEvaluationCache(harness.db, 5);

    const rows = await harness.db.select({ fen: evaluationCache.fen }).from(evaluationCache);
    expect(rows).toHaveLength(2);
  });
});
