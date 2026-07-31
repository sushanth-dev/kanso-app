# 0016. Deliver analysis results over server-sent events

* Status: accepted
* Date: 2026-07-31
* Builds on: [ADR-0014](0014-aws-hosting-layout.md)

## Context

ADR-0014 makes analysis asynchronous: the API accepts the game and returns
immediately, and the result lands in PostgreSQL roughly two minutes later.
That leaves a gap the earlier records did not cover: how the frontend
learns the analysis is ready. The alternatives were polling a status
endpoint, a WebSocket channel, or server-sent events (SSE).

The deciding fact is the compute model. The API is an always-on Node
service (ADR-0014), so it can hold many open connections cheaply, which a
pure-Lambda API could not. That makes a server-push channel viable without
new infrastructure.

## Decision

Use server-sent events. After uploading a game, the SPA opens an SSE
stream for that game; the API holds the connection and pushes an event
when the game row's status flips to complete (or failed). SSE is one-way
server-to-client, which is exactly the shape of "analysis is done," and
the browser's EventSource handles reconnection and framing with no client
library.

Polling a status endpoint is the documented fallback, kept for clients
where a held connection is awkward, and it is what we use until the SSE
path exists. WebSocket was rejected: it is bidirectional, and we have no
client-to-server streaming need, so its protocol and bookkeeping are
weight we would not use.

## Consequences

No new dependency and no new infrastructure; SSE rides the existing HTTP
service. The cost is that the API now holds long-lived connections, so it
must be sized for concurrent open streams, not only request throughput,
and the load balancer idle timeout must exceed the analysis time or the
connection drops mid-wait. The status-flip the stream waits on is the same
status column ADR-0014 already maintains, so the two records share one
source of truth for progress.
