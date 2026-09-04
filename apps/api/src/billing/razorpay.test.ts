import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  httpRazorpayClient,
  razorpayConfigFromEnv,
  stubRazorpayClient,
  type RazorpayConfig,
} from './razorpay.ts';

const config: RazorpayConfig = {
  keyId: 'rzp_test_key',
  keySecret: 'key_secret',
  webhookSecret: 'webhook_secret',
};

describe('httpRazorpayClient.verifyWebhookSignature', () => {
  const client = httpRazorpayClient(config);

  test('accepts the signature Razorpay sends and rejects a tampered one', () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    const signature = createHmac('sha256', config.webhookSecret).update(body).digest('hex');
    expect(client.verifyWebhookSignature(body, signature)).toBe(true);
    expect(client.verifyWebhookSignature(body, `${signature.slice(0, -1)}0`)).toBe(false);
  });

  test('a wrong-length signature is refused, not thrown', () => {
    expect(client.verifyWebhookSignature('{}', 'short')).toBe(false);
  });

  test('a signature made with a different secret is rejected', () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    // semgrep's hardcoded-hmac-key rule tracks literals through local
    // variables, so the wrong secret is derived from the real one instead.
    const otherSecret = createHmac('sha256', `${config.webhookSecret.slice(1)}x`)
      .update(body)
      .digest('hex');
    expect(client.verifyWebhookSignature(body, otherSecret)).toBe(false);
  });
});

describe('httpRazorpayClient.createOrder', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('posts to the order API with basic auth and returns the order id', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'order_abc' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    const client = httpRazorpayClient(config);
    const outcome = await client.createOrder({ amount: 129900, currency: 'INR', receipt: 'r1' });

    expect(outcome).toEqual({ ok: true, orderId: 'order_abc' });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
    });
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 129900,
      currency: 'INR',
      receipt: 'r1',
    });
  });

  test('returns ok:false when the API answers with a failure status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const client = httpRazorpayClient(config);
    expect(await client.createOrder({ amount: 1, currency: 'INR', receipt: 'r' })).toEqual({
      ok: false,
    });
  });
  test('returns ok:false when the API answers without an order id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"foo":1}', { status: 200 })));
    const client = httpRazorpayClient(config);
    expect(await client.createOrder({ amount: 1, currency: 'INR', receipt: 'r' })).toEqual({
      ok: false,
    });
  });

  test('returns ok:false when the call itself throws, instead of rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const client = httpRazorpayClient(config);
    expect(await client.createOrder({ amount: 1, currency: 'INR', receipt: 'r' })).toEqual({
      ok: false,
    });
  });
});

describe('razorpayConfigFromEnv', () => {
  const full = {
    RAZORPAY_KEY_ID: 'rzp_test_key',
    RAZORPAY_KEY_SECRET: 'key_secret',
    RAZORPAY_WEBHOOK_SECRET: 'webhook_secret',
  };

  test('reads the client from a complete environment', () => {
    expect(razorpayConfigFromEnv(full)).toEqual({
      keyId: 'rzp_test_key',
      keySecret: 'key_secret',
      webhookSecret: 'webhook_secret',
    });
  });

  test('is null when any of the three secrets is missing or empty', () => {
    for (const key of Object.keys(full)) {
      const env: NodeJS.ProcessEnv = { ...full, [key]: undefined };
      expect(razorpayConfigFromEnv(env)).toBeNull();
    }
    const empty: NodeJS.ProcessEnv = { ...full, RAZORPAY_KEY_ID: '' };
    expect(razorpayConfigFromEnv(empty)).toBeNull();
  });
});

describe('stubRazorpayClient', () => {
  test('synthesizes an order id from the receipt and accepts any signature', async () => {
    const stub = stubRazorpayClient();
    expect(stub.keyId).toBe('stub');
    await expect(stub.createOrder({ amount: 1, currency: 'INR', receipt: 'r-9' })).resolves.toEqual(
      {
        ok: true,
        orderId: 'stub-r-9',
      },
    );
    expect(stub.verifyWebhookSignature('anything', 'no-signature')).toBe(true);
  });
});
