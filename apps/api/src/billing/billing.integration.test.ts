/**
 * ST-044. Free and paid tiers, exercised against a real PostgreSQL with a fake
 * Razorpay client: a free account is refused every paid route, checkout records
 * the order, a signed webhook flips the tier exactly once, and the free-tier
 * analysis budget counts games analysed this month. No test reaches Razorpay.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Mailer } from '../account/mailer.ts';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { game, processedPayment, subscription } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { freeAnalysisRemaining } from './entitlement.ts';
import type { RazorpayClient } from './razorpay.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';

let verifySignature = true;
let orderSeq = 0;
const createdOrders: Array<{ amount: number; currency: string; receipt: string }> = [];
const razorpay: RazorpayClient = {
  keyId: 'rzp_test_key',
  createOrder(input) {
    orderSeq += 1;
    createdOrders.push(input);
    return Promise.resolve({ ok: true as const, orderId: `order_test_${orderSeq}` });
  },
  verifyWebhookSignature() {
    return verifySignature;
  },
};
const mailer: Mailer = {
  sendConsentNotice: () => Promise.resolve(),
  sendPasswordReset: () => Promise.resolve(),
};

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  verifySignature = true;
  orderSeq = 0;
  createdOrders.length = 0;
});

function app() {
  return createApp({ db: harness.db, auth: createAuth(harness.db, { mailer }), razorpay });
}

async function signUpCookie(email: string): Promise<{ cookie: string; userId: string }> {
  const res = await app().request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: email.split('@')[0], email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie');
  expect(cookie).toBeTruthy();
  const session = await app().request('/api/auth/get-session', { headers: { cookie: cookie! } });
  const body = (await session.json()) as { session: { userId: string } };
  return { cookie: cookie!, userId: body.session.userId };
}

async function createPlayer(cookie: string): Promise<string> {
  const res = await app().request('/players', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'A player' }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function checkout(cookie: string, plan: string): Promise<string> {
  const res = await app().request('/payments/checkout', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { orderId: string };
  return body.orderId;
}

async function sendWebhook(orderId: string, paymentId = 'pay_1'): Promise<Response> {
  return app().request('/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'a-signature' },
    body: JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
    }),
  });
}

describe('free and paid tiers', () => {
  test('a free account is refused at every paid route', async () => {
    const { cookie } = await signUpCookie('free@example.com');
    const playerId = await createPlayer(cookie);

    const paidPaths = [
      '/focuses',
      `/players/${playerId}/focus`,
      `/players/${playerId}/proof-sheets`,
    ];
    for (const path of paidPaths) {
      const res = await app().request(path, { headers: { cookie } });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'upgrade_required' });
    }
  });

  test('a paid account reaches the paid routes', async () => {
    const { cookie, userId } = await signUpCookie('paid@example.com');
    await createPlayer(cookie);
    await harness.db.insert(subscription).values({ userId, tier: 'paid' });

    expect((await app().request('/focuses', { headers: { cookie } })).status).toBe(200);
  });

  test('checkout creates a Razorpay order and records it without a card', async () => {
    const { cookie, userId } = await signUpCookie('checkout@example.com');
    const orderId = await checkout(cookie, 'monthly');

    expect(orderId).toBe('order_test_1');
    expect(createdOrders).toHaveLength(1);
    expect(createdOrders[0]).toMatchObject({ amount: 1500, currency: 'USD' });

    const [row] = await harness.db.select().from(processedPayment);
    expect(row).toMatchObject({
      userId,
      plan: 'monthly',
      amount: 1500,
      currency: 'USD',
      razorpayOrderId: 'order_test_1',
      razorpayPaymentId: null,
    });

    // We hold ids and an amount, never a card number.
    const columns = Object.keys(processedPayment);
    expect(columns).toContain('razorpayOrderId');
    expect(columns).toContain('razorpayPaymentId');
    expect(columns.filter((column) => /card/i.test(column))).toEqual([]);
  });

  test('a signed webhook flips the tier to paid exactly once', async () => {
    const { cookie, userId } = await signUpCookie('webhook@example.com');
    const orderId = await checkout(cookie, 'season');

    expect((await sendWebhook(orderId)).status).toBe(204);
    // Replayed: the unique payment id makes a second delivery a no-op.
    expect((await sendWebhook(orderId)).status).toBe(204);

    const [sub] = await harness.db
      .select()
      .from(subscription)
      .where(eq(subscription.userId, userId));
    expect(sub).toMatchObject({ tier: 'paid', provider: 'razorpay', providerRef: 'pay_1' });

    const rows = await harness.db.select().from(processedPayment);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.razorpayPaymentId).toBe('pay_1');
  });

  test('a bad signature is refused and flips nothing', async () => {
    const { cookie, userId } = await signUpCookie('tampered@example.com');
    const orderId = await checkout(cookie, 'monthly');

    verifySignature = false;
    expect((await sendWebhook(orderId)).status).toBe(401);

    const [sub] = await harness.db
      .select()
      .from(subscription)
      .where(eq(subscription.userId, userId));
    expect(sub).toBeUndefined();
    const [row] = await harness.db.select().from(processedPayment);
    expect(row!.razorpayPaymentId).toBeNull();
  });

  test('the free analysis budget counts games analysed this month', async () => {
    const { cookie, userId } = await signUpCookie('cap@example.com');
    const playerId = await createPlayer(cookie);

    expect(await freeAnalysisRemaining(harness.db, userId)).toBe(30);

    for (let i = 0; i < 30; i += 1) {
      await harness.db.insert(game).values({
        playerId,
        stream: 'online',
        source: 'chesscom',
        pgn: `pgn-${i}`,
        pgnHash: `hash-${i}`,
        result: '1-0',
        analysisStatus: 'complete',
        analyzedAt: new Date(),
      });
    }
    expect(await freeAnalysisRemaining(harness.db, userId)).toBe(0);

    // A game analysed last month does not count toward this month's budget.
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    await harness.db.insert(game).values({
      playerId,
      stream: 'online',
      source: 'chesscom',
      pgn: 'pgn-old',
      pgnHash: 'hash-old',
      result: '1-0',
      analysisStatus: 'complete',
      analyzedAt: lastMonth,
    });
    expect(await freeAnalysisRemaining(harness.db, userId)).toBe(0);
  });
});
