/**
 * The analysis queue, from the sending side.
 *
 * One message per game, the game id as the body. The worker reads it, analyses
 * that game, and deletes the message; SQS redrives to the dead-letter queue
 * after a bounded number of attempts, so a game that cannot be analysed is
 * marked failed and left alone rather than retried forever (ADR-0023).
 *
 * When no queue url is configured, sending is a no-op that says so once. That
 * is what lets the API run locally, and every existing integration test keep
 * running, with no queue and no branch in the calling code.
 */
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { log } from '../logging.ts';
import { localstackClientOptions } from '../localstack.ts';

export interface QueueConfig {
  queueUrl: string;
  /** Set only to point at LocalStack. Unset in every deployed environment. */
  endpoint?: string;
}

/** `SendMessageBatch` takes ten entries; more is an error, not a truncation. */
const BATCH_SIZE = 10;

let client: SQSClient | null = null;
let warnedAboutNoQueue = false;

export function queueConfigFromEnv(): QueueConfig | null {
  const queueUrl = process.env.ANALYSIS_QUEUE_URL;
  if (!queueUrl) return null;
  const endpoint = process.env.AWS_ENDPOINT_URL;
  return endpoint ? { queueUrl, endpoint } : { queueUrl };
}

function clientFor(config: QueueConfig): SQSClient {
  // One client per process. The SDK holds the connection pool, and building a
  // fresh one per import is how a Lambda ends up re-resolving credentials on
  // every message.
  client ??= new SQSClient(
    config.endpoint ? { endpoint: config.endpoint, ...localstackClientOptions } : {},
  );
  return client;
}

/**
 * Queue one analysis job per game id, carrying the import request's id as a
 * message attribute so the worker's log lines tie back to the request.
 *
 * Throws if the queue rejected any message. A partial send that returns quietly
 * would leave games sitting `pending` with nothing to explain it, and the
 * caller is the only one who knows whether that is worth failing over.
 */
export async function enqueueAnalysis(
  gameIds: string[],
  config: QueueConfig | null = queueConfigFromEnv(),
  requestId?: string,
): Promise<void> {
  if (gameIds.length === 0) return;
  if (config === null) {
    if (!warnedAboutNoQueue) {
      warnedAboutNoQueue = true;
      log('info', 'analysis_queue_unset');
    }
    return;
  }

  const sqs = clientFor(config);
  for (let start = 0; start < gameIds.length; start += BATCH_SIZE) {
    const batch = gameIds.slice(start, start + BATCH_SIZE);
    const result = await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: config.queueUrl,
        Entries: batch.map((id, index) => ({
          Id: String(index),
          MessageBody: id,
          ...(requestId === undefined
            ? {}
            : {
                MessageAttributes: {
                  requestId: { DataType: 'String', StringValue: requestId },
                },
              }),
        })),
      }),
    );
    if (result.Failed !== undefined && result.Failed.length > 0) {
      const failed = result.Failed.map((f) => f.Id).join(', ');
      throw new Error(`queueing analysis failed for ${result.Failed.length} games: ${failed}`);
    }
  }
}
