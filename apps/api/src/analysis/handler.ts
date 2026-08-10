/**
 * The Lambda entry point: one message, one game.
 *
 * The connection pool and the budget are built once at module scope, so a warm
 * invocation reuses them. The pool is small on purpose: ADR-0023 caps this
 * function's concurrency because every invocation opens its own connections to
 * a `db.t4g.micro`, and ST-008 is where that cap is tested against a real
 * deployment.
 *
 * The event type is written out here rather than pulled from `@types/aws-lambda`
 * for two fields we read. A dependency for two fields is a dependency to keep
 * updated.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../db/schema.ts';
import { game } from '../db/schema.ts';
import { analyseGame } from './analyse-game.ts';
import {
  ANALYSIS_DEPTH,
  ANALYSIS_ENGINES,
  ANALYSIS_HASH_MB,
  ANALYSIS_NODE_CEILING,
} from './budget.ts';
import type { EngineOptions } from './engine.ts';

export interface SqsRecord {
  /** The game id. Nothing else is in the message. */
  body: string;
  attributes?: { ApproximateReceiveCount?: string };
}

export interface SqsEvent {
  Records: SqsRecord[];
}

/**
 * Must match the queue's redrive policy in `infra/analysis.ts`. On the last
 * attempt the failure is final; before it, the game is left retryable.
 */
const MAX_ATTEMPTS = Number(process.env.ANALYSIS_MAX_ATTEMPTS ?? 3);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// One pool per execution environment, and only two connections: the engine, not
// the database, is what this function spends its time on.
const sql = postgres(required('DATABASE_URL'), { max: 2 });
const db = drizzle(sql, { schema });

const options: EngineOptions = {
  enginePath: required('ENGINE_PATH'),
  depth: ANALYSIS_DEPTH,
  nodeCeiling: ANALYSIS_NODE_CEILING,
  engines: ANALYSIS_ENGINES,
  hashMb: ANALYSIS_HASH_MB,
};

export async function handler(event: SqsEvent): Promise<void> {
  for (const record of event.Records) {
    const gameId = record.body;
    const attempt = Number(record.attributes?.ApproximateReceiveCount ?? '1');

    try {
      const outcome = await analyseGame(db, gameId, options);
      // A constant message with the values beside it, rather than interpolated
      // into it. The message body arrives from the queue, and a log line an
      // attacker can shape is a log line nobody can trust.
      console.log('analysed a game', { gameId, ...outcome });
    } catch (error) {
      // `analyseGame` has already written `failed` with the reason. That is the
      // right answer on the last attempt and the wrong one before it: a game a
      // retry would have fixed must not sit there looking permanently broken,
      // so it goes back to `queued` and the message comes back with it.
      if (attempt < MAX_ATTEMPTS) {
        await db.update(game).set({ analysisStatus: 'queued' }).where(eq(game.id, gameId));
        console.warn('analysis failed, retrying', { gameId, attempt }, error);
      } else {
        console.error('analysis failed on its last attempt', { gameId, attempt }, error);
      }
      // Rethrow either way: SQS decides between a retry and the dead-letter
      // queue, and it decides by the message coming back.
      throw error;
    }
  }
}
