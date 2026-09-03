# 0038. Record product events with PostHog

* Status: accepted
* Date: 2026-08-18
* Builds on: [ADR-0030](../backend/0030-coppa-guardian-consent.md), [ADR-0034](../backend/0034-cloudflare-static-web.md)

## Context

Business analysis records three objectives whose measures are product events:
O1 (a first session goes from import to report in one sitting), O2 (a focus is
set and verified) and O3 (a free session converts to paid). Each is a fact the
product must record as it happens, not reconstruct later from logs. ADR-0034
deploys the frontend as a static site on Cloudflare, so there is a natural
place for a client-side analytics SDK.

The constraint that shapes this decision is ADR-0030: consent is recorded by
the FTC email-plus method, which is approved only for internal use, so an
under-13 child's game data must not go to a third-party provider. Any analytics
provider is exactly that kind of third party.

The alternatives considered were building our own event table and querying it,
using another closed SaaS (Mixpanel or Amplitude), or PostHog. Our own table was
rejected because it reimplements what an analytics product already does and
leaves the funnel and retention questions without a dashboard. Mixpanel and
Amplitude were rejected for the same reasons against a solo operator: closed,
metered free tiers, and no self-host path for when the COPPA data-residency
question gets harder. PostHog is open source, has a JS SDK, a free tier, and a
self-host option that exists if residency ever demands it.

## Decision

Record the named product events for O1, O2 and O3 with the PostHog JS SDK,
using the public client key in the browser. Every event carries properties
only, and no event carries a game position, an analysis, or identifying data of
a child we have not cleared, because ADR-0030 binds that data to internal use.
The event names are a documented contract maintained in the story that ships
them.

## Consequences

* **PostHog becomes a third-party dependency.** A new SDK and a new service,
  approved at sprint 11 planning. The client key is public by design; nothing
  server-side ships a secret to the browser.
* **The COPPA boundary is load-bearing.** Email-plus consent (ADR-0030) does
  not cover disclosure to a third party, so the event payload is property-only
  and is the one place this record is strict rather than minimal. A game
  position or a child's name in an event is a defect, not an oversight.
* **Event names become a contract.** Later stories reuse the O1, O2 and O3
  events rather than invent new ones, so the funnels stay comparable over time.
* **Data residency is deferred, not ignored.** PostHog Cloud is the default.
  The self-host option exists if the COPPA or residency picture changes, at
  which point this record is superseded rather than quietly patched.

## Amendment 2026-09-03

Sushanth turned the minimal surface into the full PostHog product suite
(ST-112): web analytics (autocapture and pageviews), session replay, surveys,
the support widget, feature flags, and error tracking. The property-only rule
now governs only the explicit events, which keep their names and whitelist.
Autocapture and session replay read the DOM and the URL, so game content and
whatever is on screen reaches PostHog Cloud; we accepted that trade for
PostHog's robustness, and it retired the ST-111 in-app feedback and what's-new
pages the same day, replaced by PostHog's surveys and support. `identify`
stays off. The self-host escape hatch below is unchanged.
