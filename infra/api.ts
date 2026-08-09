/**
 * The API: ADR-0014's "small always-on service behind an application load
 * balancer", as one Fargate task.
 *
 * The container gets DATABASE_URL assembled from the database component's own
 * outputs, which means the credential is resolved by SST at deploy time and
 * exists in the task definition rather than in the image or the repository.
 * Nothing here is a literal anybody could commit.
 *
 * The public address is a CloudFront distribution rather than the load balancer
 * itself, because a load balancer can only serve HTTPS with a certificate, a
 * certificate needs a domain name, and we do not own one yet. CloudFront brings
 * its own certificate for its own `*.cloudfront.net` hostname, so the story's
 * HTTPS criterion is met today at no cost and without inventing a domain. When
 * a real domain arrives, it attaches to this same distribution.
 */
import { database, vpc } from './database.ts';

const cluster = new sst.aws.Cluster('Cluster', { vpc });

// The addresses CloudFront makes origin requests from, kept current by AWS.
// Restricting the load balancer to these is what stops the plain-HTTP origin
// from being an open bypass around the HTTPS the distribution enforces.
const cloudfrontOrigins = aws.ec2.getManagedPrefixListOutput({
  name: 'com.amazonaws.global.cloudfront.origin-facing',
});

// `new Service({ cluster })` rather than `cluster.addService()`: the second is
// deprecated in SST 4 and both produce the same resources.
export const api = new sst.aws.Service('Api', {
  cluster,
  cpu: '0.25 vCPU',
  memory: '0.5 GB',
  link: [database],
  transform: {
    loadBalancerSecurityGroup: (args) => {
      args.ingress = [
        {
          protocol: 'tcp',
          fromPort: 80,
          toPort: 80,
          prefixListIds: [cloudfrontOrigins.id],
          description:
            'CloudFront origin requests only. The public entry point is the distribution.',
        },
      ];
    },
  },
  loadBalancer: {
    // HTTP here, HTTPS at the distribution in front. The listener is reachable
    // only from CloudFront, per the security group above.
    rules: [{ listen: '80/http', forward: '3000/http' }],
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

/**
 * The public address, and the thing that terminates TLS. Everything reaches the
 * API through here; the load balancer behind it answers nothing else.
 */
export const router = new sst.aws.Router('Router', {
  routes: { '/*': api.url },
});
