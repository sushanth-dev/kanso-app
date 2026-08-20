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

async function signUpAndCreatePlayer(page: Page): Promise<string> {
  const email = `games-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('E2E Games');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Create player' }).click();
  await page.getByLabel('Display name').fill('Mina');
  await page.getByLabel('Birth year').fill('2013');
  await page.getByRole('button', { name: 'Create player' }).click();
  await expect(page.getByRole('heading', { name: 'Mina' })).toBeVisible();

  // Create returns to /account, where the player card links carry the id.
  const href = await page.getByRole('link', { name: 'Import games' }).getAttribute('href');
  if (href === null) throw new Error('no Import games link on the account page');
  // /account/players/$playerId/import
  return href.split('/')[3]!;
}

async function importPgn(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Import games' }).click();
  await expect(page.getByRole('heading', { name: 'Import games' })).toBeVisible();
  await page.getByLabel('Method').selectOption('pgn_upload');
  const pgn = [
    '[Event "E2E Review"]',
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
    name: 'review.pgn',
    mimeType: 'application/x-chess-pgn',
    buffer: Buffer.from(pgn, 'utf8'),
  });
  await page.getByRole('button', { name: 'Import games' }).click();
  await expect(page.getByText(/Imported \d+ games?\./)).toBeVisible();
}

test('lists an imported game and opens its review to the honest unanalysed state', async ({
  page,
}) => {
  const playerId = await signUpAndCreatePlayer(page);
  await importPgn(page);

  // The games list shows the imported, still-analysing game, not a shell.
  await page.goto(`/account/players/${playerId}/games?stream=online`);
  await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible();
  await expect(page.getByText('Analysis in progress.')).toBeVisible();
  await expectNoAxeViolations(page);

  // The review route, reached directly, renders the honest no-mistakes state
  // for a still-analysing game rather than a shell or a 500.
  const list = await page.request.get(`/players/${playerId}/games?stream=online&limit=100`);
  const body = (await list.json()) as { games: Array<{ id: string }> };
  expect(body.games.length).toBeGreaterThan(0);
  await page.goto(`/account/players/${playerId}/games/${body.games[0]!.id}`);
  await expect(page.getByRole('heading', { name: 'Game review' })).toBeVisible();
  await expect(page.getByText('No recorded mistakes in this game.')).toBeVisible();
  await expectNoAxeViolations(page);

  // A game this player does not own answers the designed error state, not 500.
  await page.goto(`/account/players/${playerId}/games/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByText('This game could not be loaded')).toBeVisible();
});
