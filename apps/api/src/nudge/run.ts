/**
 * The weekly nudge run, and the continuation message that paces it (ST-126).
 *
 * One handler serves both triggers, discriminated by shape: the EventBridge
 * Scheduler event has no `Records`, an SQS delivery has them. Every invocation
 * re-selects from scratch, so a continuation is a re-run rather than a cursor:
 * accounts sent to already fall out through the send log, and the message
 * carries no state.
 *
 * AC 5: an unconfigured provider is a skipped week, not an incident - the run
 * logs and sends nothing. A per-recipient failure neither stops the run nor
 * enters the send log, so that account retries next week. A run where every
 * send failed enqueues no continuation; the next weekly run is the retry.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { resendConfigFromEnv, resendMailer, type Mailer } from '../account/mailer.ts';
import { APP_ORIGIN_DEFAULT } from '../account/consent-request.ts';
import * as schema from '../db/schema.ts';
import { nudgeSend } from '../db/schema.ts';
import { log } from '../logging.ts';
import {
  CONTINUATION_BODY,
  enqueueNudgeContinuation,
  nudgeQueueConfigFromEnv,
  type NudgeQueueConfig,
} from './queue.ts';
import { nudgeSendBudget, selectNudgeCandidates } from './select.ts';
import { signUnsubscribeToken } from './unsubscribe-token.ts';

type Db = PostgresJsDatabase<typeof schema>;

export interface RunDeps {
  db: Db;
  /** Null is the unconfigured provider: the run skips (AC 5). */
  mailer: Mailer | null;
  appOrigin: string;
  queueConfig: NudgeQueueConfig | null;
}

export function runDepsFromEnv(env: NodeJS.ProcessEnv = process.env): RunDeps {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. See .env.example.');
  }
  // Two connections: this run does one query and a batch of inserts, not
  // request traffic like the API's pool.
  const sql = postgres(databaseUrl, { max: 2 });
  const resendConfig = resendConfigFromEnv(env);
  return {
    db: drizzle(sql, { schema }),
    mailer: resendConfig === null ? null : resendMailer(resendConfig),
    appOrigin: env.APP_ORIGIN ?? APP_ORIGIN_DEFAULT,
    queueConfig: nudgeQueueConfigFromEnv(env),
  };
}

function isSqsEvent(event: unknown): event is { Records: { body: string }[] } {
  return (
    typeof event === 'object' &&
    event !== null &&
    'Records' in event &&
    Array.isArray(event.Records)
  );
}

/**
 * The production entry. One positional argument only: Lambda calls handlers
 * as (event, context), so an optional second "deps" parameter would receive
 * the context object and read a database out of it. Injection goes through
 * runFor.
 */
export async function handler(rawEvent: unknown): Promise<void> {
  await runFor(runDepsFromEnv(), rawEvent);
}

/** The injection seam the tests call: the same body, with explicit deps. The
 * event defaults to the empty schedule trigger; sqs events are passed whole. */
export async function runFor(deps: RunDeps, rawEvent: unknown = {}): Promise<void> {
  const records = isSqsEvent(rawEvent) ? rawEvent.Records : null;
  const trigger = records === null ? 'schedule' : 'sqs';
  const d = deps;
  if (d.mailer === null) {
    log('info', 'nudge_run_skipped', { trigger, reason: 'provider_unconfigured' });
    return;
  }

  if (records !== null) {
    // Only the continuation body is meaningful; a foreign message is
    // acknowledged by ignoring it rather than looping on it.
    const foreign = records.filter((record) => record.body !== CONTINUATION_BODY).length;
    if (foreign > 0) {
      log('warn', 'nudge_unexpected_message', { count: foreign });
    }
  }

  const budget = await nudgeSendBudget(d.db);
  if (budget <= 0) {
    // The daily cap is spent. The remainder waits for next Sunday: sent
    // accounts are excluded for 7 days, so the never-sent stand first in
    // line.
    log('info', 'nudge_run_budget_exhausted', { trigger });
    return;
  }

  // A full page proves a remainder exists (AC 3: the rest re-enqueues).
  const candidates = await selectNudgeCandidates(d.db, budget + 1);
  const remaining = candidates.length > budget;
  const batch = candidates.slice(0, budget);
  log('info', 'nudge_run_started', { trigger, candidates: candidates.length, budget });

  let sent = 0;
  let failed = 0;
  for (const candidate of batch) {
    try {
      await d.mailer.sendNudge({
        to: candidate.email,
        importUrl: `${d.appOrigin}/import`,
        unsubscribeUrl: `${d.appOrigin}/nudge/unsubscribe/${signUnsubscribeToken(candidate.userId)}`,
      });
    } catch (error) {
      // Not logged to nudge_send: a failed send spends neither the account's
      // week nor the provider's daily budget.
      failed += 1;
      log('error', 'nudge_send_error', {
        userId: candidate.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    await d.db.insert(nudgeSend).values({ userId: candidate.userId, email: candidate.email });
    sent += 1;
    log('info', 'nudge_send_ok', { userId: candidate.userId });
  }

  log('info', 'nudge_run_finished', { trigger, sent, failed, remaining });

  // A full page means the population outran the budget: exactly one
  // continuation message goes on the queue, whose 15-minute delay paces the
  // next run. A run that sent nothing (an outage) enqueues nothing, so the
  // scheduler's next weekly run is the retry rather than a same-day loop.
  if (remaining && sent > 0) {
    await enqueueNudgeContinuation(d.queueConfig);
    log('info', 'nudge_run_continuation_enqueued', { trigger });
  }
}
