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
import { database, vpc } from './database.ts';

const cluster = new sst.aws.Cluster('Cluster', { vpc });

// Production owns the bare name; every other stage gets a subdomain of it, so
// a second stage never collides with the first. The certificate covers both.
const hostname =
  $app.stage === 'production' ? 'api.kansochess.app' : `${$app.stage}.api.kansochess.app`;

// Covers `api.kansochess.app` and `*.api.kansochess.app`, DNS validated. ACM
// renews it on its own as long as the validation record stays in Cloudflare.
// Created once by hand rather than by SST, because SST can only create and
// validate a certificate for a domain whose DNS it controls, and ours is on
// Cloudflare with no API token given to this repository.
const certificateArn =
  'arn:aws:acm:ap-south-2:082867428520:certificate/87afb476-827f-4427-8be9-8a4938fd76fb';

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
  environment: {
    DATABASE_URL: $interpolate`postgresql://${database.username}:${database.password}@${database.host}:${database.port}/${database.database}`,
  },
  image: {
    context: '.',
    dockerfile: 'apps/api/Dockerfile',
  },
  dev: {
    command: 'npm run start --workspace apps/api',
  },
});
