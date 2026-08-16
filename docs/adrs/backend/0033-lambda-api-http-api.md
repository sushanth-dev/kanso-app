# 0033. Move the API from Fargate and ALB to Lambda

* Status: accepted
* Date: 2026-08-16
* Supersedes: [ADR-0014](0014-aws-hosting-layout.md) (the API half; the analysis
  half still stands)
* Builds on: [ADR-0007](0007-hono-http-framework.md), [ADR-0015](0015-sst-infrastructure-as-code.md)

## Context

ADR-0014 chose a small always-on Node service behind an application load
balancer for the API, on the grounds that the API "is latency-bound and must
always be up." ST-006 then measured the result: about $45 a month with the stage
up, of which the load balancer was about $17 and Fargate about $10. Those two
are about $27 of idle cost that bills 24/7 whether or not anyone visits, because
the service is always on and the load balancer charges a flat hourly fee to
exist.

ST-030 turns an ephemeral stage into a permanent one. Until now the stage lived
for hours, so $27 of idle was a few dollars at most. A stage left up permanently
turns it into a recurring bill, which is the difference between a measurement and
a cost.

The API itself is a clean Lambda fit. It is thin, stateless, and short-request:
it accepts a PGN, stores a game, and queues analysis, and it reads back reports.
It has no websockets and no background work, better-auth keeps session tokens in
the database rather than in process memory, and the analysis work already runs
elsewhere on SQS and Lambda. A Lambda cold start is sub-second to a couple of
seconds, not the 30 to 60 seconds of a scaled-to-zero container, and the address
is unpublished with traffic of one invited person rather than a launch.

## Decision

Run the same Hono app from ADR-0007 in a Lambda behind API Gateway HTTP API (or
a Function URL), instead of a Fargate task behind an application load balancer.
The domain, the stage-aware resolution, the database, the VPC, and the analysis
path all stay as they are. The change is the compute and the front door, not the
application.

Cold start latency on the first request after idle is accepted and measured,
with the number recorded rather than guessed.

## Consequences

The idle AWS cost of the API stage drops from about $45 a month to about $18:
RDS about $17, Lambda and the HTTP API about $0 at this traffic, and small change
for Secrets Manager and ECR. The load balancer and its flat hourly fee are gone.

The API Lambda role becomes the new security surface, scoped to the database and
the queue and nothing else. Cloudflare's ingress allowlist moves from the load
balancer to the HTTP API.

Database connection exhaustion stays the named risk it was in ADR-0014, with RDS
Proxy as the unchanged mitigation if it shows up. Many concurrent Lambdas each
opening a connection is the same failure as many concurrent tasks, only reached
through a different compute path.

ADR-0014's "two compute models" consequence is reduced: the API and the analysis
both run as Lambda now, with one deployment and logging path for serverless and
none for an always-on service. The analysis half of ADR-0014, and the one game
per message design, are unchanged.

Provisioned concurrency and any cold-start elimination are deliberately out of
scope: they cost money and are a launch concern rather than a deployment one.
