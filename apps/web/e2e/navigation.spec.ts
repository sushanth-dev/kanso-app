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

// Every authenticated route stays reachable after the nav groups routes into
// dropdowns (ST-087). The desktop nav is one horizontal row, the grouped
// routes open by keyboard and mouse, and the mobile menu icon carries the
// same structure. Axe stays clean throughout.
test('header nav groups routes into dropdowns and every route stays reachable', async ({
  page,
}) => {
  const email = `nav-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await signUp(page, 'E2E Nav', email, password);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expectNoAxeViolations(page);

  const nav = page.getByRole('navigation', { name: 'Account' });

  // Desktop: the singletons are visible links; the grouped routes sit inside
  // closed <details> until opened.
  await expect(nav.getByRole('link', { name: 'Plans' })).toHaveAttribute(
    'href',
    '/account/upgrade',
  );
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/account/settings',
  );

  // Open each dropdown by keyboard (Enter on the focused summary) and assert
  // every grouped route link is present with the right href.
  const groupedRoutes: Array<[string, string, string]> = [
    ['Progress', 'Report', '/account/report'],
    ['Progress', 'Focus', '/account/focus'],
    ['Progress', 'Proof sheet', '/account/proof-sheet'],
    ['Games', 'Games', '/account/games'],
    ['Games', 'Import', '/account/import'],
  ];

  const openedGroups = new Set<string>();
  for (const [group, label, href] of groupedRoutes) {
    if (!openedGroups.has(group)) {
      const summary = nav.getByRole('button', { name: group });
      await summary.focus();
      await page.keyboard.press('Enter');
      openedGroups.add(group);
    }
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('href', href);
  }
  await expectNoAxeViolations(page);

  // Navigate through a representative sample and confirm the route renders.
  await nav.getByRole('link', { name: 'Report' }).click();
  await expect(page.getByRole('heading', { name: 'Tournament report' })).toBeVisible();
  await expectNoAxeViolations(page);

  await nav.getByRole('link', { name: 'Import' }).click();
  await expect(page.getByRole('heading', { name: 'Import games' })).toBeVisible();
  await expectNoAxeViolations(page);

  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expectNoAxeViolations(page);

  // The account page is gone (ST-088): /account redirects to the merged
  // settings page rather than 404ing.
  await page.goto('/account');
  await expect(page).toHaveURL(/\/account\/settings$/);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
});

test('mobile menu icon opens the same grouped structure', async ({ page }) => {
  const email = `nav-m-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await signUp(page, 'E2E Nav Mobile', email, password);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 667 });

  const nav = page.getByRole('navigation', { name: 'Account' });
  const menuButton = nav.getByRole('button', { name: 'Open menu' });

  // Desktop links are hidden below the breakpoint; the menu button is the way in.
  await expect(menuButton).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Plans' })).not.toBeVisible();

  await menuButton.click();
  await expect(nav.getByRole('link', { name: 'Plans' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();

  // A grouped route opens and reaches its destination.
  const progressSummary = nav.getByRole('button', { name: 'Progress' });
  await progressSummary.click();
  await expect(nav.getByRole('link', { name: 'Report' })).toBeVisible();
  await nav.getByRole('link', { name: 'Report' }).click();
  await expect(page.getByRole('heading', { name: 'Tournament report' })).toBeVisible();

  // The menu closes on navigation, so the menu button reverts to "Open".
  await expect(nav.getByRole('button', { name: 'Open menu' })).toBeVisible();
});
