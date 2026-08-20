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

// The stub mailer records reset links here (apps/api/src/account/mailer.ts).
// The two constants must stay in sync the way any client and server contract
// does, so the e2e reads back what the API wrote.
const RESET_STUB_DESTINATION = join(tmpdir(), 'kanso-reset-links.log');

function lastResetLink(): string {
  const lines = readFileSync(RESET_STUB_DESTINATION, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const last = lines.at(-1);
  if (!last) throw new Error('no reset link recorded by the stub mailer');
  return last;
}

async function signUp(page: Page, email: string, password: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('E2E Reset');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('resets a forgotten password through the emailed link', async ({ page }) => {
  const email = `reset-${randomUUID()}@example.com`;
  const oldPassword = `Old-${randomUUID()}-Aa1!`;
  const newPassword = `New-${randomUUID()}-Aa1!`;

  await signUp(page, email, oldPassword);
  await signOut(page);

  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText(/if this email exists in our system/i)).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto(new URL(lastResetLink()).pathname);
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm new password').fill(newPassword);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByRole('heading', { name: 'Password reset' })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await signIn(page, email, oldPassword);
  await expect(page.getByText(/email or password was not accepted/i)).toBeVisible();
  await signIn(page, email, newPassword);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
});

test('a bad reset link reads as no longer available', async ({ page }) => {
  await page.goto('/reset-password/not-a-real-token');
  await page.getByLabel('New password', { exact: true }).fill('New-password-Aa1!');
  await page.getByLabel('Confirm new password').fill('New-password-Aa1!');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(
    page.getByRole('heading', { name: 'This link is no longer available.' }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test('a signed-in user changes their password from the account surface', async ({ page }) => {
  const email = `change-${randomUUID()}@example.com`;
  const oldPassword = `Old-${randomUUID()}-Aa1!`;
  const newPassword = `New-${randomUUID()}-Aa1!`;

  await signUp(page, email, oldPassword);

  await page.getByLabel('Current password').fill(oldPassword);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm new password').fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/password changed/i)).toBeVisible();

  await signOut(page);
  await signIn(page, email, oldPassword);
  await expect(page.getByText(/email or password was not accepted/i)).toBeVisible();
  await signIn(page, email, newPassword);
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
});
