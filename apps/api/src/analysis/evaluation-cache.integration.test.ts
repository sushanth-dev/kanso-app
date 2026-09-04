/**
 * DEBT-014. The cache ceiling: `evictEvaluationCache` keeps the newest
 * `maxRows` and drops the rest, and does nothing when the table is under the
 * cap. Real PostgreSQL, because the eviction is SQL over `created_at` and the
 * lookup/store are batched SQL the unit suite cannot answer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { evaluationCache } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import {
  EVALUATION_CACHE_MAX_ROWS,
  evictEvaluationCache,
  lookupEvaluations,
  storeEvaluations,
} from './evaluation-cache.ts';
import type { EvaluatedPosition } from './engine.ts';

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

  test('the ceiling default is the number DEBT-014 decided', () => {
    expect(EVALUATION_CACHE_MAX_ROWS).toBe(50_000);
  });
});

describe('lookupEvaluations', () => {
  test('answers an empty batch without querying', async () => {
    await expect(lookupEvaluations(harness.db, [], 'sf_18', 21)).resolves.toEqual(new Map());
  });

  test('returns cached positions keyed by FEN, absent ones missing', async () => {
    await harness.db
      .insert(evaluationCache)
      .values([
        cacheRow('fen-a', new Date(Date.UTC(2026, 0, 1))),
        cacheRow('fen-b', new Date(Date.UTC(2026, 0, 2))),
      ]);

    const hits = await lookupEvaluations(harness.db, ['fen-a', 'fen-miss'], 'sf_18', 21);

    expect([...hits.keys()]).toEqual(['fen-a']);
    expect(hits.get('fen-a')).toEqual({ score: { cp: 0 }, bestMoveUci: null });
  });

  test('a row is only a hit at its own engine version and depth', async () => {
    await harness.db
      .insert(evaluationCache)
      .values([cacheRow('fen-a', new Date(Date.UTC(2026, 0, 1)))]);

    expect((await lookupEvaluations(harness.db, ['fen-a'], 'sf_17', 21)).size).toBe(0);
    expect((await lookupEvaluations(harness.db, ['fen-a'], 'sf_18', 24)).size).toBe(0);
    expect((await lookupEvaluations(harness.db, ['fen-a'], 'sf_18', 21)).size).toBe(1);
  });

  test('maps the score columns back, mate-only and empty included', async () => {
    await harness.db.insert(evaluationCache).values([
      { ...cacheRow('mate-row', new Date(Date.UTC(2026, 0, 1))), evalCp: null, evalMate: 3 },
      { ...cacheRow('empty-row', new Date(Date.UTC(2026, 0, 1))), evalCp: null, evalMate: null },
    ]);

    const hits = await lookupEvaluations(harness.db, ['mate-row', 'empty-row'], 'sf_18', 21);
    expect(hits.get('mate-row')!.score).toEqual({ mate: 3 });
    expect(hits.get('empty-row')!.score).toEqual({});
  });
});

describe('storeEvaluations', () => {
  function evaluated(fen: string, depth: number): EvaluatedPosition {
    return { fen, score: { cp: 42 }, bestMoveUci: 'e2e4', depth, nodes: 1_000 };
  }

  test('stores only the positions that reached the requested depth', async () => {
    // The ceiling-stopped search must not be cached: it is not the evaluation
    // the key promises.
    await storeEvaluations(
      harness.db,
      [evaluated('full', 21), evaluated('short', 17)],
      'sf_18',
      21,
    );

    const rows = await harness.db.select({ fen: evaluationCache.fen }).from(evaluationCache);
    expect(rows.map((r) => r.fen)).toEqual(['full']);
  });

  test('a batch with nothing at depth writes nothing', async () => {
    await storeEvaluations(harness.db, [evaluated('short', 17)], 'sf_18', 21);
    const rows = await harness.db.select().from(evaluationCache);
    expect(rows).toHaveLength(0);
  });

  test('writes the row the cache key promises', async () => {
    await storeEvaluations(
      harness.db,
      [{ ...evaluated('fen-a', 24), score: { mate: 2 }, bestMoveUci: null, nodes: 7 }],
      'sf_18',
      21,
    );

    const [row] = await harness.db.select().from(evaluationCache);
    expect(row).toMatchObject({
      fen: 'fen-a',
      engineVersion: 'sf_18',
      depth: 21,
      evalCp: null,
      evalMate: 2,
      bestMoveUci: null,
      nodes: 7,
    });
  });

  test('the first writer wins: a re-store of the same key changes nothing', async () => {
    await storeEvaluations(harness.db, [evaluated('fen-a', 21)], 'sf_18', 21);
    await storeEvaluations(
      harness.db,
      [{ ...evaluated('fen-a', 21), score: { cp: 999 }, nodes: 5 }],
      'sf_18',
      21,
    );

    const [row] = await harness.db.select().from(evaluationCache);
    expect(row!.evalCp).toBe(42);
    expect(row!.nodes).toBe(1_000);
  });
});
