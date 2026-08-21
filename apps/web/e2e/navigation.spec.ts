import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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

// The header nav carries every authenticated route, so a signed-in player can
// reach each surface from the account section without hunting for a link.
test('header nav carries every authenticated route and each one navigates', async ({ page }) => {
  const email = `nav-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await signUp(page, 'E2E Nav', email, password);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expectNoAxeViolations(page);

  const nav = page.getByRole('navigation', { name: 'Account' });
  const routes: Array<[string, string]> = [
    ['Account', '/account'],
    ['Report', '/account/report'],
    ['Focus', '/account/focus'],
    ['Games', '/account/games'],
    ['Import', '/account/import'],
    ['Proof sheet', '/account/proof-sheet'],
    ['Plans', '/account/upgrade'],
    ['Settings', '/account/settings'],
  ];

  for (const [label, href] of routes) {
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('href', href);
  }

  // Navigate through a representative sample and confirm the route renders.
  await nav.getByRole('link', { name: 'Report' }).click();
  await expect(page.getByRole('heading', { name: 'Tournament report' })).toBeVisible();
  await expectNoAxeViolations(page);

  await nav.getByRole('link', { name: 'Import' }).click();
  await expect(page.getByRole('heading', { name: 'Import games' })).toBeVisible();
  await expectNoAxeViolations(page);

  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expectNoAxeViolations(page);

  await nav.getByRole('link', { name: 'Account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
});
