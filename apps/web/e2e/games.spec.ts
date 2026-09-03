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

async function signUp(page: Page): Promise<void> {
  const email = `games-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('E2E Games');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();
  // Sign-up creates the player from the account name (ST-072) and lands on
  // the report (ST-092).
  await expect(page.getByRole('heading', { name: 'Tournament report', exact: true })).toBeVisible();
}

async function importPgn(page: Page): Promise<void> {
  await openNavGroupLink(page, 'Games', 'Import');
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
  await page.locator('input[type="file"]').setInputFiles({
    name: 'review.pgn',
    mimeType: 'application/x-chess-pgn',
    buffer: Buffer.from(pgn, 'utf8'),
  });
  await page.getByRole('button', { name: 'Import games' }).click();
  // ST-115: a tournament upload ends in the debrief instead of navigating.
  // A one-game upload sits under the report threshold (ST-096), so skipping
  // the debrief lands on the imported game's review, where the import ended
  // before ST-115.
  await page.getByRole('button', { name: 'Start the debrief' }).click();
  await page.getByRole('button', { name: 'Skip the debrief' }).click();
  await expect(page.getByRole('heading', { name: 'Game review' })).toBeVisible();
}

test('lists an imported game and opens its review to the honest unanalysed state', async ({
  page,
}) => {
  await signUp(page);
  await importPgn(page);

  // The games list shows the imported, still-analysing game, not a shell.
  await page.goto('/games?stream=tournament');
  await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible();
  await expect(page.getByText(/Waiting for your side/)).toBeVisible();
  await expectNoAxeViolations(page);

  // The review route, reached directly, renders the honest no-moves state for
  // a still-analysing game rather than a shell or a 500.
  const list = await page.request.get('/games?stream=tournament&limit=100');
  const body = (await list.json()) as { games: Array<{ id: string }> };
  expect(body.games.length).toBeGreaterThan(0);
  await page.goto(`/games/${body.games[0]!.id}`);
  await expect(page.getByRole('heading', { name: 'Game review' })).toBeVisible();
  await expect(
    page.getByText('Your side was not recorded for this game. Which colour were you?'),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  // A game this player does not own answers the designed error state, not 500.
  await page.goto('/games/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('This game could not be loaded')).toBeVisible();
});

test('deletes an imported game from the list after confirmation', async ({ page }) => {
  await signUp(page);
  await importPgn(page);

  await page.goto('/games?stream=tournament');
  await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible();
  await expect(page.getByText(/Waiting for your side/)).toBeVisible();

  // The card's Delete button opens the confirmation dialog; confirming removes
  // the game and its card from the list.
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Delete this game?' })).toBeVisible();
  await page
    .getByRole('alertdialog', { name: 'Delete this game?' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(page.getByText(/Waiting for your side/)).not.toBeVisible();
  await expectNoAxeViolations(page);
});
