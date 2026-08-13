# 0030. Record COPPA consent through guardian email-plus

* Status: accepted
* Date: 2026-08-13
* Builds on: [ADR-0011](0011-better-auth-session-management.md), [ADR-0018](0018-ai-explanation-layer.md)

## Context

Requirement N7 is a launch blocker: most of our users are minors and some are
under thirteen, which brings COPPA obligations around what we collect and
around verifiable parental consent. The product serves all ages, deliberately.
The youngest improvers gain rating fastest and gating to thirteen-plus would
cut the segment the positioning starts from, so the age-gate option was
rejected rather than deferred.

The schema already anticipated the mechanism without choosing it:
`guardian_link` carries `relationship`, `consent_granted_at`, and
`consent_method`, all nullable, with the comment that the mechanism that fills
them is undecided. The contract already declares `POST
/players/{playerId}/guardians` with a description that says the same thing.
ADR-0018 left one open item that this record closes: sending a child's game
data to a third-party model provider (Gemini Flash) is a disclosure our COPPA
decision has to answer.

## Decision

We serve all ages, and consent is recorded through the guardian attach
endpoint using the FTC "email plus" method: the guardian attaches to a player,
we send a COPPA notice and a confirm link through AWS SES, and the guardian's
affirmative confirmation records `consent_method = "email"` and
`consent_granted_at` on the `guardian_link` row.

Email plus is the verifiable-consent method that fits the free tier and a solo
developer: it needs no payment instrument and no document handling. It is
approved by the FTC only for internal use, so it binds the AI layer (below),
and that binding is the honest cost of the method.

## Consequences

* **AWS SES becomes a dependency.** The notice and confirm email go through
  SES, approved at sprint 5 planning. The mailer sits behind a seam the way the
  session reader does in ADR-0011, so tests assert the flow with a fake and the
  production default is SES.
* **Under-13 data is internal-use only.** Email plus does not cover disclosure
  to a third party. The AI explanation layer (ADR-0018) sends game data to
  Gemini, so it must not receive an under-13 child's data until this record is
  revisited and either a stronger consent method is adopted or the provider is
  moved inside the AWS account (Bedrock was the rejected close option in
  ADR-0018). This is recorded as a constraint, not resolved here; the AI layer
  is not built in the sprint that adopts this record.
* **The guardian must be an existing user.** `guardian_link.guardian_user_id`
  is not null and references `user.id`, and the attach body carries an email,
  so the email resolves to an account. Inviting a not-yet-signed-up guardian is
  deferred, not implied.
* **Nothing here exposes sign-up.** Recording consent closes the COPPA blocker;
  exposing sign-up to a real user additionally needs the sign-in rate limit
  (DEBT-008) and a frontend, which are separate stories.
