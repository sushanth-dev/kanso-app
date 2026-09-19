import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// The stub mailer records consent links here (apps/api/src/account/mailer.ts).
// The two constants must stay in sync the way any client and server contract
// does, so the e2e reads back what the API wrote.
const STUB_DESTINATION = join(tmpdir(), 'kanso-consent-links.log');

function lastConsentLink(): string {
  const lines = readFileSync(STUB_DESTINATION, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const last = lines.at(-1);
  if (!last) throw new Error('no consent link recorded by the stub mailer');
  return last;
}

async function signUpMinor(
  page: Page,
  name: string,
  email: string,
  password: string,
  guardianEmail: string,
) {
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Date of birth').fill('2015-06-01');
  // The guardian field and its explanation reveal only for a minor date of birth.
  await expect(page.getByLabel('Guardian email')).toBeVisible();
  await expect(
    page.getByText(/a guardian's email is required for players under 13/i),
  ).toBeVisible();
  await page.getByLabel('Guardian email').fill(guardianEmail);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  // ST-166: sign-up refuses to submit until the privacy notice is accepted.
  await page.getByRole('checkbox', { name: 'I accept the privacy notice and the terms' }).check();
  await page.getByRole('button', { name: 'Sign up' }).click();
}

test('a minor waits for consent and the emailed confirm link records it', async ({
  page,
  browser,
}) => {
  const email = `minor-${randomUUID()}@example.com`;
  const guardianEmail = `guardian-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}-Aa1!`;

  await page.goto('/sign-up');
  await signUpMinor(page, 'E2E Minor', email, password, guardianEmail);

  // The gated minor meets the waiting state, never a generic error page.
  await expect(page.getByRole('heading', { name: 'Waiting for guardian consent' })).toBeVisible();
  await expect(page.getByText(/a guardian has been emailed and must confirm/i)).toBeVisible();
  // ST-134: the waiting state still keeps its own `<main>` landmark (the
  // route bypasses the authenticated shell) and now wraps its content in the
  // same `reveal-in` Card the rest of entry uses, rather than a bare block.
  await expect(page.getByRole('main').locator('.reveal-in')).toBeVisible();
  await expectNoAxeViolations(page);

  // The guardian opens the emailed link in a context with no session.
  const context = await browser.newContext();
  const reader = await context.newPage();
  const confirmPath = new URL(lastConsentLink()).pathname;
  await reader.goto(confirmPath);
  await expect(reader.getByRole('heading', { name: 'Consent recorded' })).toBeVisible();
  await expect(reader.getByRole('main').locator('.reveal-in')).toBeVisible();
  await expectNoAxeViolations(reader);
  await context.close();
});

test('a tampered or unknown confirm link reads as no longer available', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/guardians/confirm/not-a-real-token');
  await expect(
    page.getByRole('heading', { name: 'This link is no longer available.' }),
  ).toBeVisible();
  await expect(page.getByRole('main').locator('.reveal-in')).toBeVisible();
  await expectNoAxeViolations(page);
  await context.close();
});
