import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { upgradeToPaid } from './helpers.ts';

// Axe scans a settled page; reduced motion collapses the reveal animations so
// it never measures mid-fade text, and exercises the reduced-motion collapse.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

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

test('states the fact-only boundary and the three plans at the 320px floor', async ({ page }) => {
  const email = `upgrade-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await signUp(page, 'E2E Upgrade', email, password);
  await expect(page.getByRole('heading', { name: 'Tournament report', exact: true })).toBeVisible();

  await page.goto('/upgrade');

  // The page's own header, not the shell's sticky nav: the reveal lives there.
  const header = page.locator('main header').first();
  await expect(header).toHaveClass(/reveal-in/);

  // The boundary is stated as facts, not persuasion.
  await expect(page.getByRole('heading', { name: 'Choose a plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Beginner' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Intermediate' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pro' })).toBeVisible();
  await expect(page.getByText('Most popular')).toBeVisible();
  await expect(page.getByText('Import from Chess.com or Lichess by username')).toBeVisible();
  await expect(
    page.getByText('One diagnosis, ranked by what is costing the most rating.'),
  ).toBeVisible();
  await expect(page.getByText('The rating leak number for the top weakness.')).toBeVisible();
  await expect(page.getByText('A focus, and verification')).toBeVisible();
  await expect(page.getByText('The proof sheet')).toBeVisible();

  // Three plans, exactly as decided: beginner free, the other two paid.
  await expect(page.getByText('Free', { exact: true })).toBeVisible();
  await expect(page.getByText('₹799', { exact: true })).toBeVisible();
  await expect(page.getByText('₹1,299', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay ₹799', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay ₹1,299', exact: true })).toBeVisible();
  await expectNoAxeViolations(page);

  // The smallest phone does not scroll sideways and stays axe-clean.
  await page.setViewportSize({ width: 320, height: 640 });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  await expectNoAxeViolations(page);
});

test('shows the already-subscribed state and never offers to charge again', async ({ page }) => {
  const email = `paid-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await signUp(page, 'E2E Paid', email, password);
  await expect(page.getByRole('heading', { name: 'Tournament report', exact: true })).toBeVisible();

  await upgradeToPaid(page);
  await page.goto('/upgrade');

  const header = page.locator('main header').first();
  await expect(header).toHaveClass(/reveal-in/);
  await expect(page.getByRole('heading', { name: 'You are on the Pro plan' })).toBeVisible();
  await expect(page.getByText('Pro', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay ₹/ })).toHaveCount(0);
  await expectNoAxeViolations(page);
});
