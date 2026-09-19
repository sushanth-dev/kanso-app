import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Axe scans a settled page; reduced motion collapses the reveal animations so
// it never measures mid-fade text, and exercises the reduced-motion collapse.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function signUp(page: Page): Promise<void> {
  const email = `report-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Name').fill('Mina Report');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  // ST-166: sign-up refuses to submit until the privacy notice is accepted.
  await page.getByRole('checkbox', { name: 'I accept the privacy notice and the terms' }).check();
  await page.getByRole('button', { name: 'Sign up' }).click();
  // Sign-up lands on the report (ST-092); a fresh account has no tournaments,
  // so the tournament stream opens on its honest not-ready state.
  await expect(page.getByRole('heading', { name: 'Tournament report', exact: true })).toBeVisible();
}

// ST-137. The report surface's states, its stream toggle, and its entrances.
// A ranked list needs analysed games, which the worker produces on its own
// clock; the ranked-list row contract is unit-covered, so this journey pins
// the states a fresh account deterministically reaches.
test('a fresh account sees the not-ready states and toggles streams', async ({ page }) => {
  await signUp(page);
  await expect(page.getByText('No analyzed games in this stream yet')).toBeVisible();
  // The page's own header, not the shell's sticky nav: the reveal lives there.
  const header = page.locator('main header').first();
  await expect(header).toHaveClass(/reveal-in/);
  await expect(header).toHaveCSS('animation-duration', '0s');
  await expectNoAxeViolations(page);

  await page.getByRole('radio', { name: 'Online' }).click();
  await expect(page.getByRole('heading', { name: 'Online report', exact: true })).toBeVisible();
  await expect(page.getByText('No analyzed games in this stream yet')).toBeVisible();
  await expectNoAxeViolations(page);
});

test('the entrances run at the motion token duration under standard motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signUp(page);
  const header = page.locator('main header').first();
  await expect(header).toHaveClass(/reveal-in/);
  await expect(header).toHaveCSS('animation-duration', '0.2s');
});
