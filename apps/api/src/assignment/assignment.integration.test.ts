/**
 * ST-117. The assignment link, end to end against a real session and
 * PostgreSQL.
 *
 * The share act's security properties are proven here rather than asserted:
 * the public read serves the payload and nothing else, revoked/expired/unknown
 * tokens are the same 404, another player cannot revoke, and confirming needs
 * a session and writes the focus through the F13 coach branch - instruction
 * verbatim, paired with a measurable focus, never standing alone.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { assignmentLink, focusCatalogue, playerFocus, subscription } from '../db/schema.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const KEY = 'converting_won_positions';
const INSTRUCTION = 'Stop dropping the thread in time pressure. 30 minutes a day.';

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await harness.db
    .insert(focusCatalogue)
    .values([
      {
        key: KEY,
        title: 'Converting won positions',
        description: 'Winning the games the position already says are won.',
        measureDescription: 'The rating leaked by boundary-crossing swings.',
        measurableStreams: ['tournament', 'online'],
      },
    ])
    .onConflictDoNothing();
});

function app() {
  return createApp({
    db: harness.db,
    auth: createAuth(harness.db, {
      mailer: { async sendConsentNotice() {}, async sendPasswordReset() {}, async sendNudge() {} },
    }),
  });
}

/** A session cookie, pro-tiered unless the test asks for the free tier. */
async function signIn(email: string, tier: 'pro' | 'beginner' = 'pro'): Promise<string> {
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
  const cookie = res.headers.get('set-cookie') as string;
  if (tier === 'pro') {
    const session = await a.request('/api/auth/get-session', { headers: { cookie } });
    const who = (await session.json()) as { session: { userId: string } };
    await harness.db.insert(subscription).values({ userId: who.session.userId, tier: 'pro' });
  }
  return cookie;
}

/** The id of the player the sign-up hook created for this account. */
async function playerIdFor(cookie: string): Promise<string> {
  const res = await app().request('/me', { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { player: { id: string } }).player.id;
}

async function createLink(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; token: string; url: string; expiresAt: string | null }> {
  const res = await app().request('/assignments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ catalogueKey: KEY, instruction: INSTRUCTION, ...overrides }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; token: string; url: string; expiresAt: string | null };
}

describe('the assignment link', () => {
  test('POST creates a link with a long token and the share URL', async () => {
    const cookie = await signIn('alice@example.com');

    const created = await createLink(cookie);
    expect(created.token.length).toBeGreaterThanOrEqual(32);
    expect(created.url).toBe(`http://localhost:3000/shared/assignments/${created.token}`);
    expect(created.expiresAt).toBeNull();
  });

  test('POST refuses a catalogue key that does not exist', async () => {
    const cookie = await signIn('alice@example.com');

    const res = await app().request('/assignments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ catalogueKey: 'no_such_focus', instruction: INSTRUCTION }),
    });
    expect(res.status).toBe(404);
  });

  test('the public read serves the payload and nothing else, without a session', async () => {
    const cookie = await signIn('alice@example.com');
    const { token } = await createLink(cookie);

    const shared = await app().request(`/shared/assignments/${token}`);
    expect(shared.status).toBe(200);
    const body = (await shared.json()) as Record<string, unknown>;
    // The whole payload. A key that is not one of these three is the token
    // granting something the story forbids.
    expect(Object.keys(body).sort()).toEqual(['focusDescription', 'focusTitle', 'instruction']);
    expect(body.focusTitle).toBe('Converting won positions');
    expect(body.focusDescription).toBe('Winning the games the position already says are won.');
    expect(body.instruction).toBe(INSTRUCTION);
  });

  test('revoked, expired, and unknown tokens are the same 404', async () => {
    const cookie = await signIn('alice@example.com');
    const { token, id } = await createLink(cookie);

    const del = await app().request(`/assignments/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(del.status).toBe(204);
    const revoked = await app().request(`/shared/assignments/${token}`);
    expect(revoked.status).toBe(404);
    const revokedBody = await revoked.json();

    // Expired: seed a link whose expiry has passed.
    const [expired] = await harness.db
      .insert(assignmentLink)
      .values({
        createdByPlayerId: await playerIdFor(cookie),
        catalogueId: (await harness.db.select().from(focusCatalogue).limit(1))[0]!.id,
        instruction: INSTRUCTION,
        token: 'e'.repeat(43),
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    const expiredRes = await app().request(`/shared/assignments/${expired!.token}`);
    expect(expiredRes.status).toBe(404);

    // Unknown token: same body as the others.
    const unknown = await app().request(`/shared/assignments/${'x'.repeat(43)}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual(revokedBody);
    expect(await expiredRes.json()).toEqual(revokedBody);
  });

  test('another player cannot revoke, the owner can', async () => {
    const alice = await signIn('alice@example.com');
    const { id } = await createLink(alice);

    const bob = await signIn('bob@example.com');
    const forbidden = await app().request(`/assignments/${id}`, {
      method: 'DELETE',
      headers: { cookie: bob },
    });
    expect(forbidden.status).toBe(403);

    const owner = await app().request(`/assignments/${id}`, {
      method: 'DELETE',
      headers: { cookie: alice },
    });
    expect(owner.status).toBe(204);
  });
});

describe('the assignment link list', () => {
  test('answers 401 without a session', async () => {
    const anon = await app().request('/assignments');
    expect(anon.status).toBe(401);
  });

  test('is empty before any link, lists a live link, and drops revoked and expired ones', async () => {
    const cookie = await signIn('alice@example.com');

    const empty = await app().request('/assignments', { headers: { cookie } });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    const { id, token } = await createLink(cookie);
    const listed = await app().request('/assignments', { headers: { cookie } });
    expect(listed.status).toBe(200);
    const rows = (await listed.json()) as Array<{ id: string; token: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, token });

    await app().request(`/assignments/${id}`, { method: 'DELETE', headers: { cookie } });
    await harness.db
      .insert(assignmentLink)
      .values({
        createdByPlayerId: await playerIdFor(cookie),
        catalogueId: (await harness.db.select().from(focusCatalogue).limit(1))[0]!.id,
        instruction: INSTRUCTION,
        token: 'e'.repeat(43),
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    const after = await app().request('/assignments', { headers: { cookie } });
    expect(await after.json()).toEqual([]);
  });
});

describe('confirming an assignment', () => {
  test('sets the active focus through the F13 coach branch and ends the previous one', async () => {
    const cookie = await signIn('alice@example.com');
    await app().request('/focus', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ source: 'self', catalogueKey: KEY }),
    });
    const { token } = await createLink(cookie);

    const confirmed = await app().request(`/shared/assignments/${token}/confirm`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(confirmed.status).toBe(204);
    // AC 5: the confirmation response carries nothing else.
    expect(await confirmed.text()).toBe('');

    const focusRes = await app().request('/focus', { headers: { cookie } });
    expect(focusRes.status).toBe(200);
    const focus = (await focusRes.json()) as {
      source: string;
      catalogue: unknown;
      coachInstruction: string | null;
      unverified: boolean;
      pairedFocusId: string | null;
    };
    expect(focus.source).toBe('coach');
    expect(focus.coachInstruction).toBe(INSTRUCTION);
    expect(focus.unverified).toBe(true);
    // An unmeasurable instruction never stands alone: the catalogue is null
    // and the measurable focus it pairs with is the link's.
    expect(focus.catalogue).toBeNull();
    expect(focus.pairedFocusId).not.toBeNull();

    const rows = await harness.db.select().from(playerFocus);
    const active = rows.filter((row) => row.endedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]!.coachInstruction).toBe(INSTRUCTION);
    expect(active[0]!.source).toBe('coach');
    expect(active[0]!.catalogueId).toBeNull();
    expect(rows).toHaveLength(2);
  });

  test('refuses a dead link with the same honest 404, not a 500', async () => {
    const cookie = await signIn('alice@example.com');
    const { token, id } = await createLink(cookie);
    await app().request(`/assignments/${id}`, { method: 'DELETE', headers: { cookie } });

    const confirmed = await app().request(`/shared/assignments/${token}/confirm`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(confirmed.status).toBe(404);
    expect(await confirmed.json()).toEqual({
      code: 'not_found',
      message: 'No such assignment, or it was revoked or has expired.',
    });
  });

  test('refuses when the named focus was retired after the link was made', async () => {
    const cookie = await signIn('alice@example.com');
    const { token } = await createLink(cookie);
    await harness.db
      .update(focusCatalogue)
      .set({ retiredAt: new Date() })
      .where(eq(focusCatalogue.key, KEY));

    const confirmed = await app().request(`/shared/assignments/${token}/confirm`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(confirmed.status).toBe(404);
  });

  test('a beginner account is refused the confirm like every paid route', async () => {
    const maker = await signIn('alice@example.com');
    const { token } = await createLink(maker);
    const cookie = await signIn('bob@example.com', 'beginner');

    const confirmed = await app().request(`/shared/assignments/${token}/confirm`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(confirmed.status).toBe(403);
    expect(await confirmed.json()).toMatchObject({ code: 'upgrade_required' });
  });
});
