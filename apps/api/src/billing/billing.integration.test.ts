/**
 * ST-044, ST-074. The three tiers, exercised against a real PostgreSQL with a
 * fake Razorpay client: a beginner account is refused every paid route,
 * checkout records the order, a signed webhook flips the tier exactly once,
 * and each tier's analysis budget counts games analysed this month. No test
 * reaches Razorpay.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Mailer } from '../account/mailer.ts';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { game, mistake, processedPayment, subscription } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { analysisRemaining, coachRemaining, coachUnitsThisMonth, tierFor } from './entitlement.ts';
import type { RazorpayClient } from './razorpay.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
let verifySignature = true;
let orderOk = true;
let orderSeq = 0;
const createdOrders: Array<{ amount: number; currency: string; receipt: string }> = [];
const razorpay: RazorpayClient = {
  keyId: 'rzp_test_key',
  createOrder(input) {
    if (!orderOk) return Promise.resolve({ ok: false as const });
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
  sendNudge: () => Promise.resolve(),
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
  orderOk = true;
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

/** The id of the player the sign-up hook created for this account. */
async function ownPlayerId(cookie: string): Promise<string> {
  const res = await app().request('/me', { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { player: { id: string } };
  return body.player.id;
}

async function checkout(cookie: string, tier: string): Promise<string> {
  const res = await app().request('/payments/checkout', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ tier }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { orderId: string };
  return body.orderId;
}

/** Posts an arbitrary body to the webhook, optionally without the signature header. */
async function sendRawWebhook(
  body: unknown,
  { withSignature = true }: { withSignature?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withSignature) headers['x-razorpay-signature'] = 'a-signature';
  return await app().request('/payments/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
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

describe('the three tiers', () => {
  test('a beginner account is refused at every paid route', async () => {
    const { cookie } = await signUpCookie('beginner@example.com');

    const paidPaths = ['/focuses', '/focus', '/proof-sheets'];
    for (const path of paidPaths) {
      const res = await app().request(path, { headers: { cookie } });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'upgrade_required' });
    }
  });

  test('an intermediate or pro account reaches the paid routes', async () => {
    const { cookie, userId } = await signUpCookie('pro@example.com');
    await harness.db.insert(subscription).values({ userId, tier: 'pro' });

    expect((await app().request('/focuses', { headers: { cookie } })).status).toBe(200);
  });

  test('checkout creates a Razorpay order and records it without a card', async () => {
    const { cookie, userId } = await signUpCookie('checkout@example.com');
    const orderId = await checkout(cookie, 'pro');

    expect(orderId).toBe('order_test_1');
    expect(createdOrders).toHaveLength(1);
    expect(createdOrders[0]).toMatchObject({ amount: 129900, currency: 'INR' });

    const [row] = await harness.db.select().from(processedPayment);
    expect(row).toMatchObject({
      userId,
      tier: 'pro',
      amount: 129900,
      currency: 'INR',
      razorpayOrderId: 'order_test_1',
      razorpayPaymentId: null,
    });

    // We hold ids and an amount, never a card number.
    const columns = Object.keys(processedPayment);
    expect(columns).toContain('razorpayOrderId');
    expect(columns).toContain('razorpayPaymentId');
    expect(columns.filter((column) => /card/i.test(column))).toEqual([]);
  });

  test('a signed webhook flips the tier to the one purchased, exactly once', async () => {
    const { cookie, userId } = await signUpCookie('webhook@example.com');
    const orderId = await checkout(cookie, 'intermediate');

    expect((await sendWebhook(orderId)).status).toBe(204);
    // Replayed: the unique payment id makes a second delivery a no-op.
    expect((await sendWebhook(orderId)).status).toBe(204);

    const [sub] = await harness.db
      .select()
      .from(subscription)
      .where(eq(subscription.userId, userId));
    expect(sub).toMatchObject({
      tier: 'intermediate',
      provider: 'razorpay',
      providerRef: 'pay_1',
    });

    const rows = await harness.db.select().from(processedPayment);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.razorpayPaymentId).toBe('pay_1');
  });

  test('a bad signature is refused and flips nothing', async () => {
    const { cookie, userId } = await signUpCookie('tampered@example.com');
    const orderId = await checkout(cookie, 'pro');

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

  test('the beginner analysis budget counts games analysed this month', async () => {
    const { cookie, userId } = await signUpCookie('cap@example.com');
    const playerId = await ownPlayerId(cookie);

    expect(await analysisRemaining(harness.db, userId)).toBe(30);

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
    expect(await analysisRemaining(harness.db, userId)).toBe(0);

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
    expect(await analysisRemaining(harness.db, userId)).toBe(0);
  });

  test('pro has no analysis cap', async () => {
    const { userId } = await signUpCookie('unlimited@example.com');
    await harness.db.insert(subscription).values({ userId, tier: 'pro' });

    expect(await analysisRemaining(harness.db, userId)).toBeNull();
  });
  test('tierFor answers beginner when the account has no subscription row', async () => {
    const { userId } = await signUpCookie('tierless@example.com');
    expect(await tierFor(harness.db, userId)).toBe('beginner');

    await harness.db.insert(subscription).values({ userId, tier: 'intermediate' });
    expect(await tierFor(harness.db, userId)).toBe('intermediate');
  });

  test('the coach budget counts one unit per generated text, this month only', async () => {
    const { cookie, userId } = await signUpCookie('coach@example.com');
    const playerId = await ownPlayerId(cookie);

    async function insertGame(pgn: string): Promise<string> {
      const [row] = await harness.db
        .insert(game)
        .values({
          playerId,
          stream: 'online',
          source: 'chesscom',
          pgn,
          pgnHash: `hash-${pgn}`,
          result: '1-0',
          analysisStatus: 'complete',
        })
        .returning({ id: game.id });
      return row!.id;
    }

    function insertMistake(gameId: string, ply: number, generatedAt: Date | null) {
      return harness.db.insert(mistake).values({
        gameId,
        ply,
        moveNumber: Math.ceil(ply / 2),
        movingColor: 'white',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        moveSan: 'Qh5?!',
        bestMoveSan: 'Nf3',
        judgement: 'mistake',
        cpLoss: 200,
        winProbDrop: 0.1,
        explanation: 'You hung a piece.',
        explanationGeneratedAt: generatedAt,
        socraticQuestion: 'What was that piece defending?',
        socraticQuestionGeneratedAt: generatedAt,
      });
    }

    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const lastMonth = new Date(monthStart);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);

    // Both texts on one mistake cost 2; a mistake generated last month and an
    // untouched one cost nothing now.
    const recent = await insertGame('pgn-recent');
    await insertMistake(recent, 10, monthStart);
    const old = await insertGame('pgn-old');
    await insertMistake(old, 12, lastMonth);
    await insertMistake(recent, 14, null);

    expect(await coachUnitsThisMonth(harness.db, userId)).toBe(2);
    expect(await coachRemaining(harness.db, userId)).toBe(48);
  });

  test('pro has no coach budget either', async () => {
    const { userId } = await signUpCookie('coach-pro@example.com');
    await harness.db.insert(subscription).values({ userId, tier: 'pro' });
    expect(await coachRemaining(harness.db, userId)).toBeNull();
  });

  test('checkout for intermediate records the INR paise price', async () => {
    const { cookie, userId } = await signUpCookie('intermediate@example.com');
    const orderId = await checkout(cookie, 'intermediate');

    expect(createdOrders[0]).toMatchObject({ amount: 79900, currency: 'INR' });
    const [row] = await harness.db.select().from(processedPayment);
    expect(row).toMatchObject({
      userId,
      tier: 'intermediate',
      amount: 79900,
      currency: 'INR',
      razorpayPaymentId: null,
    });
    expect(orderId).toBeTruthy();
  });

  test('checkout answers 502 and records nothing when the provider fails', async () => {
    const { cookie } = await signUpCookie('failed-order@example.com');
    orderOk = false;

    const res = await app().request('/payments/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ tier: 'pro' }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'upstream_error' });
    expect(await harness.db.select().from(processedPayment)).toEqual([]);
  });

  test('checkout demands a session', async () => {
    const res = await app().request('/payments/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier: 'pro' }),
    });
    expect(res.status).toBe(401);
  });

  test('a webhook without the signature header is refused', async () => {
    const { cookie } = await signUpCookie('unsigned@example.com');
    const orderId = await checkout(cookie, 'pro');

    const res = await sendRawWebhook(
      {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_x', order_id: orderId } } },
      },
      { withSignature: false },
    );
    expect(res.status).toBe(401);
  });

  test('a non-capture event is acknowledged and flips nothing', async () => {
    const { cookie } = await signUpCookie('failed-event@example.com');
    const orderId = await checkout(cookie, 'pro');

    expect(
      (
        await sendRawWebhook({
          event: 'payment.failed',
          payload: { payment: { entity: { id: 'pay_y', order_id: orderId } } },
        })
      ).status,
    ).toBe(204);

    const [row] = await harness.db.select().from(processedPayment);
    expect(row!.razorpayPaymentId).toBeNull();
    expect(await tierFor(harness.db, row!.userId)).toBe('beginner');
  });

  test('a capture whose entity is missing ids is acknowledged as nothing to do', async () => {
    expect(
      (await sendRawWebhook({ event: 'payment.captured', payload: { payment: { entity: {} } } }))
        .status,
    ).toBe(204);
    expect((await sendRawWebhook({ event: 'payment.captured' })).status).toBe(204);
  });

  test('a capture for an order we never checked out is a 404', async () => {
    const res = await sendWebhook('order_unknown');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'not_found' });
  });
});
