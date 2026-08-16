# 0035. Minor self-sign-up with guardian consent by email

* Status: accepted
* Date: 2026-08-16
* Supersedes: [ADR-0030](0030-coppa-guardian-consent.md) (the "adult attaches a
  guardian who holds an account" model; the confirm-by-email-link mechanism is
  unchanged)
* Builds on: [ADR-0011](0011-better-auth.md), [ADR-0030](0030-coppa-guardian-consent.md)

## Context

ADR-0030 records COPPA consent through "guardian email-plus": an adult account
owner creates a player and attaches a guardian, where the guardian is an existing
account identified by email, and the guardian confirms by clicking an emailed
link. The model assumed the account owner is an adult, a coach or a parent, who
manages the child's players.

At public sign-up that leaves no path for a minor to sign up themselves. The
under-13 decision for the deployment is that the under-13 path is live, which
needs a way for a minor to sign up and obtain guardian consent rather than
waiting for an adult to create them. The product's users are mostly minors (N7),
so a self-serve minor sign-up with consent is the natural path, not a corner
case.

## Decision

Sign-up collects date of birth alongside the existing name, email, and password.
When the date of birth makes the person a minor (under 13, the COPPA threshold),
sign-up also collects a guardian email address, which must differ from the
sign-up email.

The minor's account is created on sign-up, and a guardian consent request is
created against the guardian email address. The guardian confirms by clicking an
emailed link. The guardian is an email address, not a required account; the
parent's only action is to give consent.

Until the guardian confirms, the minor's account is gated: they hold a session
but cannot use the product, the same consent gate the existing flow applies.

The existing adult-owns-player flow is unchanged. A coach or parent still creates
players and attaches guardians who hold accounts.

## Consequences

The user table gains a date-of-birth column, and sign-up gains two fields, date
of birth and an optional guardian email, surfaced through better-auth's
additional fields rather than a separate sign-up endpoint.

Consent stops being tied exclusively to a guardian account. A consent request can
reference a bare guardian email, and a guardian who later creates an account is
linked to their prior consent, but an account is not a precondition for consent.
The confirm-link mechanism, its token, and its idempotence are unchanged from
ADR-0030.

The age gate is self-reported at sign-up and enforced again at consent. A minor
who enters an adult date of birth is the same COPPA posture as today: we act on
what the sign-up claims, and the consent link is the enforcement point for
anyone who does disclose their age.

The first journey in the deployment story exercises the minor path: sign up with
a minor date of birth, provide a guardian email, and confirm through the link.
