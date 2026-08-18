/**
 * ST-032. Focus verification against a real PostgreSQL: the window refusal,
 * per-stream scoping with a second player, the storage-and-reuse rule, the
 * one-stream focus, and the F13 paired case.
 *
 * Converting won positions is the workhorse focus here: one move_ply at +3.0
 * makes a game a won position, and the result decides whether it was
 * converted. The arithmetic itself is unit-tested; these exercise the queries,
 * the window, and the handler wiring.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { createAuth } from '../auth.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import { user } from '../db/auth-schema.ts';
import { focusCatalogue, game, movePly, playerFocus, subscription } from '../db/schema.ts';

let harness: IntegrationDatabase;

const PASSWORD = 'correct horse battery staple';
const EMAIL_A = 'alice@example.com';
const EMAIL_B = 'bob@example.com';

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  await harness.db
    .insert(user)
    .values({ id: 'user_owner', name: 'Owner', email: 'owner@example.com', emailVerified: true });
  await harness.db
    .insert(focusCatalogue)
    .values([
      {
        key: 'converting_won_positions',
        title: 'Converting won positions',
        description: 'Winning the games the position already says are won.',
        measureDescription: 'The share of won positions converted to wins.',
        measurableStreams: ['tournament', 'online'],
      },
      {
        key: 'time_management',
        title: 'Time management',
        description: 'Using the clock.',
        measureDescription: 'The move where time trouble begins.',
        measurableStreams: ['online'],
      },
    ])
    .onConflictDoNothing();
});

function app() {
  return createApp({
    db: harness.db,
    auth: createAuth(harness.db, { mailer: { async sendConsentNotice() {} } }),
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

async function makePlayer(cookie: string): Promise<string> {
  const res = await app().request('/players', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ displayName: 'Player' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function catalogueId(key: string): Promise<string> {
  const [row] = await harness.db
    .select({ id: focusCatalogue.id })
    .from(focusCatalogue)
    .where(eq(focusCatalogue.key, key));
  return row!.id;
}

async function seedFocus(
  playerId: string,
  fields: Partial<typeof playerFocus.$inferInsert>,
): Promise<string> {
  const [row] = await harness.db
    .insert(playerFocus)
    .values({ playerId, source: 'self', ...fields })
    .returning({ id: playerFocus.id });
  return row!.id;
}

let seq = 0;
/** One analysed game that reached +3.0 as white, won or lost. */
async function seedConvertedGame(
  playerId: string,
  fields: {
    stream: 'tournament' | 'online';
    playedAt: Date;
    won: boolean;
    analyzedAt?: Date;
    timeControl?: string;
  },
): Promise<string> {
  const [row] = await harness.db
    .insert(game)
    .values({
      playerId,
      stream: fields.stream,
      source: 'chesscom',
      pgnHash: `h_${seq++}`,
      pgn: '[Result "1-0"]\n\n1. e4 e5 1-0',
      result: fields.won ? '1-0' : '0-1',
      playerColor: 'white',
      playedAt: fields.playedAt,
      timeControl: fields.timeControl ?? null,
      analyzedAt: fields.analyzedAt ?? new Date('2026-08-01T00:00:00Z'),
      analysisStatus: 'complete',
    })
    .returning({ id: game.id });
  await harness.db.insert(movePly).values({
    gameId: row!.id,
    ply: 1,
    san: 'e4',
    uci: 'e2e4',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    evalCp: 300,
  });
  return row!.id;
}

async function getFocus(cookie: string, playerId: string): Promise<Record<string, unknown>> {
  const res = await app().request(`/players/${playerId}/focus`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const d = (s: string): Date => new Date(`${s}T12:00:00Z`);
const STARTED = d('2026-08-15');

describe('focus verification', () => {
  test('below the window floor the trend is insufficient_evidence with the count stated', async () => {
    const cookie = await signIn(EMAIL_A);
    const playerId = await makePlayer(cookie);
    await seedFocus(playerId, {
      catalogueId: await catalogueId('converting_won_positions'),
      startedAt: STARTED,
    });

    for (let i = 1; i <= 5; i++) {
      await seedConvertedGame(playerId, {
        stream: 'tournament',
        playedAt: d(`2026-08-${15 + i}`),
        won: true,
      });
    }

    const body = await getFocus(cookie, playerId);
    const measurements = body.measurements as Array<Record<string, unknown>>;
    const tournament = measurements.find((m) => m.stream === 'tournament')!;
    expect(tournament.trend).toBe('insufficient_evidence');
    expect(tournament.windowGames).toBe(5);
    expect(tournament.baselineValue).toBeNull();
    expect(tournament.currentValue).toBeNull();
  });

  test('a converting trend is scoped to the player and the stream', async () => {
    const cookieA = await signIn(EMAIL_A);
    const playerA = await makePlayer(cookieA);
    const cookieB = await signIn(EMAIL_B);
    const playerB = await makePlayer(cookieB);

    await seedFocus(playerA, {
      catalogueId: await catalogueId('converting_won_positions'),
      startedAt: STARTED,
    });

    // A: 10 baseline games all failed conversions, 10 current all converted.
    for (let i = 1; i <= 10; i++) {
      await seedConvertedGame(playerA, {
        stream: 'tournament',
        playedAt: d(`2026-07-${String(i).padStart(2, '0')}`),
        won: false,
      });
    }
    for (let i = 1; i <= 10; i++) {
      await seedConvertedGame(playerA, {
        stream: 'tournament',
        playedAt: d(`2026-08-${15 + i}`),
        won: true,
      });
    }
    // B's games must never enter A's window.
    for (let i = 1; i <= 10; i++) {
      await seedConvertedGame(playerB, {
        stream: 'tournament',
        playedAt: d(`2026-08-${15 + i}`),
        won: false,
      });
    }

    const body = await getFocus(cookieA, playerA);
    const measurements = body.measurements as Array<Record<string, unknown>>;
    const tournament = measurements.find((m) => m.stream === 'tournament')!;
    expect(tournament.windowGames).toBe(10);
    expect(tournament.baselineValue).toBeCloseTo(0);
    expect(tournament.currentValue).toBeCloseTo(1);
    expect(tournament.trend).toBe('improving');
  });

  test('a stored measurement is reused until new analysis changes the evidence', async () => {
    const cookie = await signIn(EMAIL_A);
    const playerId = await makePlayer(cookie);
    await seedFocus(playerId, {
      catalogueId: await catalogueId('converting_won_positions'),
      startedAt: STARTED,
    });

    for (let i = 1; i <= 10; i++) {
      await seedConvertedGame(playerId, {
        stream: 'tournament',
        playedAt: d(`2026-07-${String(i).padStart(2, '0')}`),
        won: true,
      });
    }
    for (let i = 1; i <= 10; i++) {
      await seedConvertedGame(playerId, {
        stream: 'tournament',
        playedAt: d(`2026-08-${15 + i}`),
        won: true,
      });
    }

    const first = await getFocus(cookie, playerId);
    const firstMeasuredAt = (first.measurements as Array<Record<string, unknown>>).find(
      (m) => m.stream === 'tournament',
    )!.measuredAt;

    const second = await getFocus(cookie, playerId);
    const secondMeasuredAt = (second.measurements as Array<Record<string, unknown>>).find(
      (m) => m.stream === 'tournament',
    )!.measuredAt;
    expect(secondMeasuredAt).toBe(firstMeasuredAt);

    // A newly analysed game pushes the evidence past the stored measurement.
    await seedConvertedGame(playerId, {
      stream: 'tournament',
      playedAt: d('2026-08-30'),
      won: true,
      analyzedAt: new Date(Date.now() + 60_000),
    });

    const third = await getFocus(cookie, playerId);
    const thirdMeasuredAt = (third.measurements as Array<Record<string, unknown>>).find(
      (m) => m.stream === 'tournament',
    )!.measuredAt;
    expect(thirdMeasuredAt).not.toBe(firstMeasuredAt);
  });

  test('time management reports the online stream alone', async () => {
    const cookie = await signIn(EMAIL_A);
    const playerId = await makePlayer(cookie);
    await seedFocus(playerId, {
      catalogueId: await catalogueId('time_management'),
      startedAt: STARTED,
    });

    await seedConvertedGame(playerId, {
      stream: 'tournament',
      playedAt: d('2026-08-20'),
      won: true,
    });

    const body = await getFocus(cookie, playerId);
    const streams = (body.measurements as Array<Record<string, unknown>>).map((m) => m.stream);
    expect(streams).toEqual(['online']);
    expect((body.measurements as Array<Record<string, unknown>>)[0]!.trend).toBe(
      'insufficient_evidence',
    );
  });

  test('an unverifiable coach instruction reports the paired focus trend', async () => {
    const cookie = await signIn(EMAIL_A);
    const playerId = await makePlayer(cookie);
    const pairedId = await catalogueId('converting_won_positions');
    await seedFocus(playerId, {
      catalogueId: null,
      coachInstruction: 'Convert your won positions.',
      pairedFocusId: pairedId,
      source: 'coach',
      startedAt: STARTED,
    });

    for (let i = 1; i <= 10; i++) {
      await seedConvertedGame(playerId, {
        stream: 'tournament',
        playedAt: d(`2026-07-${String(i).padStart(2, '0')}`),
        won: true,
      });
    }
    for (let i = 1; i <= 10; i++) {
      await seedConvertedGame(playerId, {
        stream: 'tournament',
        playedAt: d(`2026-08-${15 + i}`),
        won: true,
      });
    }

    const body = await getFocus(cookie, playerId);
    expect(body.unverified).toBe(true);
    expect(body.catalogue).toBeNull();
    expect(body.pairedFocusId).toBe(pairedId);
    const tournament = (body.measurements as Array<Record<string, unknown>>).find(
      (m) => m.stream === 'tournament',
    )!;
    expect(tournament.windowGames).toBe(10);
    expect(tournament.trend).toBe('flat');
  });

  test('the online window counts blitz games only, excluding bullet', async () => {
    const cookie = await signIn(EMAIL_A);
    const playerId = await makePlayer(cookie);
    await seedFocus(playerId, {
      catalogueId: await catalogueId('converting_won_positions'),
      startedAt: STARTED,
    });

    for (let i = 1; i <= 10; i++) {
      await seedConvertedGame(playerId, {
        stream: 'online',
        playedAt: d(`2026-07-${String(i).padStart(2, '0')}`),
        won: true,
        timeControl: '180+0',
      });
    }
    for (let i = 1; i <= 9; i++) {
      await seedConvertedGame(playerId, {
        stream: 'online',
        playedAt: d(`2026-08-${15 + i}`),
        won: true,
        timeControl: '180+0',
      });
    }
    // The newest current game is bullet, and it must not enter the window.
    await seedConvertedGame(playerId, {
      stream: 'online',
      playedAt: d('2026-08-30'),
      won: true,
      timeControl: '60+0',
    });

    const body = await getFocus(cookie, playerId);
    const online = (body.measurements as Array<Record<string, unknown>>).find(
      (m) => m.stream === 'online',
    )!;
    expect(online.windowGames).toBe(9);
    expect(online.trend).toBe('insufficient_evidence');
  });
});
