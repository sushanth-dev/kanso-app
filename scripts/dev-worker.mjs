// Local analysis worker: polls the LocalStack SQS queue, runs the real Lambda
// handler per message, deletes on success. This is the local stand-in for the
// deployed Lambda; `dev-up.sh` runs it so import -> analyse -> report works end
// to end without AWS.
import { createRequire } from 'node:module';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

// The handler requires ENGINE_PATH at module scope; resolve it from the
// installed stockfish package so no absolute path is hardcoded.
const require = createRequire(import.meta.url);
process.env.ENGINE_PATH ??= require.resolve('stockfish/bin/stockfish-18-single.js');

const { handler } = await import('../apps/api/src/analysis/lambda-entry.mjs');

const queueUrl = process.env.ANALYSIS_QUEUE_URL;
const endpoint = process.env.AWS_ENDPOINT_URL;
const maxAttempts = Number(process.env.ANALYSIS_MAX_ATTEMPTS ?? 3);

if (!queueUrl) {
  console.error('ANALYSIS_QUEUE_URL is not set. Run scripts/dev-up.sh instead.');
  process.exit(1);
}

const client = new SQSClient({
  endpoint,
  region: 'ap-south-2',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

console.log(`dev-worker polling ${queueUrl}`);

for (;;) {
  const res = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 300,
    }),
  );

  for (const msg of res.Messages ?? []) {
    const attempt = Number(msg.Attributes?.ApproximateReceiveCount ?? '1');
    try {
      await handler({
        Records: [
          { body: msg.Body, messageAttributes: msg.MessageAttributes, attributes: msg.Attributes },
        ],
      });
      await client.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }),
      );
      console.log(`analysed ${msg.Body} (attempt ${attempt})`);
    } catch (error) {
      // The handler rethrows so real SQS redrives to the DLQ. Locally there is
      // no DLQ, so after the last attempt drop the message instead of looping.
      console.error('failed %s attempt %s: %s', msg.Body, attempt, error?.message ?? error);
      if (attempt >= maxAttempts) {
        await client.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }),
        );
        console.log(`dropped ${msg.Body} after ${attempt} attempts (no local DLQ)`);
      }
    }
  }
}
