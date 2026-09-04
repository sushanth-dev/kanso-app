/**
 * The nudge continuation queue, from the sending side (ST-126).
 *
 * One message body, `{ kind: 'nudge-continuation' }`: the run that receives it
 * re-selects from scratch, so the message carries no state. The queue's own
 * 15-minute delay does the pacing; there is no DelaySeconds in code. When no
 * queue url is configured, enqueueing is a no-op that says so once - the same
 * shape as the analysis queue - so local runs and tests need no queue.
 */
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { log } from '../logging.ts';
import { localstackClientOptions } from '../localstack.ts';

export interface NudgeQueueConfig {
  queueUrl: string;
  /** Set only to point at LocalStack. Unset in every deployed environment. */
  endpoint?: string;
}

export function nudgeQueueConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): NudgeQueueConfig | null {
  const queueUrl = env.NUDGE_QUEUE_URL;
  if (!queueUrl) return null;
  const endpoint = env.AWS_ENDPOINT_URL;
  return endpoint ? { queueUrl, endpoint } : { queueUrl };
}

export const CONTINUATION_BODY = JSON.stringify({ kind: 'nudge-continuation' });

let client: SQSClient | null = null;
let warnedAboutNoQueue = false;

function clientFor(config: NudgeQueueConfig): SQSClient {
  // One client per process, as in the analysis queue: the SDK holds the
  // connection pool.
  client ??= new SQSClient(
    config.endpoint ? { endpoint: config.endpoint, ...localstackClientOptions } : {},
  );
  return client;
}

export async function enqueueNudgeContinuation(
  config: NudgeQueueConfig | null = nudgeQueueConfigFromEnv(),
): Promise<void> {
  if (config === null) {
    if (!warnedAboutNoQueue) {
      warnedAboutNoQueue = true;
      log('info', 'nudge_queue_unset');
    }
    return;
  }
  await clientFor(config).send(
    new SendMessageCommand({ QueueUrl: config.queueUrl, MessageBody: CONTINUATION_BODY }),
  );
}
