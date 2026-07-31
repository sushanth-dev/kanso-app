# 0000. Record architecture decisions

* Status: accepted
* Date: 2026-07-31

## Context

Some decisions shape everything built after them: the frontend framework,
the database, how colors reach the screen. Months later, "why did we do it
this way" is unanswerable from the code, because the code only shows what
was chosen, never what was rejected or why.

## Decision

Record every significant technical decision as an architecture decision
record (ADR): a short, numbered markdown file in this directory.

* One file per decision, named `NNNN-short-title.md` with a four-digit,
  zero-padded number that never changes and is never reused.
* Sections: Status, Date, Context, Decision, Consequences.
* Status is one of `proposed`, `accepted`, `deprecated`, or `superseded by
  NNNN`.
* Accepted records are immutable. A changed decision is a new record that
  supersedes the old one; the old record stays, marked and linked.
* Context and consequences are honest: name the alternatives considered
  and the costs accepted, not only the benefits.

## Consequences

Every significant decision has a written, dated rationale that survives
staffing changes and fading memory. The cost is one short document per
decision, written while the reasoning is fresh. A decision too small to
bother recording is exactly that: too small to bother recording.
