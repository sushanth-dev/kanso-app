/**
 * The analysis queue and the worker that drains it.
 *
 * Every number here is argued in ADR-0023 and set here, so each one carries the
 * reason beside it. The function is a container image because the engine is a
 * native binary compiled for arm64, which does not fit a zip deployment: SST's
 * container support is Python-only in this version, so the function, its role
 * and its event source mapping are the AWS resources directly.
 *
 * The image is built and pushed outside this file, by `docs/guides/deploy.md`,
 * and referenced here by tag. Pulumi updates the function when the tag changes,
 * which is why the tag should be the commit rather than `latest`.
 */
import { database, vpc } from './database.ts';

/**
 * A game that fails three times is a game with something wrong in it, not a
 * game with bad luck. It waits here for someone to look, for a fortnight, which
 * is the longest SQS will hold a message.
 */
const deadLetterQueue = new sst.aws.Queue('AnalysisDeadLetterQueue', {
  transform: {
    queue: (args) => {
      args.messageRetentionSeconds = 14 * 24 * 60 * 60;
    },
  },
});

export const analysisQueue = new sst.aws.Queue('AnalysisQueue', {
  // Three attempts, then the dead-letter queue. The worker knows this number
  // too: below it a failure is written as `queued` and retried, on it the
  // failure is final and the game stays `failed`.
  dlq: { queue: deadLetterQueue.arn, retry: 3 },
  // Must be at least the function timeout, or SQS hands the same game to a
  // second invocation while the first is still analysing it.
  visibilityTimeout: '10 minutes',
});

const repository = new aws.ecr.Repository('AnalysisRepository', {
  imageScanningConfiguration: { scanOnPush: true },
  // Outside production an abandoned stage should be removable without emptying
  // its registry by hand first.
  forceDelete: $app.stage !== 'production',
});

// The commit the image was built from. `latest` deploys, but two deploys of
// `latest` look identical to Pulumi and the second one changes nothing.
const imageTag = process.env.ANALYSIS_IMAGE_TAG ?? 'latest';

const role = new aws.iam.Role('AnalysisRole', {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'lambda.amazonaws.com' }),
  // The network interfaces the function needs to sit in the private subnets,
  // and its log group. Nothing else is managed.
  managedPolicyArns: [aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole],
  inlinePolicies: [
    {
      name: 'AnalysisQueueAccess',
      // This queue, and only this queue. The worker cannot send to it, so a bug
      // in the worker cannot fill the queue it is draining.
      policy: $jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
            Resource: analysisQueue.arn,
          },
        ],
      }),
    },
  ],
});

export const analysisWorker = new aws.lambda.Function('AnalysisWorker', {
  packageType: 'Image',
  imageUri: $interpolate`${repository.repositoryUrl}:${imageTag}`,
  role: role.arn,
  // About 20% cheaper per GB-second than x86, and the engine is the whole
  // workload. The image is built for this architecture, not translated to it.
  architectures: ['arm64'],
  // Where Lambda gives four vCPUs: one per engine process. Four engines measured
  // 3.3x faster than one on the same game at no cost in depth.
  memorySize: 7077,
  // The measured game is about 105 seconds. Ten minutes leaves room for a long
  // one and stays under the 15-minute ceiling, so a pathological game reaches
  // the dead-letter queue rather than being billed for three full attempts.
  timeout: 600,
  // Each invocation opens its own connections to a db.t4g.micro. ST-008 tests
  // this number against the deployed function; ADR-0023 records RDS Proxy as
  // the exit if it does not hold.
  reservedConcurrentExecutions: 2,
  vpcConfig: {
    // Private subnets, to reach the database. The event source mapping is
    // polled by the Lambda service from outside the VPC, so this needs no NAT
    // gateway, which is what makes ADR-0014's no-NAT VPC work.
    subnetIds: vpc.privateSubnets,
    securityGroupIds: vpc.securityGroups,
  },
  environment: {
    variables: {
      DATABASE_URL: $interpolate`postgresql://${database.username}:${database.password}@${database.host}:${database.port}/${database.database}`,
      // The same three the queue redrives on. Set here so the two cannot drift
      // silently: they are one decision written in two places.
      ANALYSIS_MAX_ATTEMPTS: '3',
    },
  },
});

new aws.lambda.EventSourceMapping('AnalysisSubscription', {
  eventSourceArn: analysisQueue.arn,
  functionName: analysisWorker.name,
  // One game per invocation. A batch would share a timeout across games and
  // make a single slow game fail the ones beside it.
  batchSize: 1,
  scalingConfig: { maximumConcurrency: 2 },
});
