# 0007. Use Hono as the HTTP framework

* Status: accepted
* Date: 2026-07-31

## Context

The API service needs an HTTP framework. Node 26 ships built-in routing,
but validation, error handling, and OpenAPI generation would all be
hand-rolled on top of it. The alternatives were Express, Fastify, NestJS,
and Hono. Express 5 is stable but its middleware model is old and its
TypeScript support is bolted on. Fastify is fast and mature but carries a
plugin ecosystem we do not need yet. NestJS is a framework with opinions
about everything, sized for large teams. Hono is small, TypeScript-first,
and runs on Web-standard Request and Response objects.

## Decision

Use Hono (version 4.12 at the time of writing), served on Node through
`@hono/node-server`. Route handlers are plain functions over Web-standard
request and response objects, which keeps the framework thin and makes
handlers testable without a running server. Validation attaches through
the Zod validator middleware, so the same schema defines the request shape
and its OpenAPI documentation.

One scope limit comes with the choice. Hono is the HTTP layer, nothing
more: no dependency injection container, no module system, no decorators.
Application structure stays ours, organized by feature rather than by
framework convention.

## Consequences

One new runtime dependency, smaller than any alternative at this layer.
Hand-rolled routing on Node's built-in server is avoided. The trade-off
accepted is the absence of NestJS-style structure out of the box; we get a
framework that stays out of the way and an architecture we have to keep
disciplined ourselves. Because handlers are Web-standard functions, a
future move to a different host (Lambda, an edge runtime) does not force a
rewrite of the route layer.
