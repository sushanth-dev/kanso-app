# 0001. Store design tokens in DTCG format 2025.10

* Status: accepted
* Date: 2026-07-31

## Context

The app and the marketing site share one visual vocabulary, and every
visual decision needs a single machine-readable source of truth. That
requires a file format for design tokens. The alternatives were the
Design Tokens Community Group (DTCG) format, the older Style Dictionary
v3 format, and a hand-rolled JSON schema.

## Decision

Token sources use the DTCG Design Tokens Format Module, version 2025.10,
published 28 October 2025 as the group's first stable release. The
specification is at <https://www.designtokens.org/tr/2025.10/>.

Two qualifications come with the pin. The format is a Community Group
Report, not a W3C standard and not on the standards track. And the
in-progress drafts published under `designtokens.org/tr/drafts/` carry an
explicit instruction not to implement them, so we read the drafts without
following them.

## Consequences

A stable, tool-recognized format with reference implementations in Style
Dictionary, Tokens Studio, and Terrazzo. Values are more verbose than the
v3 style: dimensions and colors are objects (`{ "value": 1, "unit":
"rem" }`, `{ "colorSpace": "srgb", "components": [...] }`), which trips up
anyone porting older token files. The 2025.10 composite types for
gradients and durations are not yet usable end to end; see ADR-0003 for
the workaround.
