/**
 * The nudge run against a real database, and the unsubscribe route through the
 * real app. The failure this catches is a selection rule that selects the
 * wrong account - a fresh importer nudged, an unsubscribed account emailed -
 * and no stand-in can catch that, so the boundaries run against PostgreSQL.
 *
 * The boundaries all live in SQL (`now()` is the database's clock), so the
 * seeds are dated relative to real time at day-scale margins: a test that
 * runs at 13:00 or 13:05 seeds the same truth. The continuation queue runs
 * against LocalStack like the analysis queue's suite, skipped when
 * `AWS_ENDPOINT_URL` is unset, because without it the SDK talks to real AWS.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq, gt } from 'drizzle-orm';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { createApp } from '../app.ts';
import { localstackClientOptions } from '../localstack.ts';
import { game, nudgeSend, player } from '../db/schema.ts';
import { session, user } from '../db/auth-schema.ts';
import { setupIntegrationDatabase, type IntegrationDatabase } from '../db/test-harness.ts';
import type { Mailer } from '../account/mailer.ts';
import { CONTINUATION_BODY, type NudgeQueueConfig } from './queue.ts';
import { handler, type RunDeps } from './run.ts';
import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.ts';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

let harness: IntegrationDatabase;

beforeAll(async () => {
  harness = await setupIntegrationDatabase();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

interface SeedSpec {
  id?: string;
  email?: string;
  games?: Array<{ stream: 'tournament' | 'online'; importedAt: Date }>;
  lastSignIn?: Date;
  nudgedAt?: Date[];
  unsubscribedAt?: Date;
}

let seq = 0;

/** One user, one player, and whatever games, sign-in, and history the spec says. */
async function seedAccount(spec: SeedSpec): Promise<string> {
  seq += 1;
  const userId = spec.id ?? `user_${String(seq).padStart(3, '0')}`;
  const email = spec.email ?? `${userId}@example.com`;
  await harness.db.insert(user).values({ id: userId, name: 'Player', email, emailVerified: true });
  const [p] = await harness.db
    .insert(player)
    .values({
      ownerUserId: userId,
      displayName: 'Player',
      ...(spec.unsubscribedAt !== undefined ? { nudgeUnsubscribedAt: spec.unsubscribedAt } : {}),
    })
    .returning({ id: player.id });
  const playerId = p!.id;
  let gameSeq = 0;
  for (const g of spec.games ?? []) {
    gameSeq += 1;
    await harness.db.insert(game).values({
      playerId,
      stream: g.stream,
      source: 'pgn_upload',
      pgnHash: `hash_${userId}_${gameSeq}`,
      pgn: '[Event "Test"]\n\n1. e4 e5 *',
      result: '1-0',
      importedAt: g.importedAt,
    });
  }
  if (spec.lastSignIn !== undefined) {
    await harness.db.insert(session).values({
      id: `session_${userId}`,
      token: `token_${userId}`,
      userId,
      expiresAt: new Date(Date.now() + DAY),
      createdAt: spec.lastSignIn,
    });
  }
  for (const sentAt of spec.nudgedAt ?? []) {
    await harness.db.insert(nudgeSend).values({ userId, email, sentAt });
  }
  return userId;
}

interface NudgeCall {
  to: string;
  importUrl: string;
  unsubscribeUrl: string;
}

function fakeMailer(failFor: readonly string[] = []): Mailer & { calls: NudgeCall[] } {
  const calls: NudgeCall[] = [];
  return {
    calls,
    async sendConsentNotice() {},
    async sendPasswordReset() {},
    sendNudge(input): Promise<void> {
      if (failFor.includes(input.to)) return Promise.reject(new Error('provider refused the send'));
      calls.push(input);
      return Promise.resolve();
    },
  };
}

function depsFor(
  mailer: Mailer & { calls: NudgeCall[] },
  queueConfig: NudgeQueueConfig | null = null,
): RunDeps {
  return { db: harness.db, mailer, appOrigin: 'http://localhost:3000', queueConfig };
}

/**
 * The user ids this run sent to: send-log rows written in the last ten
 * minutes, which excludes the seeded ledger history the budget tests plant
 * hours back. The run stamps `sent_at` from the database's clock, so the
 * ten-minute margin is enormously wider than any clock skew.
 */
async function sentUserIds(): Promise<string[]> {
  const rows = await harness.db
    .select({ userId: nudgeSend.userId })
    .from(nudgeSend)
    .where(gt(nudgeSend.sentAt, new Date(Date.now() - 10 * 60 * 1000)));
  return rows.map((row) => row.userId).sort();
}

describe('nudge selection', () => {
  test('sends to an account with a stored game, a stale tournament import, and a live sign-in', async () => {
    await seedAccount({
      games: [{ stream: 'tournament', importedAt: ago(30) }],
      lastSignIn: ago(1),
    });

    await handler({}, depsFor(fakeMailer()));

    expect(await sentUserIds()).toHaveLength(1);
  });

  test('never emails an account with zero games', async () => {
    await seedAccount({ lastSignIn: ago(1) });

    await handler({}, depsFor(fakeMailer()));

    expect(await sentUserIds()).toEqual([]);
  });

  test('does not email an account that imported a tournament game this week', async () => {
    await seedAccount({
      games: [
        { stream: 'tournament', importedAt: ago(2) },
        { stream: 'tournament', importedAt: ago(30) },
      ],
      lastSignIn: ago(1),
    });

    await handler({}, depsFor(fakeMailer()));

    expect(await sentUserIds()).toEqual([]);
  });

  test('emails an account whose recency is online-only: the stream that went quiet is tournament', async () => {
    await seedAccount({
      games: [
        { stream: 'tournament', importedAt: ago(10) },
        { stream: 'online', importedAt: ago(2) },
      ],
      lastSignIn: ago(1),
    });

    await handler({}, depsFor(fakeMailer()));

    expect(await sentUserIds()).toHaveLength(1);
  });

  test('does not email an account whose last sign-in is older than 30 days', async () => {
    await seedAccount({
      games: [{ stream: 'tournament', importedAt: ago(30) }],
      lastSignIn: ago(31),
    });

    await handler({}, depsFor(fakeMailer()));

    expect(await sentUserIds()).toEqual([]);
  });

  test('does not email an unsubscribed account', async () => {
    await seedAccount({
      games: [{ stream: 'tournament', importedAt: ago(30) }],
      lastSignIn: ago(1),
      unsubscribedAt: ago(1),
    });

    await handler({}, depsFor(fakeMailer()));

    expect(await sentUserIds()).toEqual([]);
  });

  test('does not email an account nudged within the week', async () => {
    await seedAccount({
      games: [{ stream: 'tournament', importedAt: ago(30) }],
      lastSignIn: ago(1),
      nudgedAt: [ago(3)],
    });

    await handler({}, depsFor(fakeMailer()));

    expect(await sentUserIds()).toEqual([]);
  });

  test('emails again once the last nudge is older than a week', async () => {
    await seedAccount({
      games: [{ stream: 'tournament', importedAt: ago(30) }],
      lastSignIn: ago(1),
      nudgedAt: [ago(8)],
    });

    await handler({}, depsFor(fakeMailer()));

    expect(await sentUserIds()).toHaveLength(1);
  });
});

describe('nudge pacing', () => {
  test("sends at most 90 per run, and the link carries the account's own token", async () => {
    for (let i = 0; i < 91; i++) {
      await seedAccount({
        games: [{ stream: 'tournament', importedAt: ago(30) }],
        lastSignIn: ago(1),
      });
    }
    const mailer = fakeMailer();

    await handler({}, depsFor(mailer));

    expect(mailer.calls).toHaveLength(90);
    expect(await sentUserIds()).toHaveLength(90);
    const link = new URL(mailer.calls[0]!.unsubscribeUrl);
    expect(mailer.calls[0]!.importUrl).toBe('http://localhost:3000/import');
    expect(link.pathname.startsWith('/nudge/unsubscribe/')).toBe(true);
    const token = link.pathname.split('/').at(-1)!;
    expect(verifyUnsubscribeToken(token)).toMatchObject({ ok: true });
  });

  test('spends the daily budget down to the consent headroom, then stops', async () => {
    // 95 sends in the last 24 hours: the budget for this run is 99 - 95 = 4,
    // so of ten eligible accounts exactly four hear from us today.
    for (let i = 0; i < 95; i++) {
      await seedAccount({ id: `ledger_${String(i).padStart(3, '0')}`, nudgedAt: [ago(0.5)] });
    }
    for (let i = 0; i < 10; i++) {
      await seedAccount({
        games: [{ stream: 'tournament', importedAt: ago(30) }],
        lastSignIn: ago(1),
      });
    }

    await handler({}, depsFor(fakeMailer()));

    expect(await sentUserIds()).toHaveLength(4);
  });

  test('sends nothing once the daily budget is spent', async () => {
    for (let i = 0; i < 100; i++) {
      await seedAccount({ id: `ledger_${String(i).padStart(3, '0')}`, nudgedAt: [ago(0.5)] });
    }
    for (let i = 0; i < 3; i++) {
      await seedAccount({
        games: [{ stream: 'tournament', importedAt: ago(30) }],
        lastSignIn: ago(1),
      });
    }
    const mailer = fakeMailer();

    await handler({}, depsFor(mailer));

    expect(mailer.calls).toEqual([]);
    expect(await sentUserIds()).toEqual([]);
  });
});

describe('nudge provider', () => {
  test('skips the week clean when the provider is unconfigured', async () => {
    await seedAccount({
      games: [{ stream: 'tournament', importedAt: ago(30) }],
      lastSignIn: ago(1),
    });

    await handler(
      {},
      { db: harness.db, mailer: null, appOrigin: 'http://localhost:3000', queueConfig: null },
    );

    expect(await sentUserIds()).toEqual([]);
  });

  test('continues past a per-recipient failure, and does not log the failure as a send', async () => {
    await seedAccount({
      email: 'good@example.com',
      games: [{ stream: 'tournament', importedAt: ago(30) }],
      lastSignIn: ago(1),
    });
    await seedAccount({
      email: 'bad@example.com',
      games: [{ stream: 'tournament', importedAt: ago(30) }],
      lastSignIn: ago(1),
    });

    await handler({}, depsFor(fakeMailer(['bad@example.com'])));

    expect(await sentUserIds()).toHaveLength(1);
  });
});

describe('nudge continuation queue', () => {
  const endpoint = process.env.AWS_ENDPOINT_URL;
  const sqs = new SQSClient(endpoint ? { endpoint, ...localstackClientOptions } : {});
  const created: string[] = [];
  let config: NudgeQueueConfig;

  beforeAll(async () => {
    if (endpoint === undefined) return;
    const name = `kanso-nudge-test-${crypto.randomUUID()}`;
    const queue = await sqs.send(new CreateQueueCommand({ QueueName: name }));
    if (queue.QueueUrl === undefined) throw new Error('LocalStack did not return a queue url');
    created.push(queue.QueueUrl);
    config = { queueUrl: queue.QueueUrl, endpoint };
  });

  afterAll(async () => {
    for (const url of created) {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));
    }
  });

  /** Receive until nothing more arrives; SQS returns messages a few at a time. */
  async function drain(): Promise<string[]> {
    const bodies: string[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const received = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: config.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );
      if (received.Messages === undefined || received.Messages.length === 0) break;
      for (const message of received.Messages) bodies.push(message.Body ?? '');
    }
    return bodies;
  }

  test.skipIf(endpoint === undefined)(
    'enqueues exactly one continuation when the page is full',
    async () => {
      for (let i = 0; i < 91; i++) {
        await seedAccount({
          games: [{ stream: 'tournament', importedAt: ago(30) }],
          lastSignIn: ago(1),
        });
      }

      await handler({}, depsFor(fakeMailer(), config));

      expect(await drain()).toEqual([CONTINUATION_BODY]);
    },
  );

  test.skipIf(endpoint === undefined)('enqueues nothing when the page is not full', async () => {
    for (let i = 0; i < 5; i++) {
      await seedAccount({
        games: [{ stream: 'tournament', importedAt: ago(30) }],
        lastSignIn: ago(1),
      });
    }

    await handler({}, depsFor(fakeMailer(), config));

    expect(await drain()).toEqual([]);
  });

  test.skipIf(endpoint === undefined)(
    'enqueues nothing when every send failed: next Sunday is the retry',
    async () => {
      await seedAccount({
        id: 'failing_a',
        games: [{ stream: 'tournament', importedAt: ago(30) }],
        lastSignIn: ago(1),
      });
      await seedAccount({
        id: 'failing_b',
        games: [{ stream: 'tournament', importedAt: ago(30) }],
        lastSignIn: ago(1),
      });

      await handler(
        {},
        depsFor(fakeMailer(['failing_a@example.com', 'failing_b@example.com']), config),
      );

      expect(await drain()).toEqual([]);
      expect(await sentUserIds()).toEqual([]);
    },
  );

  test.skipIf(endpoint === undefined)(
    'acknowledges a foreign message by ignoring it rather than looping on it',
    async () => {
      await handler({ Records: [{ body: 'not-a-continuation' }] }, depsFor(fakeMailer(), config));

      expect(await drain()).toEqual([]);
      expect(await sentUserIds()).toEqual([]);
    },
  );
});

describe('nudge unsubscribe route', () => {
  beforeAll(() => {
    process.env.BETTER_AUTH_SECRET ??= 'test-nudge-signing-secret';
  });

  function app() {
    return createApp({ db: harness.db, getSession: () => null });
  }

  test('sets the flag for a valid token', async () => {
    const userId = await seedAccount({});

    const res = await app().request(`/nudge/unsubscribe/${signUnsubscribeToken(userId)}`);

    expect(res.status).toBe(204);
    const [row] = await harness.db
      .select({ at: player.nudgeUnsubscribedAt })
      .from(player)
      .where(eq(player.ownerUserId, userId));
    expect(row!.at).not.toBeNull();
  });

  test('answers a repeat click with 204 and no second write', async () => {
    const userId = await seedAccount({});
    const first = await app().request(`/nudge/unsubscribe/${signUnsubscribeToken(userId)}`);
    expect(first.status).toBe(204);

    const second = await app().request(`/nudge/unsubscribe/${signUnsubscribeToken(userId)}`);

    expect(second.status).toBe(204);
    const rows = await harness.db
      .select({ at: player.nudgeUnsubscribedAt })
      .from(player)
      .where(eq(player.ownerUserId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.at).not.toBeNull();
  });

  test('answers 404 for a tampered token', async () => {
    const userId = await seedAccount({});

    const res = await app().request(`/nudge/unsubscribe/${signUnsubscribeToken(userId)}x`);

    expect(res.status).toBe(404);
  });

  test('answers 404 for an expired token', async () => {
    const userId = await seedAccount({});

    const res = await app().request(`/nudge/unsubscribe/${signUnsubscribeToken(userId, -1)}`);

    expect(res.status).toBe(404);
  });

  test('answers 404 for a token naming an account with no player', async () => {
    const res = await app().request(`/nudge/unsubscribe/${signUnsubscribeToken('user_absent')}`);

    expect(res.status).toBe(404);
  });
});
