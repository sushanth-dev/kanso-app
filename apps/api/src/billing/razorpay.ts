/**
 * ST-044, ADR-0039. The Razorpay seam, the same shape as the fetcher seams
 * (ADR-0018): the app talks to an interface, the real client is the default,
 * and tests inject a fake so no test calls Razorpay.
 *
 * We use plain `fetch` against Razorpay's REST API rather than the `razorpay`
 * package, so no new dependency rides the story. Razorpay holds the card; we
 * hold two ids.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type CreateOrderOutcome = { ok: true; orderId: string } | { ok: false };

export interface RazorpayClient {
  /** The public key id the checkout widget needs. */
  readonly keyId: string;
  createOrder(input: {
    amount: number;
    currency: string;
    receipt: string;
  }): Promise<CreateOrderOutcome>;
  /** Constant-time HMAC-SHA256 of the raw body against the webhook secret. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export function razorpayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RazorpayConfig | null {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_WEBHOOK_SECRET) return null;
  return {
    keyId: RAZORPAY_KEY_ID,
    keySecret: RAZORPAY_KEY_SECRET,
    webhookSecret: RAZORPAY_WEBHOOK_SECRET,
  };
}

export function httpRazorpayClient(config: RazorpayConfig): RazorpayClient {
  return {
    keyId: config.keyId,
    async createOrder({ amount, currency, receipt }) {
      try {
        const res = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ amount, currency, receipt }),
        });
        if (!res.ok) return { ok: false };
        const body = (await res.json()) as { id?: unknown };
        if (typeof body.id !== 'string') return { ok: false };
        return { ok: true, orderId: body.id };
      } catch {
        return { ok: false };
      }
    },
    verifyWebhookSignature(rawBody, signature) {
      const expected = createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex');
      const expectedBuf = Buffer.from(expected);
      const signatureBuf = Buffer.from(signature);
      if (expectedBuf.length !== signatureBuf.length) return false;
      return timingSafeEqual(expectedBuf, signatureBuf);
    },
  };
}

/**
 * The stubbed Razorpay client for the Playwright journey (ST-060). Under
 * `RAZORPAY_STUB=1` the checkout returns a synthetic order and the webhook
 * signature check accepts anything, so the e2e drives the real
 * checkout-then-webhook path and flips an account to paid without Razorpay.
 * It is test infrastructure: the flag is never set in a deployed environment.
 */
export function stubRazorpayClient(): RazorpayClient {
  return {
    keyId: 'stub',
    createOrder({ receipt }): Promise<CreateOrderOutcome> {
      return Promise.resolve({ ok: true, orderId: `stub-${receipt}` });
    },
    verifyWebhookSignature() {
      return true;
    },
  };
}
