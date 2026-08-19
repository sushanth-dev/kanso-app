import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { upgradeToPaid } from './helpers.ts';

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function signUp(page: Page, name: string, email: string, password: string) {
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();
}

test('states the fact-only boundary and the three prices at the 320px floor', async ({ page }) => {
  const email = `upgrade-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await signUp(page, 'E2E Upgrade', email, password);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();

  await page.goto('/account/upgrade');

  // The boundary is stated as facts, not persuasion.
  await expect(page.getByRole('heading', { name: 'Upgrade to the full loop' })).toBeVisible();
  await expect(page.getByText('Import from Chess.com or Lichess by username')).toBeVisible();
  await expect(
    page.getByText('One diagnosis, ranked by what is costing the most rating.'),
  ).toBeVisible();
  await expect(page.getByText('The rating leak number for the top weakness.')).toBeVisible();
  await expect(page.getByText('A focus, and verification')).toBeVisible();
  await expect(page.getByText('The proof sheet')).toBeVisible();

  // Three prices, exactly as decided, each with a pay button.
  await expect(page.getByText('$15')).toBeVisible();
  await expect(page.getByText('$130')).toBeVisible();
  await expect(page.getByText('$150')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay $15' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay $130' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay $150' })).toBeVisible();
  await expectNoAxeViolations(page);

  // The smallest phone does not scroll sideways and stays axe-clean.
  await page.setViewportSize({ width: 320, height: 640 });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  await expectNoAxeViolations(page);
});

test('shows the already-paid state and never offers to charge again', async ({ page }) => {
  const email = `paid-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await signUp(page, 'E2E Paid', email, password);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();

  await upgradeToPaid(page);
  await page.goto('/account/upgrade');

  await expect(page.getByRole('heading', { name: 'Your account is already paid' })).toBeVisible();
  await expect(page.getByText('Paid')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay \$/ })).toHaveCount(0);
  await expectNoAxeViolations(page);
});
