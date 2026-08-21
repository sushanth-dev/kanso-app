/**
 * ST-044. Razorpay confirms a capture here.
 *
 * The signature is verified against the raw body before anything is trusted,
 * the ADR-0039 consequence that carries over from the security assessment.
 * A replayed webhook finds the row already paid and is a no-op; the unique
 * payment id backs the null-to-set transition, the same pattern the consent
 * token uses. The tier flip and the payment record are one transaction.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { razorpayWebhook } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { processedPayment, subscription } from '../db/schema.ts';
import { nextRenewal } from './plans.ts';
import type { RazorpayClient } from './razorpay.ts';
import { log } from '../logging.ts';

type Db = PostgresJsDatabase<typeof schema>;

const CAPTURE_EVENT = 'payment.captured';

interface WebhookPayload {
  event?: unknown;
  payload?: {
    payment?: {
      entity?: {
        id?: unknown;
        order_id?: unknown;
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
    if (payload.event !== CAPTURE_EVENT) {
      return c.body(null, 204);
    }
    const paymentId = payload.payload?.payment?.entity?.id;
    const orderId = payload.payload?.payment?.entity?.order_id;
    if (typeof paymentId !== 'string' || typeof orderId !== 'string') {
      return c.body(null, 204);
    }

    const [row] = await deps.db
      .select({
        id: processedPayment.id,
        userId: processedPayment.userId,
        tier: processedPayment.tier,
        razorpayPaymentId: processedPayment.razorpayPaymentId,
      })
      .from(processedPayment)
      .where(eq(processedPayment.razorpayOrderId, orderId))
      .limit(1);
    if (!row) {
      return c.json({ code: 'not_found', message: 'No checkout for this order.' }, 404);
    }

    // Already paid: a replayed webhook is a no-op, never a second tier flip.
    if (row.razorpayPaymentId !== null) {
      return c.body(null, 204);
    }

    const periodEnd = nextRenewal();
    await deps.db.transaction(async (tx) => {
      await tx
        .update(processedPayment)
        .set({ razorpayPaymentId: paymentId })
        .where(eq(processedPayment.id, row.id));
      await tx
        .insert(subscription)
        .values({
          userId: row.userId,
          tier: row.tier,
          currentPeriodEnd: periodEnd,
          provider: 'razorpay',
          providerRef: paymentId,
        })
        .onConflictDoUpdate({
          target: subscription.userId,
          set: {
            tier: row.tier,
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
  });
}
