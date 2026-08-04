# 0020. Run on Node.js 24 LTS

* Status: accepted
* Date: 2026-08-04
* Amends the stated premise of: [ADR-0007](0007-hono-http-framework.md),
  [ADR-0011](0011-better-auth-session-management.md)

## Context

The earlier backend records were written against Node.js 26, which was the
newest release at the time. Node 26 is not a long-term support line. Odd
and even releases both exist for six months as "current"; only even
releases enter active LTS, and Node 26 has not yet. Running production on
a current release means the runtime under the app stops receiving fixes on
a schedule we do not control, and there is no supported line to fall back
to without a version jump.

Node 24 is the active LTS line, at 24.19.0 at the time of writing. The
alternatives were staying on 26 and accepting the support gap, or dropping
to Node 22, which is in maintenance and loses features two of our records
depend on.

Two accepted records name Node 26 as a fact rather than a decision.
ADR-0007 observes that the runtime ships built-in routing, which is why
choosing Hono needed an argument at all. ADR-0011 hashes passwords with
Argon2id from `node:crypto` rather than an npm package. Both premises had
to be checked against 24 before this could be a pin rather than a
regression.

## Decision

Pin the runtime to Node.js 24 LTS. `package.json` declares
`"engines": { "node": "^24.19.0" }` and a `.node-version` file at the
repository root carries `24.19.0`, which mise, fnm, nvm, and the GitHub
Actions setup step all read. CI runs the same version, so a build that
passes on a laptop and fails on the runner cannot be a version difference.

Both premises hold on 24.19.0, verified against the binary rather than
against the release notes. `crypto.argon2` and `crypto.argon2Sync` are
present, so ADR-0011's decision to keep password hashing out of npm stands
unchanged. `URLPattern` is a global, so ADR-0007's built-in-routing
alternative is still a real alternative and the reasoning that rejected it
is still the reasoning.

We move to Node 26 when it enters active LTS, as its own record.

## Consequences

The runtime under the app is supported for as long as we will plausibly
run version one, and security patches arrive on a published schedule. The
cost is that we are one major behind the newest runtime, so a Node 26 API
that would have been convenient is not available to us, and adopting one
means waiting rather than upgrading on the day.

Two accepted records now say "Node 26" in their context sections and are
not edited, because accepted records are immutable
([ADR-0000](../frontend/0000-record-architecture-decisions.md)). This
record is where the correction lives, and it is linked from both. Anyone
reading 0007 or 0011 for the version number rather than for the decision
should read this one instead.
