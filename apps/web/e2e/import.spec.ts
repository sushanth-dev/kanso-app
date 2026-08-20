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

// The provider call happens server-side, so this blocks only what the browser
// could reach; the API's stub is what actually isolates the import.
async function blockExternalRequests(page: Page): Promise<string[]> {
  const externalRequests: string[] = [];
  const viteOrigin = 'http://127.0.0.1:5173';
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== viteOrigin) {
      externalRequests.push(route.request().url());
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  return externalRequests;
}

async function signUpAndCreatePlayer(page: Page): Promise<void> {
  const email = `import-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Name').fill('E2E Importer');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();

  await page.getByRole('link', { name: 'Create player' }).click();
  await expect(page.getByRole('heading', { name: 'New player' })).toBeVisible();
  await page.getByLabel('Display name').fill('Mina');
  await page.getByLabel('Birth year').fill('2013');
  await page.getByRole('button', { name: 'Create player' }).click();
  await expect(page.getByRole('heading', { name: 'Mina' })).toBeVisible();
}

async function openImport(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Import games' }).click();
  await expect(page.getByRole('heading', { name: 'Import games' })).toBeVisible();
}

function waitForImportResponse(page: Page) {
  return page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/imports'),
  );
}

test('imports a season by username against the stubbed provider', async ({ page }) => {
  const externalRequests = await blockExternalRequests(page);
  await signUpAndCreatePlayer(page);
  await openImport(page);
  await expectNoAxeViolations(page);

  await page.getByLabel('Username').fill('onlinekid');
  const importResponse = waitForImportResponse(page);
  await page.getByRole('button', { name: 'Import games' }).click();
  expect((await importResponse).status()).toBe(202);
  await expect(page.getByText(/Imported \d+ games?\./)).toBeVisible();
  await expectNoAxeViolations(page);

  expect(externalRequests).toEqual([]);
});

test('imports a PGN upload and reports the imported count', async ({ page }) => {
  const externalRequests = await blockExternalRequests(page);
  await signUpAndCreatePlayer(page);
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
  await page.getByLabel('PGN file').setInputFiles({
    name: 'games.pgn',
    mimeType: 'application/x-chess-pgn',
    buffer: Buffer.from(pgn, 'utf8'),
  });

  const importResponse = waitForImportResponse(page);
  await page.getByRole('button', { name: 'Import games' }).click();
  expect((await importResponse).status()).toBe(202);
  await expect(page.getByText(/Imported \d+ games?\./)).toBeVisible();
  await expectNoAxeViolations(page);

  expect(externalRequests).toEqual([]);
});

test('imports a tournament by name and reports the honest empty crosstable', async ({ page }) => {
  const externalRequests = await blockExternalRequests(page);
  await signUpAndCreatePlayer(page);
  await openImport(page);

  await page.getByLabel('Method').selectOption('uscf');
  await page.getByLabel('Tournament name').fill('State Champs');
  await expect(page.getByLabel('Player name')).toHaveValue('Mina');

  const importResponse = waitForImportResponse(page);
  await page.getByRole('button', { name: 'Import games' }).click();
  expect((await importResponse).status()).toBe(202);
  await expect(page.getByText('No games found for Mina in State Champs.')).toBeVisible();
  await expectNoAxeViolations(page);

  expect(externalRequests).toEqual([]);
});
