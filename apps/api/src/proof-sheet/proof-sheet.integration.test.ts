/**
 * ST-037. The proof sheet, end to end against a real session and PostgreSQL.
 *
 * The security properties are proven here rather than asserted: the snapshot is
 * frozen, the shared route answers without a session, revoked/expired/unknown
 * tokens are the same 404, and a second user's sheet answers 403.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { focusCatalogue, player, playerFocus, proofSheet, subscription } from '../db/schema.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const KEY = 'converting_won_positions';

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
  const cookie = res.headers.get('set-cookie') as string;
  // ST-044. Focus and proof sheets are paid surfaces; grant the tier.
  const session = await a.request('/api/auth/get-session', { headers: { cookie } });
  const who = (await session.json()) as { session: { userId: string } };
  await harness.db.insert(subscription).values({ userId: who.session.userId, tier: 'paid' });
  return cookie;
}

async function makePlayer(cookie: string, displayName: string): Promise<string> {
  const res = await app().request('/players', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ displayName }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function setFocus(cookie: string, playerId: string): Promise<void> {
  const res = await app().request(`/players/${playerId}/focus`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ source: 'self', catalogueKey: KEY }),
  });
  expect(res.status).toBe(200);
}

async function createSheet(
  cookie: string,
  playerId: string,
): Promise<{ id: string; token: string }> {
  const res = await app().request(`/players/${playerId}/proof-sheets`, {
    method: 'POST',
    headers: { cookie },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; token: string };
}

describe('the proof sheet', () => {
  test('POST composes a refusal sheet with no games, and the shared route serves it without a session', async () => {
    const cookie = await signIn('alice@example.com');
    const playerId = await makePlayer(cookie, 'Alice Player');
    await setFocus(cookie, playerId);

    const { token, id } = await createSheet(cookie, playerId);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(id).toBeTruthy();

    const shared = await app().request(`/shared/proof-sheets/${token}`);
    expect(shared.status).toBe(200);
    const sheet = (await shared.json()) as Record<string, unknown>;
    expect(sheet.trend).toBe('insufficient_evidence');
    expect(sheet.playerDisplayName).toBe('Alice Player');
    expect(sheet.focusTitle).toBe('Converting won positions');
    expect(sheet.beforeValue).toBeNull();
    expect(sheet.gamesAfter).toBe(0);
  });

  test('the snapshot is frozen: changing the source does not move the page', async () => {
    const cookie = await signIn('alice@example.com');
    const playerId = await makePlayer(cookie, 'Alice Player');
    await setFocus(cookie, playerId);
    const { token } = await createSheet(cookie, playerId);

    await harness.db.update(player).set({ displayName: 'Renamed' }).where(eq(player.id, playerId));

    const shared = await app().request(`/shared/proof-sheets/${token}`);
    expect(((await shared.json()) as { playerDisplayName: string }).playerDisplayName).toBe(
      'Alice Player',
    );
  });

  test('a player with no active focus gets 404', async () => {
    const cookie = await signIn('alice@example.com');
    const playerId = await makePlayer(cookie, 'Alice Player');

    const res = await app().request(`/players/${playerId}/proof-sheets`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });

  test('revoked, expired, and unknown tokens are the same 404', async () => {
    const cookie = await signIn('alice@example.com');
    const playerId = await makePlayer(cookie, 'Alice Player');
    await setFocus(cookie, playerId);
    const { token, id } = await createSheet(cookie, playerId);

    // Revoke it; the link stops working immediately.
    const del = await app().request(`/proof-sheets/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(del.status).toBe(204);
    const revoked = await app().request(`/shared/proof-sheets/${token}`);
    expect(revoked.status).toBe(404);
    const revokedBody = await revoked.json();

    // Expired: seed a sheet whose expiry has passed.
    const [focus] = await harness.db.select().from(playerFocus).limit(1);
    const [expired] = await harness.db
      .insert(proofSheet)
      .values({
        playerFocusId: focus!.id,
        token: 'e'.repeat(43),
        snapshot: {
          playerDisplayName: 'x',
          focusTitle: 'x',
          coachInstruction: null,
          stream: 'tournament',
          unit: 'u',
          beforeValue: null,
          afterValue: null,
          trend: 'insufficient_evidence',
          gamesBefore: 0,
          gamesAfter: 0,
          periodStart: '2026-01-01T00:00:00.000Z',
          periodEnd: '2026-01-01T00:00:00.000Z',
        },
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    const expiredRes = await app().request(`/shared/proof-sheets/${expired!.token}`);
    expect(expiredRes.status).toBe(404);

    // Unknown token: same body as the others.
    const unknown = await app().request(`/shared/proof-sheets/${'x'.repeat(43)}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual(revokedBody);
    expect(await expiredRes.json()).toEqual(revokedBody);
  });

  test("another player's sheet answers 403", async () => {
    const alice = await signIn('alice@example.com');
    const alicePlayer = await makePlayer(alice, 'Alice');
    await setFocus(alice, alicePlayer);
    const { id } = await createSheet(alice, alicePlayer);

    const bob = await signIn('bob@example.com');
    await makePlayer(bob, 'Bob');

    const res = await app().request(`/proof-sheets/${id}`, {
      method: 'DELETE',
      headers: { cookie: bob },
    });
    expect(res.status).toBe(403);
  });
});

describe('the proof sheet list', () => {
  test('answers 401 without a session and 403 for a player the session does not own', async () => {
    const alice = await signIn('alice@example.com');
    const alicePlayer = await makePlayer(alice, 'Alice');

    const anon = await app().request(`/players/${alicePlayer}/proof-sheets`);
    expect(anon.status).toBe(401);

    const bob = await signIn('bob@example.com');
    const res = await app().request(`/players/${alicePlayer}/proof-sheets`, {
      headers: { cookie: bob },
    });
    expect(res.status).toBe(403);
  });

  test('is empty before any sheet, lists a live sheet, and drops revoked and expired ones', async () => {
    const cookie = await signIn('alice@example.com');
    const playerId = await makePlayer(cookie, 'Alice');
    await setFocus(cookie, playerId);

    const empty = await app().request(`/players/${playerId}/proof-sheets`, {
      headers: { cookie },
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    const { id, token } = await createSheet(cookie, playerId);
    const listed = await app().request(`/players/${playerId}/proof-sheets`, {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    const rows = (await listed.json()) as Array<{
      id: string;
      token: string;
      revokedAt: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, token, revokedAt: null });

    await app().request(`/proof-sheets/${id}`, { method: 'DELETE', headers: { cookie } });
    const afterRevoke = await app().request(`/players/${playerId}/proof-sheets`, {
      headers: { cookie },
    });
    expect(await afterRevoke.json()).toEqual([]);

    const [focus] = await harness.db.select().from(playerFocus).limit(1);
    await harness.db
      .insert(proofSheet)
      .values({
        playerFocusId: focus!.id,
        token: 'e'.repeat(43),
        snapshot: {
          playerDisplayName: 'x',
          focusTitle: 'x',
          coachInstruction: null,
          stream: 'tournament',
          unit: 'u',
          beforeValue: null,
          afterValue: null,
          trend: 'insufficient_evidence',
          gamesBefore: 0,
          gamesAfter: 0,
          periodStart: '2026-01-01T00:00:00.000Z',
          periodEnd: '2026-01-01T00:00:00.000Z',
        },
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    const withExpired = await app().request(`/players/${playerId}/proof-sheets`, {
      headers: { cookie },
    });
    expect(await withExpired.json()).toEqual([]);
  });
});
