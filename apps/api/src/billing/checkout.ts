/**
 * ST-044, ST-074. Creates a Razorpay order for intermediate or pro and
 * records the checkout.
 *
 * The `processed_payment` row is written here with a null payment id; the
 * webhook fills the id when Razorpay confirms the capture. The owner comes
 * from the session, never the body, the same trust boundary every write path
 * uses.
 */
import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { createCheckout } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { processedPayment } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { CURRENCY, PLAN_PRICES } from './plans.ts';
import type { RazorpayClient } from './razorpay.ts';

type Db = PostgresJsDatabase<typeof schema>;

export function mountCheckout(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown; razorpay: RazorpayClient },
): void {
  app.openapi(createCheckout, async (c) => {
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const { tier } = c.req.valid('json');
    const { amountCents } = PLAN_PRICES[tier];

    const outcome = await deps.razorpay.createOrder({
      amount: amountCents,
      currency: CURRENCY,
      receipt: randomUUID(),
    });
    if (!outcome.ok) {
      return c.json(
        { code: 'upstream_error', message: 'The payment provider could not create an order.' },
        502,
      );
    }

    await deps.db.insert(processedPayment).values({
      userId: session.userId,
      tier,
      amount: amountCents,
      currency: CURRENCY,
      razorpayOrderId: outcome.orderId,
    });

    return c.json(
      {
        orderId: outcome.orderId,
        amount: amountCents,
        currency: CURRENCY,
        keyId: deps.razorpay.keyId,
      },
      200,
    );
  });
}
