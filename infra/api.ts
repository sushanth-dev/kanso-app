/**
 * The API: ADR-0014's "small always-on service behind an application load
 * balancer", as one Fargate task.
 *
 * The container gets DATABASE_URL assembled from the database component's own
 * outputs, which means the credential is resolved by SST at deploy time and
 * exists in the task definition rather than in the image or the repository.
 * Nothing here is a literal anybody could commit.
 *
 * HTTPS is terminated twice: once at Cloudflare, which holds the public
 * hostname and its own certificate, and once at the load balancer, which holds
 * an ACM certificate for the same name. Cloudflare is set to Full (strict), so
 * it checks the second one. Both legs are encrypted and neither certificate is
 * ours to rotate.
 */
import { analysisQueue } from './analysis.ts';
import { database, vpc } from './database.ts';

const cluster = new sst.aws.Cluster('Cluster', { vpc });

// Production owns `api`; every other stage gets its own name beside it, so a
// second stage never collides with the first.
//
// One label rather than `<stage>.api`, which reads better but does not work:
// Cloudflare's included certificate covers `kansochess.app` and
// `*.kansochess.app` and stops there, so a name two levels deep has nothing to
// present at the edge and the handshake fails before the request reaches us.
// Covering deeper names is a paid Cloudflare add-on costing a quarter of what
// this whole environment costs, which is a lot to pay for a dot.
const hostname =
  $app.stage === 'production' ? 'api.kansochess.app' : `${$app.stage}-api.kansochess.app`;

// `*.kansochess.app`, DNS validated, which covers every stage name above. ACM
// renews it on its own as long as the validation record stays in Cloudflare.
// Created once by hand rather than by SST, because SST can only create and
// validate a certificate for a domain whose DNS it controls, and ours is on
// Cloudflare with no API token given to this repository.
const certificateArn =
  'arn:aws:acm:ap-south-2:082867428520:certificate/3490faff-7dac-4eb3-964c-1bf5de5e85c0';

// Read at deploy time rather than pasted in, because Cloudflare changes this
// list and a stale copy fails closed: the load balancer would start refusing
// the edge it is supposed to serve. This is the only network call the
// configuration makes.
const cloudflare = (await (await fetch('https://api.cloudflare.com/client/v4/ips')).json()) as {
  result: { ipv4_cidrs: string[]; ipv6_cidrs: string[] };
};

// `new Service({ cluster })` rather than `cluster.addService()`: the second is
// deprecated in SST 4 and both produce the same resources.
export const api = new sst.aws.Service('Api', {
  cluster,
  cpu: '0.25 vCPU',
  memory: '0.5 GB',
  link: [database],
  transform: {
    loadBalancerSecurityGroup: (args) => {
      // Without this the load balancer answers the whole internet directly,
      // which is a way around every control Cloudflare applies in front of it.
      args.ingress = [
        {
          protocol: 'tcp',
          fromPort: 443,
          toPort: 443,
          cidrBlocks: cloudflare.result.ipv4_cidrs,
          ipv6CidrBlocks: cloudflare.result.ipv6_cidrs,
          description: 'Cloudflare edge only. The public entry point is the proxied hostname.',
        },
      ];
    },
  },
  loadBalancer: {
    domain: {
      name: hostname,
      // Cloudflare holds the zone and this repository holds no token for it,
      // so the two records are added by hand. The deploy guide carries them.
      dns: false,
      cert: certificateArn,
    },
    rules: [{ listen: '443/https', forward: '3000/http' }],
    health: {
      '3000/http': {
        path: '/health',
        interval: '30 seconds',
        timeout: '5 seconds',
        healthyThreshold: 2,
        unhealthyThreshold: 3,
      },
    },
  },
  // Send, and nothing else. The API fills the analysis queue and must not be
  // able to read it: the worker is the only thing that drains it.
  permissions: [{ actions: ['sqs:SendMessage'], resources: [analysisQueue.arn] }],
  environment: {
    DATABASE_URL: $interpolate`postgresql://${database.username}:${database.password}@${database.host}:${database.port}/${database.database}`,
    ANALYSIS_QUEUE_URL: analysisQueue.url,
  },
  image: {
    context: '.',
    dockerfile: 'apps/api/Dockerfile',
  },
  dev: {
    command: 'npm run start --workspace apps/api',
  },
});
