/**
 * The post-tournament nudge (ST-126): the weekly schedule, the continuation
 * queue, and the one function that serves both triggers.
 *
 * Every number is the story's contract, set here with its reason beside it.
 * The function is a zip deployment like the API handler: the run is one
 * selection query and a batch of email sends, nothing native in it.
 */
import { database, vpc } from './database.ts';
import { webHostname } from './domains.ts';

// The database URL, assembled the same way infra/api.ts assembles it: resolved
// by SST at deploy time, carried in the function configuration.
const databaseUrl = $interpolate`postgresql://${database.username}:${database.password}@${database.host}:${database.port}/${database.database}`;

/**
 * A run that fails three times (a database down, a queue refused) waits here
 * for someone to look. There is nothing to replay by hand: the next Sunday
 * run re-selects from scratch, and the send log keeps it honest.
 */
const deadLetterQueue = new sst.aws.Queue('NudgeDeadLetterQueue', {
  transform: {
    queue: (args) => {
      args.messageRetentionSeconds = 14 * 24 * 60 * 60;
    },
  },
});

export const nudgeQueue = new sst.aws.Queue('NudgeQueue', {
  dlq: { queue: deadLetterQueue.arn, retry: 3 },
  // Must be at least the function timeout, or SQS hands the continuation to a
  // second invocation while the first is still sending.
  visibilityTimeout: '10 minutes',
  // The pacing (ST-126): the remainder re-enqueues through SQS with a
  // 15-minute delay. The queue's own delay carries it, so there is no
  // DelaySeconds in code. 15 minutes is SQS's maximum.
  delay: '15 minutes',
});

export const nudgeRun = new sst.aws.Function('NudgeRun', {
  handler: 'apps/api/src/nudge/run.handler',
  vpc,
  link: [database],
  // Unlike the analysis worker, the run sends to the queue it also drains:
  // the continuation is its own message.
  permissions: [{ actions: ['sqs:SendMessage'], resources: [nudgeQueue.arn] }],
  environment: {
    DATABASE_URL: databaseUrl,
    NUDGE_QUEUE_URL: nudgeQueue.url,
    // The origin the email's links point at (ST-034's shape, reused).
    APP_ORIGIN: `https://${webHostname}`,
    // The same secret the unsubscribe token is signed with (better-auth's).
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
    // The Resend credentials (ADR-0042). Unset or empty, the run logs a
    // skipped week and sends nothing.
    RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
    MAIL_FROM_ADDRESS: process.env.MAIL_FROM_ADDRESS ?? '',
  },
  // 90 sequential sends at a second each is under two minutes; five minutes
  // leaves room for a slow provider and stays under the visibility timeout.
  timeout: '5 minutes',
  memory: '256 MB',
  architecture: 'arm64',
});

// The component, not the arn: subscribing by arn skips the IAM grant and the
// event source mapping fails with a missing sqs:ReceiveMessage permission.
nudgeQueue.subscribe(nudgeRun);

// Sunday 13:00 UTC (ST-126): early afternoon in Europe, evening in India,
// and never the small hours anywhere the players are.
new sst.aws.CronV2('NudgeCron', {
  function: nudgeRun.arn,
  schedule: 'cron(0 13 ? * SUN *)',
});
