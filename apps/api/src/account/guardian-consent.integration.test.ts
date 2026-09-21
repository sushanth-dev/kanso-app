/**
 * ST-034. Minor self-sign-up and guardian consent, exercised end to end against
 * a real PostgreSQL with a fake mailer: a minor signs up with a date of birth
 * and a guardian email, the notice is mailed with a signed token, the gate
 * blocks the minor until the token is confirmed, and confirming records consent
 * exactly once. The fake mailer keeps this suite off the provider; the real
 * sender's request shape is covered by `mailer.test.ts`.
 *
 * ST-176 adds the analytics suite's own account-state matrix here, because the
 * suite and the consent workflow answer the age question through one threshold
 * and must not drift apart.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { guardianConsent } from '../db/schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { signConsentToken } from './consent-token.ts';
import type { Mailer } from './mailer.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const MINOR = 'minor@example.com';
const GUARDIAN = 'parent@example.com';
/** A date of birth under 13, and one that is not. */
const MINOR_DOB = '2015-06-01';
const ADULT_DOB = '2000-06-01';

const sent: Array<{ to: string; confirmUrl: string }> = [];
const mailer: Mailer = {
  sendConsentNotice(input) {
    sent.push(input);
    return Promise.resolve();
  },
  async sendPasswordReset() {},
  async sendNudge() {},
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
  return createApp({ db: harness.db, auth: createAuth(harness.db, { mailer }) });
}

/** Sign up and return the response, whose `set-cookie` is the session. */
async function signUp(
  email: string,
  dateOfBirth?: string,
  guardianEmail?: string,
): Promise<Response> {
  return app().request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: email.split('@')[0],
      email,
      password: PASSWORD,
      dateOfBirth,
      guardianEmail,
    }),
  });
}

function cookieOf(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  return setCookie as string;
}

async function whoAmI(cookie: string): Promise<string> {
  const res = await app().request('/api/auth/get-session', { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { session: { userId: string } };
  expect(body.session).toBeTruthy();
  return body.session.userId;
}

async function consentFor(userId: string) {
  const [row] = await harness.db
    .select()
    .from(guardianConsent)
    .where(eq(guardianConsent.userId, userId));
  return row;
}

/** The token carried in the most recent notice the fake mailer recorded. */
function lastToken(): string {
  const { confirmUrl } = sent[sent.length - 1]!;
  return confirmUrl.slice(confirmUrl.lastIndexOf('/') + 1);
}

describe('minor self-sign-up and guardian consent', () => {
  test('a minor with a guardian email signs up, mails a notice, and is gated', async () => {
    const res = await signUp(MINOR, MINOR_DOB, GUARDIAN);
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    const userId = await whoAmI(cookie);

    const consent = await consentFor(userId);
    expect(consent).toBeTruthy();
    expect(consent!.consentGrantedAt).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(GUARDIAN);

    const me = await app().request('/me', { headers: { cookie } });
    expect(me.status).toBe(403);
    expect(await me.json()).toMatchObject({ code: 'consent_required' });
  });

  test('confirming through the link records consent once and lifts the gate', async () => {
    const res = await signUp(MINOR, MINOR_DOB, GUARDIAN);
    const cookie = cookieOf(res);
    const token = lastToken();

    expect((await app().request(`/guardians/confirm/${token}`)).status).toBe(204);
    // Idempotent: a replayed confirm is a no-op.
    expect((await app().request(`/guardians/confirm/${token}`)).status).toBe(204);

    const consent = await consentFor(await whoAmI(cookie));
    expect(consent!.consentGrantedAt).not.toBeNull();
    expect(consent!.consentMethod).toBe('email');

    expect((await app().request('/me', { headers: { cookie } })).status).toBe(200);
  });

  test('a minor without a guardian email is refused at sign-up', async () => {
    const res = await signUp(MINOR, MINOR_DOB);
    expect(res.status).not.toBe(200);
    expect(sent).toHaveLength(0);
  });

  test('a guardian email that equals the sign-up email is refused', async () => {
    const res = await signUp(MINOR, MINOR_DOB, MINOR);
    expect(res.status).not.toBe(200);
    expect(sent).toHaveLength(0);
  });

  test('an adult signs up with no consent request and is not gated', async () => {
    const res = await signUp('adult@example.com', ADULT_DOB);
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);

    expect(await consentFor(await whoAmI(cookie))).toBeUndefined();
    expect(sent).toHaveLength(0);

    expect((await app().request('/me', { headers: { cookie } })).status).toBe(200);
  });

  test('a tampered or expired token records nothing and answers 404', async () => {
    const res = await signUp(MINOR, MINOR_DOB, GUARDIAN);
    const userId = await whoAmI(cookieOf(res));
    const consent = await consentFor(userId);
    expect(consent).toBeTruthy();

    expect((await app().request(`/guardians/confirm/${lastToken()}x`)).status).toBe(404);

    const expired = signConsentToken(consent!.id, -60);
    expect((await app().request(`/guardians/confirm/${expired}`)).status).toBe(404);

    expect((await consentFor(userId))!.consentGrantedAt).toBeNull();
  });
});

/**
 * ST-176. The account-state matrix behind the analytics gate, one row per state an
 * account can be in. The suite's automatic capture rides `/me`'s
 * `analyticsSuiteAllowed`, so each row reads that field: the consent workflow and
 * the analytics suite must agree about who is a child, and must diverge in exactly
 * one place, the account that has stated no age.
 */
describe('the analytics suite gate', () => {
  async function suiteState(cookie: string): Promise<Response> {
    return app().request('/me', { headers: { cookie } });
  }

  async function suiteAllowed(cookie: string): Promise<boolean> {
    const res = await suiteState(cookie);
    expect(res.status).toBe(200);
    return ((await res.json()) as { analyticsSuiteAllowed: boolean }).analyticsSuiteAllowed;
  }

  test('a stated adult gets the suite', async () => {
    const res = await signUp('adult@example.com', ADULT_DOB);
    expect(res.status).toBe(200);

    expect(await suiteAllowed(cookieOf(res))).toBe(true);
  });

  test('a stated minor whose guardian has consented gets the suite', async () => {
    const res = await signUp(MINOR, MINOR_DOB, GUARDIAN);
    const cookie = cookieOf(res);

    expect((await app().request(`/guardians/confirm/${lastToken()}`)).status).toBe(204);

    expect(await suiteAllowed(cookie)).toBe(true);
  });

  test('a stated minor pending consent is refused /me, so the browser keeps the suite off', async () => {
    const res = await signUp(MINOR, MINOR_DOB, GUARDIAN);

    // No field is readable at all here: /me is behind the consent guard, and the
    // browser starts from off and only an explicit true switches it on, so a
    // refused read leaves the suite off rather than defaulting it on.
    const me = await suiteState(cookieOf(res));
    expect(me.status).toBe(403);
    expect(await me.json()).toMatchObject({ code: 'consent_required' });
  });

  test('an account that has stated no age gets no suite', async () => {
    const res = await signUp('noage@example.com');
    expect(res.status).toBe(200);

    expect(await suiteAllowed(cookieOf(res))).toBe(false);
  });
});
