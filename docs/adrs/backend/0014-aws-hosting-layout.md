# 0014. Host on AWS: API on a small always-on service, analysis on SQS and Lambda

* Status: accepted; API half superseded by [0033](0033-lambda-api-http-api.md)
* Date: 2026-07-31
* Supersedes: [ADR-0012](0012-pg-boss-stockfish-analysis.md) (the queue
  and worker choice; its Stockfish WASM choice was replaced later, by
  [ADR-0023](0023-stockfish-native-lambda-depth-21.md))
* Builds on: [ADR-0007](0007-hono-http-framework.md), [ADR-0009](0009-drizzle-orm.md)

> The API half of this record was replaced by ADR-0033, which runs the same Hono
> app in Lambda behind an HTTP API instead of a Fargate task behind a load
> balancer. The analysis half, and the one game per message design, still stands.

## Context

The app has two workloads with opposite shapes. The API is latency-bound
and must always be up. Engine analysis is compute-bound, bursty, and the
user waits on it: ten players each uploading a 60-move game at once is
600 moves to analyze, and running them all on the API host would pin the
CPU and crash it. The design goals are that the API never falls over
under an upload burst, and that we do not pay for analysis compute while
nobody is uploading.

The first sketch paired BullMQ on a cheap Redis host with Lambda workers.
That sketch has a structural problem: BullMQ's model is long-lived worker
processes polling Redis, and it has no native way to invoke Lambda. Making
it reach Lambda means running an always-on worker whose only job is
calling the Lambda SDK, so we would pay for the always-on worker and
Lambda both, and keep a Redis to babysit. The sketch also split each game
into one job per move, which multiplies cold starts and throws away the
search-tree state Stockfish carries between consecutive positions.

## Decision

Two services, separated by a queue.

The API runs as a small always-on Node service (the Hono app from
ADR-0007) behind an application load balancer, on the smallest compute
that holds it. It does three things for analysis: accept the PGN, store
the game, and put one message per game on the queue. It never runs the
engine.

Analysis runs as SQS feeding Lambda through an event source mapping. SQS
holds one message per game durably; Lambda polls it, scales up one
invocation per game under burst, and scales to zero when the queue is
empty. Each invocation loads the single-threaded Stockfish WASM build
from ADR-0012 and walks the whole game in one engine session, roughly 120
seconds for a 60-move game, well under the 15-minute ceiling. Results are
written back to PostgreSQL keyed by game, so a retried invocation is
idempotent. The queue's visibility timeout is set above the function
timeout, and a dead-letter queue catches games that fail repeatedly.

PostgreSQL is a managed instance (RDS), small, sized for the API's query
load rather than the analysis burst, because analysis results are the
only thing the burst writes. The Lambda reaches RDS over private subnets
inside the same VPC, so no NAT gateway is needed for the write path. One
burst risk is named rather than ignored: many concurrent Lambdas each
opening a database connection can strain a small instance, so if
connection exhaustion shows up, the mitigation is RDS Proxy in front of
the database, added without changing the flow.

One game per message, not one move per message. Per-move would multiply
invocations sixty-fold and re-search every position from scratch; per-game
keeps the engine's transposition state across the moves of a single game,
which is how real analysis services do it. The 120-second figure is an
estimate for a typical 60-move game, not a bound: the function timeout is
set with wide headroom under the 15-minute ceiling, and a game that
exceeds it lands in the dead-letter queue for a deeper look rather than
failing silently.

## Consequences

No Redis and no BullMQ: the queue is SQS, which is also why ADR-0012's
pg-boss worker is superseded. The API host stays cheap and stays up
because the burst never reaches it; the burst is absorbed by SQS and
spread across Lambda invocations that did not exist a second earlier.
Analysis cost is pay-per-use, so an idle month costs nearly nothing for
compute.

The costs accepted. We give up BullMQ's job progress tracking, so
analysis progress is a status column we maintain ourselves. SQS plus
Lambda is at-least-once, so the analysis writer must be idempotent, which
the key-by-game write gives us. And we now operate two compute models
(always-on service, serverless functions), each with its own deployment
and logging path, which the infrastructure-as-code setup has to cover.

The named exit, unchanged from ADR-0012: if WASM analysis measures too
slow, the Lambda package swaps to a native Stockfish binary in a
container image, with no change to the queue or the API.
