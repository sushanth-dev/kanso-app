import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test('imports a season by username against the stubbed provider', async ({ page }) => {
  const email = `import-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;
  const externalRequests: string[] = [];

  // The provider call happens server-side, so this blocks only what the
  // browser could reach; the API's stub is what actually isolates the import.
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

  await page.getByRole('link', { name: 'Import games' }).click();
  await expect(page.getByRole('heading', { name: 'Import games' })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByLabel('Username').fill('onlinekid');
  const importResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/imports'),
  );
  await page.getByRole('button', { name: 'Import games' }).click();
  expect((await importResponse).status()).toBe(202);
  await expect(page.getByText(/Imported \d+ games?\./)).toBeVisible();
  await expectNoAxeViolations(page);

  expect(externalRequests).toEqual([]);
});
