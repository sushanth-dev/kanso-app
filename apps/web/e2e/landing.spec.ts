import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Axe scans a settled page; reduced motion collapses the reveal so it never
// measures mid-fade text, and exercises the reduced-motion collapse.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test('lands a new visitor on a coherent, axe-clean front door', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Know the one thing to fix after every tournament.' }),
  ).toBeVisible();
  await expect(page.getByText(/Your first diagnosis is free/)).toBeVisible();

  // The synthetic ranked list mirrors the report's shape: rank, label, kind.
  await expect(page.getByText('Synthetic example')).toBeVisible();
  await expect(page.getByText('#1')).toBeVisible();
  await expect(page.getByText('Missing tactics in the middlegame')).toBeVisible();

  // The free/paid boundary is fact-only, matching the upgrade page's plans.
  await expect(page.getByRole('heading', { name: 'Free today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Paid for the loop' })).toBeVisible();
  await expect(page.getByText(/From ₹799 a month, uncapped on the Pro plan/)).toBeVisible();

  await expectNoAxeViolations(page);

  // The smallest phone does not scroll sideways and stays axe-clean.
  await page.setViewportSize({ width: 320, height: 640 });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  await expectNoAxeViolations(page);
});

test('honours reduced motion by collapsing the reveal', async ({ page }) => {
  await page.goto('/');

  const reducedMotion = await page.evaluate(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  expect(reducedMotion).toBe(true);

  // The reveal utility collapses to no animation under reduced motion.
  const duration = await page.evaluate(() => {
    const el = document.querySelector('.reveal-in');
    return el === null ? null : getComputedStyle(el).animationDuration;
  });
  expect(duration).toBe('0s');
});

test('renders the parallax piece as a static, decorative frame', async ({ page }) => {
  await page.goto('/');

  const canvas = page.locator('canvas[aria-hidden="true"]');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('aria-hidden', 'true');
  // Under reduced motion the loop never starts, so the component marks itself
  // static and renders a single frame.
  await expect(canvas).toHaveAttribute('data-reduced-motion', 'true');
});
