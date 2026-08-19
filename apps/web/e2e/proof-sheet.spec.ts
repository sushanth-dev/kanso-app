import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { upgradeToPaid } from './helpers.ts';

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

async function createPlayerAndSetFocus(page: Page) {
  await page.getByRole('link', { name: 'Create player' }).click();
  await page.getByLabel('Display name').fill('Mina');
  await page.getByLabel('Birth year').fill('2013');
  await page.getByRole('button', { name: 'Create player' }).click();
  await expect(page.getByRole('heading', { name: 'Mina' })).toBeVisible();
  await page.getByRole('link', { name: 'Set focus' }).click();
  await page.getByRole('button', { name: 'Set Converting won positions' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Converting won positions' }),
  ).toBeVisible();
}

async function openWithoutSession(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

test('creates, shares, reads, and revokes a proof sheet', async ({ page, browser }) => {
  const email = `proof-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await signUp(page, 'E2E Proof', email, password);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();

  // The proof sheet and the focus behind it are paid (ST-044); flip the
  // account through the checkout and webhook seams before the share act.
  await upgradeToPaid(page);
  await createPlayerAndSetFocus(page);

  // The share act is an explicit create, driven through the API seam: the
  // create button left the focus flow in ST-058, and the surface that owns the
  // share act is ST-059's reader.
  const me = (await (await page.request.get('/me')).json()) as {
    players: { id: string }[];
  };
  const player = me.players[0];
  if (player === undefined) throw new Error('expected a player after sign-up');
  const created = await page.request.post(`/players/${player.id}/proof-sheets`);
  if (!created.ok()) {
    throw new Error(`create proof sheet failed: ${created.status()} ${await created.text()}`);
  }
  const sheet = (await created.json()) as { id: string; url: string };

  // The forwarded link opens in a context with no session and no chrome.
  const reader = await openWithoutSession(browser, sheet.url);
  await expect(reader.getByRole('heading', { name: 'Converting won positions' })).toBeVisible();
  await expect(
    reader.getByText('There is not enough evidence yet to say whether it is helping.'),
  ).toBeVisible();
  await expectNoAxeViolations(reader);

  // Revocation stops the link working immediately.
  const revoked = await page.request.delete(`/proof-sheets/${sheet.id}`);
  if (!revoked.ok()) {
    throw new Error(`revoke proof sheet failed: ${revoked.status()} ${await revoked.text()}`);
  }

  await reader.reload();
  await expect(
    reader.getByRole('heading', { name: 'This link is no longer available.' }),
  ).toBeVisible();
});
