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

  // The technology section names the tools behind the diagnosis.
  await expect(page.getByRole('heading', { name: 'The technology behind it' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stockfish checks every move.' })).toBeVisible();

  await expectNoAxeViolations(page);

  // The smallest phone does not scroll sideways and stays axe-clean.
  await page.setViewportSize({ width: 320, height: 640 });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  await expectNoAxeViolations(page);
});

test('honours reduced motion by rendering the hero at its end state immediately', async ({
  page,
}) => {
  await page.goto('/');

  const reducedMotion = await page.evaluate(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  expect(reducedMotion).toBe(true);

  // The hero ships in a lazy-loaded chunk (ST-133), so wait for it to mount
  // before reading opacities.
  await page.waitForSelector('[data-hero-reveal]');

  // gsap.matchMedia()'s reduced branch sets every hero element straight to
  // its end state (opacity 1, no offset) with gsap.set, no tween: the intro
  // timeline never runs, so the hero is fully visible immediately.
  const heroOpacities = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-hero-reveal]')).map(
      (el) => getComputedStyle(el).opacity,
    ),
  );
  expect(heroOpacities.length).toBeGreaterThan(0);
  expect(heroOpacities.every((opacity) => opacity === '1')).toBe(true);

  await expect(
    page.getByRole('heading', { name: 'Know the one thing to fix after every tournament.' }),
  ).toBeVisible();
});

test('reaches the skip link and the primary call to action by keyboard', async ({ page }) => {
  await page.goto('/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  const joinCta = page.getByRole('link', { name: 'Get your free diagnosis' }).first();
  await joinCta.focus();
  await expect(joinCta).toBeFocused();
  await expect(joinCta).toBeVisible();
});

test('reveals the closing call to action even at the end of a short page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.waitForSelector('[data-hero-reveal]');

  // The scroll-reveal hook hides every container's children until the
  // container's top crosses 80% of the viewport. On the compacted landing
  // the closing CTA sits so low that full scroll left it 15px short of that
  // line, and it never appeared. Scrolling as far as the page allows must
  // still surface it.
  await page.mouse.wheel(0, 3000);
  await page.mouse.wheel(0, 3000);
  const cta = page.getByRole('link', { name: 'Get your free diagnosis' }).last();
  await expect(cta).toBeVisible();
  await expect(cta).toHaveCSS('opacity', '1');
});
