/**
 * ST-044. Razorpay confirms a capture here.
 *
 * The signature is verified against the raw body before anything is trusted,
 * the ADR-0039 consequence that carries over from the security assessment.
 * A replayed webhook finds the row already paid and is a no-op; the unique
 * payment id backs the null-to-set transition, the same pattern the consent
 * token uses. The tier flip and the payment record are one transaction.
 *
 * Since the audit follow-up: a capture must match the amount and currency the
 * checkout quoted, a capture extends prepaid time instead of resetting it, a
 * mid-period purchase never downgrades the running tier, and a full refund
 * lapses the entitlement rather than leaving the month paid for.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { razorpayWebhook } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { processedPayment, subscription } from '../db/schema.ts';
import { nextRenewal, type Tier } from './plans.ts';
import type { RazorpayClient } from './razorpay.ts';
import { log } from '../logging.ts';

type Db = PostgresJsDatabase<typeof schema>;

const CAPTURE_EVENT = 'payment.captured';
const REFUND_EVENT = 'refund.processed';

/** Decreases in rank are never applied to a live period; see handleCapture. */
const TIER_RANK: Record<Tier, number> = { beginner: 0, intermediate: 1, pro: 2 };

interface WebhookPayload {
  event?: unknown;
  payload?: {
    payment?: {
      entity?: {
        id?: unknown;
        order_id?: unknown;
        amount?: unknown;
        currency?: unknown;
      };
    };
    refund?: {
      entity?: {
        payment_id?: unknown;
        amount?: unknown;
      };
    };
  };
}

export function mountRazorpayWebhook(
  app: OpenAPIHono,
  deps: { db: Db; razorpay: RazorpayClient },
): void {
  app.openapi(razorpayWebhook, async (c) => {
    const signature = c.req.header('x-razorpay-signature');
    const rawBody = await c.req.raw.text();
    if (!signature || !deps.razorpay.verifyWebhookSignature(rawBody, signature)) {
      return c.json(
        { code: 'invalid_signature', message: 'The webhook signature did not verify.' },
        401,
      );
    }

    const payload = JSON.parse(rawBody) as WebhookPayload;
    if (payload.event === CAPTURE_EVENT) {
      return handleCapture(c, deps.db, payload);
    }
    if (payload.event === REFUND_EVENT) {
      return handleRefund(c, deps.db, payload);
    }
    return c.body(null, 204);
  });
}

async function handleCapture(c: Context, db: Db, payload: WebhookPayload): Promise<Response> {
  const entity = payload.payload?.payment?.entity;
  const paymentId = entity?.id;
  const orderId = entity?.order_id;
  const capturedAmount = entity?.amount;
  const capturedCurrency = entity?.currency;
  if (
    typeof paymentId !== 'string' ||
    typeof orderId !== 'string' ||
    typeof capturedAmount !== 'number' ||
    typeof capturedCurrency !== 'string'
  ) {
    return c.body(null, 204);
  }

  const [row] = await db
    .select({
      id: processedPayment.id,
      userId: processedPayment.userId,
      tier: processedPayment.tier,
      amount: processedPayment.amount,
      currency: processedPayment.currency,
      razorpayPaymentId: processedPayment.razorpayPaymentId,
    })
    .from(processedPayment)
    .where(eq(processedPayment.razorpayOrderId, orderId))
    .limit(1);
  if (!row) {
    return c.json({ code: 'not_found', message: 'No checkout for this order.' }, 404);
  }

  // The signature proves the event came from Razorpay, not that the money is
  // the amount we quoted. A capture that differs from the checkout record does
  // not buy a tier: a partial or underpriced capture flips nothing. Logged
  // loud because it is a fraud signal in the ledger.
  if (capturedAmount !== row.amount || capturedCurrency !== row.currency) {
    log('error', 'payment_capture_mismatch', {
      requestId: c.get('requestId'),
      orderId,
      paymentId,
      expectedAmount: row.amount,
      capturedAmount,
      expectedCurrency: row.currency,
      capturedCurrency,
    });
    return c.body(null, 204);
  }

  // Already paid: a replayed webhook is a no-op, never a second tier flip.
  if (row.razorpayPaymentId !== null) {
    return c.body(null, 204);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(processedPayment)
      .set({ razorpayPaymentId: paymentId })
      .where(eq(processedPayment.id, row.id));

    const [existing] = await tx
      .select({ tier: subscription.tier, currentPeriodEnd: subscription.currentPeriodEnd })
      .from(subscription)
      .where(eq(subscription.userId, row.userId))
      .limit(1);

    // A capture extends the paid period from wherever it stands instead of
    // resetting it to now plus a month, so prepaid days on a dearer plan
    // survive a cheaper purchase landing first. A lapsed period starts fresh
    // from now. Within a live period the tier only rises, so a mid-period
    // downgrade purchase cannot truncate the remaining days.
    const anchor =
      existing?.currentPeriodEnd && existing.currentPeriodEnd.getTime() > now.getTime()
        ? existing.currentPeriodEnd
        : now;
    const periodEnd = nextRenewal(anchor);
    const tier =
      existing && TIER_RANK[existing.tier] > TIER_RANK[row.tier] ? existing.tier : row.tier;

    await tx
      .insert(subscription)
      .values({
        userId: row.userId,
        tier,
        currentPeriodEnd: periodEnd,
        provider: 'razorpay',
        providerRef: paymentId,
      })
      .onConflictDoUpdate({
        target: subscription.userId,
        set: {
          tier,
          currentPeriodEnd: periodEnd,
          provider: 'razorpay',
          providerRef: paymentId,
        },
      });
  });

  log('info', 'payment_captured', {
    requestId: c.get('requestId'),
    userId: row.userId,
    tier: row.tier,
    orderId,
    paymentId,
  });

  return c.body(null, 204);
}

async function handleRefund(c: Context, db: Db, payload: WebhookPayload): Promise<Response> {
  const refundId = payload.payload?.refund?.entity?.payment_id;
  const refundAmount = payload.payload?.refund?.entity?.amount;
  if (typeof refundId !== 'string' || typeof refundAmount !== 'number') {
    return c.body(null, 204);
  }

  const [payment] = await db
    .select({ userId: processedPayment.userId, amount: processedPayment.amount })
    .from(processedPayment)
    .where(eq(processedPayment.razorpayPaymentId, refundId))
    .limit(1);
  // Unknown payment, or a refund that does not cover the full capture: leave
  // the entitlement alone. Only a full refund forfeits the paid period.
  if (!payment || refundAmount < payment.amount) {
    return c.body(null, 204);
  }

  // Lapse the paid period now rather than at its natural end; tierFor reads
  // currentPeriodEnd and drops to beginner the moment it is in the past.
  await db
    .update(subscription)
    .set({ currentPeriodEnd: new Date() })
    .where(eq(subscription.userId, payment.userId));

  log('info', 'payment_refunded', {
    requestId: c.get('requestId'),
    userId: payment.userId,
    paymentId: refundId,
    refundAmount,
  });

  return c.body(null, 204);
}
