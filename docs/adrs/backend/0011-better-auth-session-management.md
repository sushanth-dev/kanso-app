# 0011. Use better-auth for session management

* Status: accepted
* Date: 2026-07-31
* Runtime version corrected by: [0020](0020-node-24-lts-runtime.md)

## Context

The app has three roles (player, coach, parent) over personal data that
will include minors, so authentication is the highest-stakes piece of
plumbing in the system. The alternatives were hand-rolled sessions, Auth.js,
and better-auth. Lucia, formerly the standard recommendation, was
deprecated in March 2025, and its maintainer's suggested path is
hand-rolled sessions.

## Decision

Use better-auth (version 1.6 at the time of writing). It is
framework-agnostic, works against Hono and Drizzle, and covers email and
password now with social providers and role modeling available later,
against the same Drizzle schema.

One part is ours regardless. Password hashing uses the Argon2id support
built into Node 26's `node:crypto` (`crypto.argon2`), not an npm package.
The algorithm and its parameters stay explicit and pinned in code rather
than delegated to library defaults.

Hand-rolled sessions were seriously considered: sessions are a solved
shape, and a few hundred lines would carry no auth dependency. Rejected
because authentication is the place where the subtle mistakes live
(session fixation, token rotation, timing leaks), and the minors' data
bar argues for code that is maintained and audited by more eyes than
ours.

## Consequences

One new runtime dependency plus its schema tables in our database. Auth
behavior we would otherwise have to design and test ourselves, token
rotation, session expiry, email verification, comes maintained. The cost
is a framework-shaped abstraction at the security boundary, so upgrades
to it get the same reading that Drizzle's 0.x releases get, and the auth
configuration is reviewed as security-sensitive code, not plumbing.
