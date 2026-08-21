import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

/**
 * Flips the signed-in account to paid through the real checkout and webhook
 * endpoints, under the `RAZORPAY_STUB` seam. The browser journey does not open
 * Razorpay; it drives the two endpoints a real payment would reach, so the
 * tier flip is the server's own path rather than a test-only shortcut.
 *
 * Called after sign-up, once the session cookie is set, and before a paid
 * surface (focus, proof sheet) is exercised.
 */
export async function upgradeToPaid(page: Page): Promise<void> {
  const checkout = await page.request.post('/payments/checkout', {
    data: { tier: 'pro' },
  });
  if (!checkout.ok()) {
    throw new Error(`checkout failed with ${checkout.status()}: ${await checkout.text()}`);
  }
  const { orderId } = (await checkout.json()) as { orderId: string };

  const paymentId = `pay_${randomUUID()}`;
  const webhook = await page.request.post('/payments/webhook', {
    data: {
      event: 'payment.captured',
      payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
    },
    headers: { 'x-razorpay-signature': 'stub-signature' },
  });
  if (!webhook.ok()) {
    throw new Error(`webhook failed with ${webhook.status()}: ${await webhook.text()}`);
  }
}
