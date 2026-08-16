# 0034. Host the web on Cloudflare static assets

* Status: accepted
* Date: 2026-08-16
* Builds on: [ADR-0007](0007-hono-http-framework.md), [ADR-0015](0015-sst-infrastructure-as-code.md), [ADR-0033](0033-lambda-api-http-api.md)

## Context

`apps/web` is a static Vite build. It has no server-side rendering and no
server-side state; it is a bundle of assets that calls the API. The only
question is where the bundle lives.

Cloudflare already fronts the API, already terminates TLS for
`*.kansochess.app`, and already holds the zone. Hosting the web anywhere else -
CloudFront, S3, a second service - adds a second certificate, a second edge, and
a second place to reason about.

## Decision

Serve the Vite build from Cloudflare Workers static assets via
`sst.cloudflare.StaticSiteV2`, on `app.kansochess.app`, and
`${stage}-app.kansochess.app` for every other stage. The web hostname mirrors
the API's shape, one label deep, so the existing `*.kansochess.app` certificate
covers both and no second certificate is bought.

The price is a scoped Cloudflare API token in `.env`: Workers Scripts (Edit) on
the account, and Zone (Read) on the `kansochess.app` zone. The custom-domain
step auto-creates the web DNS record itself - a CNAME to the Worker's
`workers.dev` origin - so no DNS permission is needed. The API's two records
stay hand-added; only the web record is created by the provider, because the
Worker and the zone are in the same account.

This is a new decision rather than an amendment to ADR-0014, which covers the
API layout and says nothing about the web half.

## Consequences

The web and the API are cross-origin: different subdomains of `kansochess.app`
are same-site but cross-origin. Two things change in the code. The API adds a
CORS allowlist read from `CORS_ORIGINS`, which is also fed to better-auth's
`trustedOrigins` so there is one allowlist rather than two. The web bakes the
API origin into its bundle as `VITE_API_URL` and switches its fetchers to
`credentials: 'include'` so the session cookie travels. The cookie stays
`SameSite=Lax`, which is sufficient and tighter than `SameSite=None` for a
same-site pair.

The repository now holds a Cloudflare credential, scoped to one zone and one
job. It is stored in `.env`, gitignored, and its exact scope is recorded in the
deploy guide so it can be recreated rather than widened.

The web adds nothing to the AWS bill; Cloudflare serves the static assets inside
the free tier. The budget alarm stays sized for the AWS half only.
