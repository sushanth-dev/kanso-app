/**
 * ST-017. Attach a guardian and record email-plus consent.
 *
 * The consent flow is exercised end to end against a real PostgreSQL with a
 * fake mailer: attach mails a signed token, confirm records consent exactly
 * once, and a tampered, expired, or unknown token records nothing. The fake
 * mailer keeps this suite off SES; the real sender is covered by
 * `mailer.integration.test.ts` against LocalStack.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { guardianLink, player } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { signConsentToken } from './consent-token.ts';
import type { Mailer } from './mailer.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const PARENT = 'alice@example.com';
const GUARDIAN = 'bob@example.com';
const STRANGER = 'carol@example.com';

const sent: Array<{ to: string; confirmUrl: string }> = [];
const mailer: Mailer = {
  sendConsentNotice(input) {
    sent.push(input);
    return Promise.resolve();
  },
};

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  sent.length = 0;
});

function app() {
  return createApp({ db: harness.db, auth: createAuth(harness.db), mailer });
}

async function signIn(email: string): Promise<string> {
  const a = app();
  await a.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: email.split('@')[0], email, password: PASSWORD }),
  });
  const res = await a.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie') as string;
}

async function whoAmI(cookie: string): Promise<string> {
  const a = app();
  const res = await a.request('/api/auth/get-session', { headers: { cookie } });
  const body = (await res.json()) as { session: { userId: string } };
  expect(body.session).toBeTruthy();
  return body.session.userId;
}

async function makePlayer(ownerUserId: string): Promise<string> {
  const [row] = await harness.db
    .insert(player)
    .values({ ownerUserId, displayName: 'The child' })
    .returning({ id: player.id });
  return row!.id;
}

/** The token carried in the most recent notice the fake mailer recorded. */
function lastToken(): string {
  const { confirmUrl } = sent[sent.length - 1]!;
  return confirmUrl.slice(confirmUrl.lastIndexOf('/') + 1);
}

async function attach(cookie: string, playerId: string, guardianEmail: string): Promise<Response> {
  return app().request(`/players/${playerId}/guardians`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ guardianEmail }),
  });
}

describe('the guardian consent flow', () => {
  test('attach mails a notice, confirm records consent once, re-confirm is a no-op', async () => {
    const parentCookie = await signIn(PARENT);
    const playerId = await makePlayer(await whoAmI(parentCookie));
    await signIn(GUARDIAN); // the guardian must already be an account

    const res = await attach(parentCookie, playerId, GUARDIAN);
    expect(res.status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(GUARDIAN);

    // Before confirm the link is pending: no consent recorded.
    const [pending] = await harness.db
      .select()
      .from(guardianLink)
      .where(eq(guardianLink.playerId, playerId));
    expect(pending!.consentGrantedAt).toBeNull();
    expect(pending!.consentMethod).toBeNull();

    // Confirming records consent.
    const token = lastToken();
    expect((await app().request(`/guardians/confirm/${token}`)).status).toBe(204);
    const [granted] = await harness.db
      .select()
      .from(guardianLink)
      .where(eq(guardianLink.playerId, playerId));
    expect(granted!.consentGrantedAt).not.toBeNull();
    expect(granted!.consentMethod).toBe('email');

    // Re-confirming the same link is a no-op and never double-records.
    expect((await app().request(`/guardians/confirm/${token}`)).status).toBe(204);
    const [still] = await harness.db
      .select()
      .from(guardianLink)
      .where(eq(guardianLink.playerId, playerId));
    expect(still!.consentGrantedAt).toEqual(granted!.consentGrantedAt);
  });

  test('re-attaching the same guardian answers 409', async () => {
    const parentCookie = await signIn(PARENT);
    const playerId = await makePlayer(await whoAmI(parentCookie));
    await signIn(GUARDIAN);

    expect((await attach(parentCookie, playerId, GUARDIAN)).status).toBe(204);
    expect((await attach(parentCookie, playerId, GUARDIAN)).status).toBe(409);
  });

  test('a session with no claim on the player answers 403', async () => {
    const parentCookie = await signIn(PARENT);
    const playerId = await makePlayer(await whoAmI(parentCookie));
    const strangerCookie = await signIn(STRANGER);

    const res = await attach(strangerCookie, playerId, GUARDIAN);
    expect(res.status).toBe(403);
  });

  test('an email with no account answers 404', async () => {
    const parentCookie = await signIn(PARENT);
    const playerId = await makePlayer(await whoAmI(parentCookie));

    const res = await attach(parentCookie, playerId, 'nobody@example.com');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'guardian_not_found' });
  });

  test('a tampered token records nothing and answers 404', async () => {
    const parentCookie = await signIn(PARENT);
    const playerId = await makePlayer(await whoAmI(parentCookie));
    await signIn(GUARDIAN);
    await attach(parentCookie, playerId, GUARDIAN);

    const token = lastToken();
    const flipped = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    expect((await app().request(`/guardians/confirm/${flipped}`)).status).toBe(404);

    const [link] = await harness.db
      .select()
      .from(guardianLink)
      .where(eq(guardianLink.playerId, playerId));
    expect(link!.consentGrantedAt).toBeNull();
  });

  test('an expired token records nothing and answers 404', async () => {
    const parentCookie = await signIn(PARENT);
    const playerId = await makePlayer(await whoAmI(parentCookie));
    await signIn(GUARDIAN);
    await attach(parentCookie, playerId, GUARDIAN);

    const [link] = await harness.db
      .select()
      .from(guardianLink)
      .where(eq(guardianLink.playerId, playerId));
    const expired = signConsentToken(link!.id, -60);
    expect((await app().request(`/guardians/confirm/${expired}`)).status).toBe(404);

    const [still] = await harness.db
      .select()
      .from(guardianLink)
      .where(eq(guardianLink.playerId, playerId));
    expect(still!.consentGrantedAt).toBeNull();
  });
});
