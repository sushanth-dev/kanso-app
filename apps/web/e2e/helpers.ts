import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

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

/**
 * Navigates to the merged account-and-settings page (ST-088) through the
 * real UI: the phone-width header menu, then its Settings link. The nav
 * landmark only renders once the menu is open below the md breakpoint.
 */
export async function openSettingsViaNav(page: Page): Promise<void> {
  const settingsLink = page
    .getByRole('navigation', { name: 'Account' })
    .getByRole('link', { name: 'Settings' });
  // The menu may already be open: clicking Settings while already on the page
  // navigates to the same route, which does not close it.
  if (!(await settingsLink.isVisible())) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await settingsLink.click();
}

/**
 * Navigates through the real UI to a link inside a nav dropdown group:
 * open the phone menu if closed, open the group if closed, click the link.
 */
export async function openNavGroupLink(
  page: Page,
  group: 'Progress' | 'Games',
  label: string,
): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Account' });
  const link = nav.getByRole('link', { name: label, exact: true });
  if (!(await link.isVisible())) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  if (!(await link.isVisible())) {
    // Hover opens the group (the panel follows the pointer) and a click on an
    // open <details> toggles it shut, so open it by keyboard.
    const summary = nav.locator('summary', { hasText: group });
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(link).toBeVisible();
  }
  await link.click();
}
