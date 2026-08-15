import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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

test('signs up and persists an owned player and guardian through sign-in', async ({ page }) => {
  const email = `account-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;
  const guardianEmail = `guardian-${randomUUID()}@example.com`;
  const guardianPassword = `E2e-${randomUUID()}-Aa1!`;
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
  await signUp(page, 'E2E Guardian', guardianEmail, guardianPassword);
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByRole('link', { name: 'Sign up' }).focus();
  await expect(page.getByRole('link', { name: 'Sign up' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await signUp(page, 'E2E Account', email, password);

  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => fetch('/me').then((response) => response.status))).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  expect(await page.evaluate(() => fetch('/me').then((response) => response.status))).toBe(200);

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

  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Owned Mina' })).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Chess.com username').fill('mina-studies');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('heading', { name: 'Owned Mina' })).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Chess.com username')).toHaveValue('mina-studies');
  await page.getByRole('link', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'Add guardian' }).click();
  await expect(page.getByRole('heading', { name: 'Add guardian' })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByLabel('Guardian email').fill(guardianEmail);
  await page.getByLabel('Relationship').fill('Parent');
  const guardianResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/guardians'),
  );
  await page.getByRole('button', { name: 'Send invitation' }).click();
  const guardianResult = await guardianResponse;
  expect(
    guardianResult.status(),
    guardianResult.status() === 204 ? undefined : await guardianResult.text(),
  ).toBe(204);
  await expect(page.getByText('Guardian invitation sent.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('Guardian invitation sent.', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password')).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Owned Mina' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Players you support', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('No players you support')).toBeVisible();
  await expect(page.getByText('Guardian invitation sent.', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'View report' }).click();
  await expect(page.getByRole('heading', { name: 'Tournament report' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No analyzed games in this stream yet' }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('link', { name: 'Back to your account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  expect(externalRequests).toEqual([]);
  // The report returns 404 until a player has analyzed games, which is the
  // honest state Mina is in here, not a failed request.
  const unexpectedFailures = failedRequests.filter(
    (entry) => !/\/report\?stream=\w+:\s*404$/.test(entry),
  );
  expect(unexpectedFailures).toEqual([]);
  // Chromium logs a generic "Failed to load resource" for that same 404.
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) => !message.includes('the server responded with a status of 404'),
  );
  expect(unexpectedConsoleErrors).toEqual([]);
});
