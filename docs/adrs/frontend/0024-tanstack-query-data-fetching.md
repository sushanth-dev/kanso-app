# 0024. Use TanStack Query for REST data fetching and caching

* Status: accepted
* Date: 2026-08-11
* Builds on: [ADR-0013](../backend/0013-rest-openapi-api-contract.md), [ADR-0016](../backend/0016-sse-analysis-result-delivery.md)

## Context

ADR-0013 settled the contract: the frontend consumes REST through a
generated TypeScript client, not hand-written fetch. That decision covers
how a call is made, not what happens to the result. Game lists, player
profiles, tournament standings, and puzzle sets are read often, navigate
between each other, and change when the user acts on them. Without a
caching layer every route transition and every refocus re-fetches, and
stale data after a mutation is a class of bug the team writes guards for
by hand.

The alternatives were SWR, a hand-rolled cache on top of the generated
client, or no cache layer at all.

## Decision

Adopt TanStack Query (v5) as the caching and mutation layer over the
generated client. The generated client remains the only thing that talks
to the API; Query wraps its return values, never replaces the call. Query
keys are derived from the endpoint and parameters so invalidation is
deterministic: a mutation invalidates the keys it affects, and the next
read refetches.

One boundary is explicit. ADR-0016 delivers analysis completion over
server-sent events through the browser's native `EventSource`, with no
client library. Query has no SSE integration and will not gain one here.
The SSE stream stays on `EventSource`; Query covers the REST calls that
fetch and mutate state, and the SSE handler invalidates the relevant
Query keys when an analysis-completion event arrives so the UI refetches
without polling.

## Consequences

One new runtime dependency (~15 KB gzip). Route transitions and refocus
serve from cache and refetch in the background, so the UI stays
responsive and stays correct after mutations without hand-written
invalidation scattered across components. The cost is that Query becomes
the lens through which server state reaches the UI: a call that bypasses
Query is a call whose cache will not invalidate, so the boundary between
Query-managed REST and `EventSource`-managed SSE is enforced in review,
not just in convention.
