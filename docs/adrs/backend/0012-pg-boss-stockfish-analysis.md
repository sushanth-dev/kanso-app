# 0012. Run Stockfish as WASM, queued through pg-boss

* Status: superseded by [0014](0014-aws-hosting-layout.md) and
  [0023](0023-stockfish-native-lambda-depth-21.md)
* Date: 2026-07-31
* Builds on: [ADR-0009](0009-drizzle-orm.md)

> Nothing in this record still stands. The queue choice (pg-boss with a
> long-lived worker) was replaced by SQS with Lambda in ADR-0014, once the
> hosting layout made the always-on worker the thing to avoid. The WASM
> choice was replaced by a native engine in a Lambda container image in
> ADR-0023, once measurement showed native searching 1.78 times faster with
> an identical search. WASM survives there only as the engine the tests run.

## Context

Engine analysis is the one workload that does not fit a request: a
full-game analysis runs for seconds to minutes, uses a core fully, and
the user is waiting on the result. Two decisions sit together. How to run
Stockfish from Node (WASM package, native binary subprocess, or a
separate container), and how to queue analysis jobs (in-process, SQS with
Lambda, BullMQ on Redis, or a PostgreSQL-backed queue).

The `node-uci` wrapper was considered and rejected up front: it has been
unmaintained since 2020, and UCI is a plain line protocol that needs no
stale abstraction.

## Decision

Run Stockfish through the `stockfish` npm package (version 18 at the time
of writing, tracking Stockfish 18): a WASM build that runs in Node as a
module, speaks UCI directly, and needs no system binary. A native binary
subprocess is faster per node searched, but it adds a binary to install,
pin, and secure on every host. WASM is the starting point; a measured
throughput problem, not a guessed one, is what would reopen this.

Queue jobs with pg-boss (version 12 at the time of writing), which keeps
the queue in PostgreSQL. The project already runs and tests against real
PostgreSQL, so the queue adds zero infrastructure: no Redis, no SQS
topology, and jobs survive restarts. Workers are Node processes polling
the same database. SQS with Lambda stays the named exit if analysis
volume ever outgrows a worker process, and the 15-minute Lambda ceiling
fits engine analysis comfortably.

## Consequences

Two new runtime dependencies and no new infrastructure. Analysis is
at-least-once and restart-safe from the first commit, and the testing
policy's real-PostgreSQL integration tests cover the queue like any other
table. The costs accepted: WASM analysis is slower than native Stockfish,
and a PostgreSQL queue has lower throughput than a dedicated broker. Both
ceilings are far above what a training app needs on day one, and both
exits (native binary, SQS) are recorded rather than improvised later.
