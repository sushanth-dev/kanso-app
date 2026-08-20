import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { upgradeToPaid } from './helpers.ts';

// Axe scans a settled page; reduced motion collapses the reveal animations so
// it never measures mid-fade text, and exercises the reduced-motion collapse.
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

test('signs up and persists a player through sign-in', async ({ page }) => {
  const email = `account-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const externalRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
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
  await page.routeWebSocket(/.*/, async (webSocket) => {
    const url = new URL(webSocket.url());
    if (url.origin === 'ws://127.0.0.1:5173') {
      webSocket.connectToServer();
      return;
    }
    externalRequests.push(webSocket.url());
    await webSocket.close({ code: 1008, reason: 'Unexpected network origin' });
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`,
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.request().method()} ${response.url()}: ${response.status()}`);
    }
  });

  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Sign up' }).focus();
  await expect(page.getByRole('link', { name: 'Sign up' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expectNoAxeViolations(page);
  await signUp(page, 'E2E Account', email, password);

  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Create player' }).focus();
  await expect(page.getByRole('link', { name: 'Create player' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'New player' }),
    failedRequests.join('\n'),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Display name')).toBeFocused();
  await page.keyboard.type('Mina');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Birth year')).toBeFocused();
  await page.keyboard.type('2013');
  for (const label of [
    'FIDE ID',
    'FIDE rating',
    'USCF ID',
    'USCF rating',
    'Chess.com username',
    'Lichess username',
  ]) {
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(label)).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Create player' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mina' })).toBeVisible();
  await expect(
    page.getByText('No diagnosis yet. Import games to get a ranked report.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Chess.com username').fill('mina-studies');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('heading', { name: 'Mina' })).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Chess.com username')).toHaveValue('mina-studies');
  await page.getByRole('link', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password')).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mina' })).toBeVisible();
  await page.getByRole('link', { name: 'View report' }).click();
  await expect(page.getByRole('heading', { name: 'Tournament report' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No analyzed games in this stream yet' }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('link', { name: 'Back to your account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  expect(externalRequests).toEqual([]);
  // The report returns 404 until a player has analyzed games, which is the
  // honest state Mina is in here, not a failed request. Sign-out clears the
  // session a moment before the account route unmounts, so `/me` and the
  // report query can briefly answer 401; that transient is also expected.
  const unexpectedFailures = failedRequests.filter(
    (entry) => !/\/report\?stream=\w+:\s*404$/.test(entry) && !/:\s*401$/.test(entry),
  );
  expect(unexpectedFailures).toEqual([]);
  // Chromium logs a generic "Failed to load resource" for the same 404 and for
  // the sign-out 401 transient.
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) =>
      !message.includes('the server responded with a status of 404') &&
      !message.includes('the server responded with a status of 401'),
  );
  expect(unexpectedConsoleErrors).toEqual([]);
});

test('walks report to focus to the verification trend', async ({ page }) => {
  const email = `focus-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await signUp(page, 'E2E Focus', email, password);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole('link', { name: 'Create player' }).click();
  await expect(page.getByRole('heading', { name: 'New player' })).toBeVisible();
  await page.getByLabel('Display name').fill('Mina');
  await page.getByLabel('Birth year').fill('2013');
  await page.getByRole('button', { name: 'Create player' }).click();
  await expect(page.getByRole('heading', { name: 'Mina' })).toBeVisible();

  // The report is the honest empty state before a focus exists.
  await page.getByRole('link', { name: 'View report' }).click();
  await expect(page.getByRole('heading', { name: 'Tournament report' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No analyzed games in this stream yet' }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('link', { name: 'Back to your account' }).click();

  // Focus and verification are paid (ST-044); flip the account through the
  // checkout and webhook seams before the catalogue is reached.
  await upgradeToPaid(page);

  // The choice: the catalogue, with the ranking beside it.
  await page.getByRole('link', { name: 'Set focus' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Set your focus' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Converting won positions' }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  // The trend: set a focus and read the honest verdict over zero games.
  await page.getByRole('button', { name: 'Set Converting won positions' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Converting won positions' }),
  ).toBeVisible();
  await expect(page.getByText(/We cannot say yet whether this is working/).first()).toBeVisible();
  await expectNoAxeViolations(page);
});
