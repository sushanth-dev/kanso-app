/**
 * The queue sender against a real SQS, provided by LocalStack.
 *
 * Not a mocked client: the failure this catches is a malformed batch entry or a
 * wrong queue url, and a stand-in accepts both. `docs/guides/local-setup.md`
 * has the container command; CI runs it as a service container.
 *
 * The queue is created per run with a unique name, so two runs of the suite
 * never receive each other's messages.
 */
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { enqueueAnalysis, queueConfigFromEnv, type QueueConfig } from './queue.ts';

const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';

// LocalStack accepts any credentials but the SDK refuses to send without them.
process.env.AWS_REGION ??= 'us-east-1';
process.env.AWS_ACCESS_KEY_ID ??= 'test';
process.env.AWS_SECRET_ACCESS_KEY ??= 'test';

const sqs = new SQSClient({ endpoint });
let config: QueueConfig;

beforeAll(async () => {
  const created = await sqs.send(
    new CreateQueueCommand({ QueueName: `kanso-analysis-test-${crypto.randomUUID()}` }),
  );
  if (created.QueueUrl === undefined) throw new Error('LocalStack did not return a queue url');
  config = { queueUrl: created.QueueUrl, endpoint };
});

afterAll(async () => {
  if (config !== undefined) await sqs.send(new DeleteQueueCommand({ QueueUrl: config.queueUrl }));
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

describe('enqueueAnalysis', () => {
  test('sends one message per game id, the id as the body', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

    await enqueueAnalysis(ids, config);

    expect((await drain()).sort()).toEqual([...ids].sort());
  });

  test('sends more games than one batch holds', async () => {
    // `SendMessageBatch` takes ten entries. Twelve is what catches a sender
    // that quietly drops everything past the first batch.
    const ids = Array.from({ length: 12 }, () => crypto.randomUUID());

    await enqueueAnalysis(ids, config);

    expect((await drain()).sort()).toEqual([...ids].sort());
  });

  test('does nothing, and does not throw, when no queue is configured', async () => {
    // The local API and every other integration test run on this path.
    await expect(enqueueAnalysis([crypto.randomUUID()], null)).resolves.toBeUndefined();
    expect(await drain()).toEqual([]);
  });

  test('reads its configuration from the environment', () => {
    const before = process.env.ANALYSIS_QUEUE_URL;
    try {
      delete process.env.ANALYSIS_QUEUE_URL;
      expect(queueConfigFromEnv()).toBeNull();

      process.env.ANALYSIS_QUEUE_URL = config.queueUrl;
      expect(queueConfigFromEnv()?.queueUrl).toBe(config.queueUrl);
    } finally {
      if (before === undefined) delete process.env.ANALYSIS_QUEUE_URL;
      else process.env.ANALYSIS_QUEUE_URL = before;
    }
  });
});
