import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openNavGroupLink, openSettingsViaNav, upgradeToPaid } from './helpers.ts';

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
  // The display name is the username and updates enforce uniqueness across
  // accounts (ST-084), while sign-up does not. A fixed name collides with the
  // previous run's player on the first save against a persistent dev database,
  // so every run brings its own name.
  const name = `Mina ${randomUUID().slice(0, 8)}`;
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

  // Sign-up lands on the report (ST-092); the settings page is reached through
  // the nav.
  await page.goto('/sign-up');
  await signUp(page, name, email, password);
  await expect(page.getByRole('heading', { name: 'Tournament report', exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await openSettingsViaNav(page);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();

  // Sign-up creates the player from the account name (ST-072), so the merged
  // page shows the identity and the standing badges.
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText(/\d+-day streak/)).toBeVisible();
  await expect(page.getByText(/Level \d+/)).toBeVisible();

  // The edit form keeps the keyboard walk: field order through to submit.
  await page.getByRole('link', { name: 'Edit player' }).focus();
  await expect(page.getByRole('link', { name: 'Edit player' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Edit player' }),
    failedRequests.join('\n'),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByLabel('Username', { exact: true }).focus();
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue(name);
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
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole('link', { name: 'Edit player' }).click();
  await page.getByLabel('Chess.com username').fill('mina-studies');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole('link', { name: 'Edit player' }).click();
  await expect(page.getByLabel('Chess.com username')).toHaveValue('mina-studies');
  await page.getByRole('link', { name: 'Cancel' }).click();

  // Sign out lives on the merged account and settings page (ST-088).
  await openSettingsViaNav(page);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  // The walk starts from a settled page: tabbing while the settings route is
  // still mounted lands focus on it, not on the sign-in form.
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused();
  await page.keyboard.press('Enter');

  // Sign-in lands on the report (ST-092), which is the honest empty state
  // before a player has games.
  await expect(page.getByRole('heading', { name: 'Tournament report', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No analyzed games in this stream yet' }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await openSettingsViaNav(page);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
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
  await signUp(page, 'Mina', email, password);
  // Sign-up lands on the report (ST-092), the honest empty state.
  await expect(page.getByRole('heading', { name: 'Tournament report', exact: true })).toBeVisible();
  await expectNoAxeViolations(page);

  // The report is the honest empty state before a focus exists.
  await expect(
    page.getByRole('heading', { name: 'No analyzed games in this stream yet' }),
  ).toBeVisible();
  await openSettingsViaNav(page);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  // Sign-up creates the player from the account name (ST-072); the settings
  // page shows the identity.
  await expect(page.getByText('Mina')).toBeVisible();

  // Focus and verification are paid (ST-044); flip the account through the
  // checkout and webhook seams before the catalogue is reached.
  await upgradeToPaid(page);

  // The choice: the catalogue, with the ranking beside it.
  await openNavGroupLink(page, 'Progress', 'Focus');
  await expect(page.getByRole('heading', { level: 1, name: 'Set your focus' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Converting won positions' }),
  ).toBeVisible();
  // ST-139: the page's header carries the reveal entrance; reduced motion
  // collapses it to zero, so the catalogue is there immediately.
  const focusHeader = page.locator('main header').first();
  await expect(focusHeader).toHaveClass(/reveal-in/);
  await expect(focusHeader).toHaveCSS('animation-duration', '0s');
  await expectNoAxeViolations(page);

  // The trend: set a focus and read the honest verdict over zero games.
  await page.getByRole('button', { name: 'Set Converting won positions' }).click();
  await expect(page.getByText(/We cannot say yet whether this is working/).first()).toBeVisible();
  await expectNoAxeViolations(page);

  // ST-139: under standard motion the entrance runs at the motion token
  // duration; the emulation flips without repeating the paid setup.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Converting won positions' }),
  ).toBeVisible();
  await expect(focusHeader).toHaveCSS('animation-duration', '0.2s');
});
