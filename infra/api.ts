/**
 * The API: ADR-0014's "small always-on service behind an application load
 * balancer", as one Fargate task.
 *
 * The container gets DATABASE_URL assembled from the database component's own
 * outputs, which means the credential is resolved by SST at deploy time and
 * exists in the task definition rather than in the image or the repository.
 * Nothing here is a literal anybody could commit.
 */
import { database, vpc } from './database.ts';

const cluster = new sst.aws.Cluster('Cluster', { vpc });

// `new Service({ cluster })` rather than `cluster.addService()`: the second is
// deprecated in SST 4 and both produce the same resources.
export const api = new sst.aws.Service('Api', {
  cluster,
  cpu: '0.25 vCPU',
  memory: '0.5 GB',
  link: [database],
  loadBalancer: {
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
