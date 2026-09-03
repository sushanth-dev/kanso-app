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
  // The suite's phone-chromium project runs 390px wide, where the desktop nav
  // row is hidden behind the menu icon; this test is about the desktop row, so
  // widen the viewport before asserting it (the mobile row has its own test).
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto('/sign-up');
  await signUp(page, 'E2E Nav', email, password);
  await expect(page.getByRole('heading', { name: 'Tournament report', exact: true })).toBeVisible();
  // The mark's wiring (ST-113): the tab icon is the pawn, with the raster
  // fallback and the apple-touch icon beside it.
  await expect(page.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveCount(1);
  await expect(
    page.locator('link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]'),
  ).toHaveCount(1);
  await expectNoAxeViolations(page);

  const nav = page.getByRole('navigation', { name: 'Account' });

  // Desktop: the singletons are visible links; the grouped routes sit inside
  // closed <details> until opened.
  await expect(nav.getByRole('link', { name: 'Plans' })).toHaveAttribute('href', '/upgrade');
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');

  // Open each dropdown by keyboard (Enter on the focused summary) and assert
  // every grouped route link is present with the right href.
  const groupedRoutes: Array<[string, string, string]> = [
    ['Progress', 'Report', '/report'],
    ['Progress', 'Focus', '/focus'],
    ['Progress', 'Proof sheet', '/proof-sheet'],
    ['Games', 'Games', '/games'],
    ['Games', 'Import', '/import'],
  ];
  const openedGroups = new Set<string>();
  for (const [group, label, href] of groupedRoutes) {
    if (!openedGroups.has(group)) {
      // The group is a native <details>; its <summary> is the keyboard
      // trigger and exposes no button role, so locate it by element.
      const summary = nav.locator('summary', { hasText: group });
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
  // The /account prefix is gone (ST-088): settings lives at /settings.
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
});

test('mobile menu icon opens the same grouped structure', async ({ page }) => {
  const email = `nav-mobile-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;
  await page.goto('/sign-up');
  await signUp(page, 'E2E Nav Mobile', email, password);
  await expect(page.getByRole('heading', { name: 'Tournament report', exact: true })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Account' });
  // The menu button lives in the header banner, outside the nav it toggles.
  const menuButton = page.getByRole('button', { name: 'Open menu' });

  // Desktop links are hidden below the breakpoint; the menu button is the way in.
  await expect(menuButton).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Plans' })).not.toBeVisible();

  await menuButton.click();
  await expect(nav.getByRole('link', { name: 'Plans' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();

  // A grouped route opens and reaches its destination.
  const progressSummary = nav.locator('summary', { hasText: 'Progress' });
  // Hover opens the group (the panel follows the pointer), and a click on an
  // open <details> toggles it shut; open by keyboard, as on desktop.
  await progressSummary.focus();
  await page.keyboard.press('Enter');
  await expect(nav.getByRole('link', { name: 'Report' })).toBeVisible();
  await nav.getByRole('link', { name: 'Report' }).click();
  await expect(page.getByRole('heading', { name: 'Tournament report' })).toBeVisible();

  // The menu closes on navigation, so the menu button reverts to "Open".
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
});
