/**
 * The API: ADR-0033's Lambda behind API Gateway HTTP API, replacing the Fargate
 * service and load balancer of ADR-0014.
 *
 * DATABASE_URL is still resolved by SST at deploy time and still lives in the
 * function configuration rather than the image or the repository, so nothing
 * here is a literal anybody could commit.
 *
 * HTTPS is terminated twice: once at Cloudflare, which holds the public
 * hostname and its own certificate, and once at API Gateway, which holds an
 * ACM certificate for the same name. Cloudflare is set to Full (strict), so it
 * checks the second one. Both legs are encrypted and neither certificate is
 * ours to rotate.
 *
 * The Cloudflare-only ingress rule that lived on the load balancer's security
 * group moves to `disableExecuteApiEndpoint` on the HTTP API: API Gateway has
 * no security group to lock, and HTTP API cannot take a WAF Web ACL. Disabling
 * the default `execute-api` URL leaves the custom domain behind Cloudflare as
 * the only public entry.
 */
import { analysisQueue } from './analysis.ts';
import { database, vpc } from './database.ts';
import { apiHostname, webHostname } from './domains.ts';
// `*.kansochess.app`, DNS validated, which covers every stage name. ACM
// renews it on its own as long as the validation record stays in Cloudflare.
// Created once by hand rather than by SST, because SST can only create and
// validate a certificate for a domain whose DNS it controls, and ours is on
// Cloudflare with a deploy token that cannot edit DNS.
const certificateArn =
  'arn:aws:acm:ap-south-2:082867428520:certificate/3490faff-7dac-4eb3-964c-1bf5de5e85c0';

// The database URL, assembled from the database component's outputs so the
// credential is resolved by SST at deploy time and lands in the function
// configuration rather than anywhere a person handles.
const databaseUrl = $interpolate`postgresql://${database.username}:${database.password}@${database.host}:${database.port}/${database.database}`;

const handler = new sst.aws.Function('ApiHandler', {
  handler: 'apps/api/src/lambda.handler',
  vpc,
  link: [database],
  // Send, and nothing else. The API fills the analysis queue and must not be
  // able to read it: the worker is the only thing that drains it.
  permissions: [{ actions: ['sqs:SendMessage'], resources: [analysisQueue.arn] }],
  environment: {
    DATABASE_URL: databaseUrl,
    ANALYSIS_QUEUE_URL: analysisQueue.url,
    // The web origin the browser holds a session from. Both halves of the
    // browser's access control read this: Hono CORS and better-auth's
    // trustedOrigins (ST-030 Part 2).
    CORS_ORIGINS: `https://${webHostname}`,
    // The public origin the guardian consent link points at (ST-034).
    APP_ORIGIN: `https://${webHostname}`,
  },
  // API Gateway caps a request at 30 seconds, so a longer function timeout is a
  // setting that never gets used.
  timeout: '30 seconds',
  memory: '512 MB',
  architecture: 'arm64',
});

export const api = new sst.aws.ApiGatewayV2('Api', {
  domain: {
    name: apiHostname,
    // Cloudflare holds the zone and this repository holds no token for it,
    // so the two records are added by hand. The deploy guide carries them.
    dns: false,
    cert: certificateArn,
  },
  // The Cloudflare-only ingress rule, as a native close (ADR-0033): disable
  // the default `execute-api` URL so the custom domain behind Cloudflare is
  // the only public entry. HTTP API cannot take a WAF Web ACL.
  transform: {
    api: { disableExecuteApiEndpoint: true },
  },
});

api.route('$default', handler.arn);

// The migration, run once after a deploy from `sst shell` with
// `aws lambda invoke`. It shares the API's VPC and database link, so it can
// reach the private database, and it carries the checked-in migrations folder
// in its bundle.
export const migrate = new sst.aws.Function('Migrate', {
  handler: 'apps/api/src/db/migrate-lambda.handler',
  vpc,
  link: [database],
  environment: {
    DATABASE_URL: databaseUrl,
  },
  timeout: '60 seconds',
  copyFiles: [{ from: 'apps/api/drizzle', to: 'drizzle' }],
});
