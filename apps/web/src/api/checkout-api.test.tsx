import { describe, expect, test } from 'vitest';
import { ApiRequestError } from './account-api.ts';
import { createCheckoutApi } from './checkout-api.ts';

const checkoutResponse = {
  checkoutUrl: 'https://checkout.stripe.example/session/cs_123',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('checkout API transport', () => {
  test('posts the selected tier and returns the checkout URL', async () => {
    let lastRequest: Request | undefined;
    const api = createCheckoutApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(checkoutResponse));
    });

    expect(await api.checkout('pro')).toEqual(checkoutResponse);
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe('/payments/checkout');
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.credentials).toBe('include');
    expect(await lastRequest?.json()).toEqual({ tier: 'pro' });
  });

  test('throws a typed API error when checkout creation fails', async () => {
    const failedApi = createCheckoutApi(() =>
      Promise.resolve(jsonResponse({ code: 'payment_unavailable', message: 'Try later.' }, 503)),
    );

    const checkout = failedApi.checkout('pro');
    await expect(checkout).rejects.toBeInstanceOf(ApiRequestError);
    await expect(checkout).rejects.toMatchObject({
      status: 503,
      code: 'payment_unavailable',
      issues: undefined,
      message: 'Try later.',
    });
  });
});
