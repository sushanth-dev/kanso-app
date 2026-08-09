import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApp } from './app.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from './db/test-harness.ts';

let harness: IntegrationDatabase;

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

describe('GET /health', () => {
  test('answers 200 with no session, because a load balancer has none', async () => {
    const res = await createApp({ db: harness.db }).request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  test('answers 503 when the query fails rather than reporting healthy', async () => {
    const closed = await setupIntegrationDatabase();
    await closed.close();
    const res = await createApp({ db: closed.db }).request('/health');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('database_unavailable');
  });
});
