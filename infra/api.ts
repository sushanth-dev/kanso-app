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
    // The session signing secret (better-auth). Read from .env at deploy time,
    // so it lands in the function configuration rather than the repository.
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
    // The Z.AI key the coach routes and report prose read (ADR-0018, ADR-0041).
    // Read from .env at deploy time like the session secret; unset, the coach
    // routes are not mounted. ZAI_MODEL defaults to glm-5.3-flash in code.
    ZAI_API_KEY: process.env.ZAI_API_KEY ?? '',
    ZAI_MODEL: process.env.ZAI_MODEL ?? '',
    // The Razorpay credentials the billing routes read (ADR-0039, ST-044).
    // Read from .env at deploy time like the session secret; unset, the
    // billing routes are not mounted and checkout answers 404.
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID ?? '',
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET ?? '',
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
    // The Resend credentials the mailer sends with (ADR-0042, ST-125). Read
    // from .env at deploy time like the session secret; unset or empty, the
    // consent flow fails loud rather than issuing a link that was never
    // mailed. The from address is the verified kansochess.app identity.
    RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
    MAIL_FROM_ADDRESS: process.env.MAIL_FROM_ADDRESS ?? '',
    // The PostHog project token the server-side exception capture reads
    // (ADR-0038, second amendment). Public by design, like its web half;
    // unset or empty, the API sends nothing to PostHog.
    POSTHOG_KEY: process.env.POSTHOG_KEY ?? '',
  },
  // API Gateway caps a request at 30 seconds, so a longer function timeout is a
  // setting that never gets used.
  timeout: '30 seconds',
  memory: '512 MB',
  architecture: 'arm64',
  // The finish session's off-rails reply (ST-158) runs the WASM engine inside
  // this function: the loader and its single-threaded wasm, at the paths the
  // bare relative enginePath in engine-reply.ts resolves from the function
  // root. The multi-threaded builds and the asm fallback stay out; shipping
  // the whole bin folder would nearly double the bundle for nothing.
  copyFiles: [
    {
      from: 'node_modules/stockfish/bin/stockfish-18-single.js',
      to: 'stockfish/bin/stockfish-18-single.js',
    },
    {
      from: 'node_modules/stockfish/bin/stockfish-18-single.wasm',
      to: 'stockfish/bin/stockfish-18-single.wasm',
    },
  ],
});

export const api = new sst.aws.ApiGatewayV2('Api', {
  domain: {
    name: apiHostname,
    // Cloudflare holds the zone and this repository holds no token for it,
    // so the two records are added by hand. The deploy guide carries them.
    dns: false,
    cert: certificateArn,
  },
  // SST enables CORS by default with `allowOrigins: ["*"]` and no
  // credentials. A wildcard origin is invalid for the credentialed session
  // requests the browser sends to better-auth, so pin the origin to the web
  // app and allow its cookies. The Lambda's Hono CORS is a second, redundant
  // layer for the same allowlist; API Gateway's runs first and is what the
  // browser sees.
  cors: {
    allowOrigins: [`https://${webHostname}`],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowCredentials: true,
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
