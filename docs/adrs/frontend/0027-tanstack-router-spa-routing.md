# 0027. Use TanStack Router for SPA routing

* Status: accepted
* Date: 2026-08-11
* Builds on: [ADR-0013](../backend/0013-rest-openapi-api-contract.md)

## Context

The frontend is a single-page application with distinct routes: the
dashboard, game analysis, puzzle training, tournament views, and player
profiles. Routing was left open in the frontend ADR index, to be recorded
when the app shell existed. The app shell is about to exist.

The alternatives were React Router, Next.js's file-based router, or a
minimal hand-rolled router.

## Decision

Adopt TanStack Router for client-side routing. It is fully type-safe:
route parameters, search params, and links are checked at compile time, so
a typo in a path or a mismatched param is a build error, not a runtime
404. Search params are first-class typed state, which fits the app's
needs -- the analysis view's position-in-game, the puzzle set's
difficulty filter, and the tournament view's round selection all live in
the URL and all have typed shapes.

React Router is mature but its type safety is partial: params are
strings, search params are untyped, and a wrong link path compiles fine.
Next.js's router is tied to the Next.js framework, and the app is not a
Next.js app. A hand-rolled router is the smallest option but gains
nothing: it would re-solve URL matching, nested layouts, and type safety
for parameters, and get all of them worse.

## Consequences

One new runtime dependency. Routes, params, and search params are typed
end to end, so navigation errors are caught at build time and the URL
carries structured state the components can read without parsing. The
cost is that TanStack Router's type inference is heavier than React
Router's, so build times and the type-check step are slower for the
routing layer specifically. The framework is stable and actively
maintained, and the type safety it buys is the kind of guarantee that
prevents the class of bug a runtime 404 represents.
