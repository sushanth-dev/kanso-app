import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { httpRazorpayClient, type RazorpayConfig } from './razorpay.ts';

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
});

describe('httpRazorpayClient.createOrder', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('posts to the order API with basic auth and returns the order id', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'order_abc' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    const client = httpRazorpayClient(config);
    const outcome = await client.createOrder({ amount: 1500, currency: 'USD', receipt: 'r1' });

    expect(outcome).toEqual({ ok: true, orderId: 'order_abc' });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
    });
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 1500,
      currency: 'USD',
      receipt: 'r1',
    });
  });

  test('returns ok:false when the API answers with a failure status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const client = httpRazorpayClient(config);
    expect(await client.createOrder({ amount: 1, currency: 'USD', receipt: 'r' })).toEqual({
      ok: false,
    });
  });
});
