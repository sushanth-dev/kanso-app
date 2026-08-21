/**
 * ST-031. The focus catalogue and one active focus, against a real session and
 * a real PostgreSQL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { focusCatalogue, playerFocus, subscription } from '../db/schema.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const EMAIL_A = 'alice@example.com';

const KEY = 'converting_won_positions';
const KEY_B = 'tactical_alertness';

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await seedCatalogue();
});

async function seedCatalogue(): Promise<void> {
  await harness.db
    .insert(focusCatalogue)
    .values([
      {
        key: KEY,
        title: 'Converting won positions',
        description: 'Winning the games the position already says are won.',
        measureDescription:
          'The rating leaked by evaluation swings that crossed a result boundary.',
        measurableStreams: ['tournament', 'online'],
      },
      {
        key: KEY_B,
        title: 'Tactical alertness',
        description: 'Spotting the tactical motifs a position offers.',
        measureDescription: 'The tactical motifs missed.',
        measurableStreams: ['tournament', 'online'],
      },
    ])
    .onConflictDoNothing();
}

function app() {
  return createApp({
    db: harness.db,
    auth: createAuth(harness.db, {
      mailer: { async sendConsentNotice() {}, async sendPasswordReset() {} },
    }),
  });
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
  const setCookie = res.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  const cookie = setCookie as string;
  // ST-044. Focus and proof sheets are paid surfaces; grant the tier.
  const session = await a.request('/api/auth/get-session', { headers: { cookie } });
  const who = (await session.json()) as { session: { userId: string } };
  await harness.db.insert(subscription).values({ userId: who.session.userId, tier: 'paid' });
  return cookie;
}

/** The id of the player the sign-up hook created for this account. */
async function playerIdFor(cookie: string): Promise<string> {
  const res = await app().request('/me', { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { player: { id: string } }).player.id;
}

function setFocusBody(catalogueKey: string): string {
  return JSON.stringify({ source: 'self', catalogueKey });
}

describe('the focus catalogue and one active focus', () => {
  test('GET /focuses lists the catalogue with version on every row', async () => {
    const cookie = await signIn(EMAIL_A);
    const res = await app().request('/focuses', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ key: string; version: number }>;
    expect(body.map((e) => e.key)).toContain(KEY);
    expect(body.map((e) => e.key)).toContain(KEY_B);
    expect(body.every((e) => typeof e.version === 'number')).toBe(true);
  });

  test('setting a focus and reading it back', async () => {
    const cookie = await signIn(EMAIL_A);

    const set = await app().request('/focus', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: setFocusBody(KEY),
    });
    expect(set.status).toBe(200);
    const setBody = (await set.json()) as {
      id: string;
      catalogue: { key: string } | null;
      unverified: boolean;
    };
    expect(setBody.catalogue?.key).toBe(KEY);
    expect(setBody.unverified).toBe(false);

    const get = await app().request('/focus', { headers: { cookie } });
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as { id: string };
    expect(getBody.id).toBe(setBody.id);
  });

  test('replacing a focus ends the previous one', async () => {
    const cookie = await signIn(EMAIL_A);
    const playerId = await playerIdFor(cookie);

    const first = await app().request('/focus', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: setFocusBody(KEY),
    });
    const firstBody = (await first.json()) as { id: string };

    const second = await app().request('/focus', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: setFocusBody(KEY_B),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).not.toBe(firstBody.id);

    const rows = await harness.db
      .select()
      .from(playerFocus)
      .where(eq(playerFocus.playerId, playerId));
    expect(rows).toHaveLength(2);
    const active = rows.filter((r) => r.endedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(secondBody.id);
  });

  test('the database refuses a second active focus', async () => {
    const cookie = await signIn(EMAIL_A);
    const playerId = await playerIdFor(cookie);
    await app().request('/focus', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: setFocusBody(KEY),
    });

    await expect(
      harness.db.insert(playerFocus).values({ playerId, source: 'self' }),
    ).rejects.toThrow();
  });

  test('a coach instruction is stored verbatim, unverified, and paired', async () => {
    const cookie = await signIn(EMAIL_A);

    const res = await app().request('/focus', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        source: 'coach',
        coachInstruction: 'Work on seeing the tactics you miss.',
        pairedCatalogueKey: KEY_B,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      catalogue: { key: string } | null;
      coachInstruction: string | null;
      unverified: boolean;
      pairedFocusId: string | null;
    };
    expect(body.catalogue).toBeNull();
    expect(body.coachInstruction).toBe('Work on seeing the tactics you miss.');
    expect(body.unverified).toBe(true);
    expect(body.pairedFocusId).toBeTruthy();
  });

  test('a player with no active focus answers 404', async () => {
    const cookie = await signIn(EMAIL_A);

    const res = await app().request('/focus', { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  test('an unknown catalogue key answers 404', async () => {
    const cookie = await signIn(EMAIL_A);

    const res = await app().request('/focus', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: setFocusBody('nope'),
    });
    expect(res.status).toBe(404);
  });
});
