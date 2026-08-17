# 0037. Proof sheet composition

* Status: accepted
* Date: 2026-08-17
* Builds on: [ADR-0036](0036-verify-focus-rolling-window.md)

## Context

F14 freezes a player's active focus and its before-and-after numbers into a
shared page. Four things about that freeze are choices, not implementation
details: which stream the single shared shape carries, what before and after
mean, what the page says when the verdict refuses, and whether a minor's display
name belongs on an unauthenticated page.

## Decision

* **Stream** — the composer picks; the player never chooses. Every stream the
  focus is measurable in is measured, then picked by evidence: a verdict beats a
  refusal; among verdicts (all at ten games) the catalogue's declared order
  decides; if every stream refuses, the most evidenced (largest `windowGames`)
  and then the declared order decides.
* **Before and after** — ADR-0036's split reused unchanged: before is the ten
  most recent analysed games before `focus.startedAt`, after is the ten most
  recent since. `beforeValue`/`afterValue` are the two halves' values;
  `gamesBefore`/`gamesAfter` their sizes; the period is the span of the
  evidence, oldest before-game to newest after-game, falling back to
  `startedAt` when a half is empty.
* **Refusal** — a focus with no verdict is served honestly: the values are null
  and the trend is `insufficient_evidence`, with the games behind it still
  stated. Never a 404, never zeros.
* **Display name** — kept. The contract already fixes `playerDisplayName`, the
  parent needs to know whose sheet it is, and the explicit share act (N5) plus
  revocability (N8) is the consent for the name to leave the account. The sheet
  carries no birth year, no rating, no game list, no account.

## Worked example

A focus measurable in both streams. The tournament stream has ten games in each
half and the verdict is `flat` (0.50 to 0.55); the online stream also has ten
games in each half and the verdict is `improving` (0.40 to 0.60). Both are
verdicts, so the catalogue's declared order settles it and the sheet freezes the
tournament numbers. A focus committed before its first analysed tournament game
has an empty baseline there and refuses; the composer then falls back to the
online stream rather than answering 404.

## Alternatives considered

### Let the player choose the stream

* Pros: the player knows which stream their coach cares about.
* Cons: adds a picker to an already-deep share flow, and a focus measurable in
  one stream makes the choice a no-op. The composer's evidence rule picks the
  same stream a coach would pick, deterministically.
* Rejected.

### Redact the display name

* Pros: less identifying information on an unauthenticated page.
* Cons: the parent cannot tell whose sheet it is, which defeats the page. The
  name is the player's chosen chess name, and the explicit share act is the
  consent. The risk is mitigated by carrying nothing else identifying.
* Rejected.

### Answer 404 on a refusing focus

* Pros: no half-empty page.
* Cons: "no verdict yet" is the honest answer a coach forwards while evidence
  accumulates, and the games behind it are the point. A 404 hides the loop from
  the exact person F14 is for.
* Rejected.

## Consequences

* The shared route serves `proof_sheet.snapshot` and nothing else, so the
  stream, values, and period are frozen at creation.
* The four decisions are pure functions in `proof-sheet/compose.ts` and pinned
  by unit tests.
* A focus measurable in one stream always shares that stream; the composer's
  rule is the general case of it.
