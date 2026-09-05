import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openNavGroupLink } from './helpers.ts';

// Axe scans a settled page; reduced motion collapses the reveal animations so
// it never measures mid-fade text, and exercises the reduced-motion collapse.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

// The provider call happens server-side, so this blocks only what the browser
// could reach; the API's stub is what actually isolates the import.
async function blockExternalRequests(page: Page): Promise<string[]> {
  const externalRequests: string[] = [];
  const viteOrigin = 'http://127.0.0.1:5173';
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    // PostHog is sanctioned third-party traffic (ADR-0038, amended
    // 2026-09-03): let it through unrecorded. Everything else external stays
    // blocked and recorded.
    if (url.hostname.endsWith('posthog.com')) {
      await route.continue();
      return;
    }
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== viteOrigin) {
      externalRequests.push(route.request().url());
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  return externalRequests;
}

async function signUp(page: Page): Promise<void> {
  const email = `import-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Name').fill('Mina Import');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();
  // Sign-up creates the player from the account name (ST-072) and lands on
  // the report (ST-092).
  await expect(page.getByRole('heading', { name: 'Tournament report', exact: true })).toBeVisible();
}

async function openImport(page: Page): Promise<void> {
  await openNavGroupLink(page, 'Games', 'Import');
  await expect(page.getByRole('heading', { name: 'Import games' })).toBeVisible();
}

function waitForImportResponse(page: Page) {
  return page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/imports'),
  );
}

test('imports a season by username against the stubbed provider', async ({ page }) => {
  const externalRequests = await blockExternalRequests(page);
  await signUp(page);
  await openImport(page);
  await expectNoAxeViolations(page);

  await page.getByLabel('Username').fill('onlinekid');
  const importResponse = waitForImportResponse(page);
  await page.getByRole('button', { name: 'Import games' }).click();
  expect((await importResponse).status()).toBe(202);
  // The import navigates to the report (ST-029). The stubbed season's games
  // carry no colour for the player, so the report asks for the side (ST-095)
  // instead of showing the still-analysing state.
  await expect(page.getByRole('heading', { name: 'Online report' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /need your side before analysis/ })).toBeVisible();
  await expectNoAxeViolations(page);

  expect(externalRequests).toEqual([]);
});

test('imports a PGN upload and opens the imported game review', async ({ page }) => {
  const externalRequests = await blockExternalRequests(page);
  await signUp(page);
  await openImport(page);

  await page.getByLabel('Method').selectOption('pgn_upload');
  const pgn = [
    '[Event "E2E Upload"]',
    '[Site "Chess.com"]',
    '[Date "2026.08.01"]',
    '[Round "1"]',
    '[White "White, Player"]',
    '[Black "Black, Player"]',
    '[Result "1-0"]',
    '',
    '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0',
  ].join('\n');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'games.pgn',
    mimeType: 'application/x-chess-pgn',
    buffer: Buffer.from(pgn, 'utf8'),
  });

  const importResponse = waitForImportResponse(page);
  await page.getByRole('button', { name: 'Import games' }).click();
  expect((await importResponse).status()).toBe(202);
  // ST-115: a tournament upload no longer navigates away; it ends in the
  // debrief, and the game id rides so skip lands where the import used to.
  await expect(page.getByRole('button', { name: 'Start the debrief' })).toBeVisible();
  await page.getByRole('button', { name: 'Start the debrief' }).click();
  await expect(page.getByRole('heading', { name: 'Your one focus' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your first drill' })).toBeVisible();
  // One game cannot generate a report; the debrief says so instead of
  // pretending a diagnosis exists.
  await expect(page.getByText('Your first drill appears when the report lands.')).toBeVisible();
  await expectNoAxeViolations(page);
  // Skip lands on the imported game's review, exactly where the import
  // landed before the debrief existed.
  await page.getByRole('button', { name: 'Skip the debrief' }).click();
  await expect(page.getByRole('heading', { name: 'Game review' })).toBeVisible();
  await expectNoAxeViolations(page);

  expect(externalRequests).toEqual([]);
});
