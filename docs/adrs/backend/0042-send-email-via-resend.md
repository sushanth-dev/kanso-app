# 0042. Send email through Resend

* Status: accepted
* Date: 2026-09-03
* Builds on: [ADR-0035](0035-minor-self-signup-consent.md), [ADR-0015](0015-sst-infrastructure-as-code.md)

## Context

The product sends exactly one email today: the guardian consent notice, which
`apps/api/src/account/mailer.ts` sends through Amazon SES (v1 `client-ses`),
verified against LocalStack in `mailer.integration.test.ts`, with a
`MAILER_STUB=1` file-recording path for the browser journey. Sprint 20 adds a
second outbound email, the post-tournament nudge (ST-126), and with it the
question of which sender the product standardizes on.

Sushanth directed Resend on 3 September 2026.

The alternatives considered were the incumbent SES, Postmark, and plain SMTP.
SES is already wired and LocalStack-tested, but it was rejected for concrete
reasons rather than inertia: its sandbox-to-production exit is an AWS approval
step, it has no deliverability dashboard or domain-verification workflow worth
the name, and keeping it for the consent notice while Resend serves the nudge
would mean two senders, two configurations, and two test strategies drifting
apart. Postmark has no meaningful free tier. Raw SMTP is everything wrong with
both. Resend starts without a sandbox dance, verifies kansochess.app with
standard DNS records, and shows deliverability on a real dashboard.

## Decision

Every outbound email goes through Resend's REST API over HTTPS, sent from the
existing `mailer.ts` seam. No SDK package is added: the dependency is the
service, and the client is a `fetch` call. The guardian consent notice
migrates to the same sender in the same change, so the product holds exactly
one sender, one key, and one test strategy.

## Consequences

* **Resend becomes a third-party dependency.** `RESEND_API_KEY` lives in the
  deploy shell and follows the ST-110 pattern: checked by length, never by
  value, and a missing key means mail is down, loudly, exactly as a missing
  SES configuration fails today.
* **Domain verification moves to DNS.** kansochess.app needs SPF and DKIM
  records for the sending identity before the first production send. That is
  a human step, named in ST-125's resolution.
* **One sender replaces the incumbent.** The LocalStack SES mailer suite
  retires; its intent survives as a local HTTP recorder that asserts the
  Resend request shape, so a malformed payload still fails a suite instead of
  passing against a stand-in. The consent flow's tests above the seam are
  unchanged.
* **Volume caps shape the design.** Resend's free tier is about 3,000 emails
  a month with a 100-per-day cap and no overage. The nudge paces itself
  under the daily cap (ST-126); the free tier holds until roughly six hundred
  weekly-nudged accounts, beyond which the next plan is $20 a month.
* **Unsubscribe is an obligation, not a courtesy.** Every send carries a
  working List-Unsubscribe header and a one-click route that the selection
  logic honors.
* **The seam stays.** `mailer.ts` remains the only module that knows a
  provider exists, so a future superseding record swaps the provider in one
  file, the way this one did.
