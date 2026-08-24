---
name: Kanso Chess
description: Tournament-first chess improvement for junior players and their coaches.
colors:
  primary: "#a03f22"
  primary-deep: "#86341c"
  on-accent: "#ffffff"
  neutral-bg: "#f7f2ea"
  neutral-raised: "#fffdf8"
  neutral-sunken: "#efe6d8"
  ink: "#241d16"
  ink-muted: "#584e42"
  teal: "#0f5e66"
  success: "#4c7a26"
  danger: "#b03a52"
  border-strong: "#847867"
typography:
  display:
    fontFamily: "Source Serif 4, Georgia, serif"
  body:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.55
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
rounded:
  sm: "0.25rem"
  md: "0.5rem"
  lg: "0.75rem"
  full: "9999px"
spacing:
  inset-snug: "0.5rem"
  inset-base: "1rem"
  inset-roomy: "2rem"
  stack-tight: "0.5rem"
  stack-base: "1rem"
  stack-loose: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
  input:
    backgroundColor: "{colors.neutral-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.neutral-raised}"
    rounded: "{rounded.lg}"
---

# Design System: Kanso Chess

## Overview

**Creative North Star: "The Study Room"**

Kanso Chess looks like serious study, not a game. The light theme is a warm
study: paper neutrals, printed-book typography, and one terracotta accent,
credible to a coach and aspirational to a twelve-year-old competitor. The dark
theme, Rapid, is the same study after dark: cool slate surfaces and a
periwinkle accent, because serious young players live in dark mode and a
light-toned board stays the obvious focal point there.

The interface is calm and uncluttered. One action accent per theme, used
sparingly. Depth comes from three steps of brightness, never drop shadows. The
board is always the brightest object on the screen; the interface recedes so
the position reads at a glance.

This is the anti-game-portal: no saturated neon, no red-green status pairs.
Every state carries its meaning in at least two channels, never hue alone.

**Exception: streak and XP.** ST-080 (22 August 2026) approved gamified
engagement elements for the streak counter and XP/level display, since the
reader asked for them directly. They still follow the One Accent Rule, the
Never-Next-to-Green Rule, and the No Hue Alone Rule; they just are not held
to the no-gamified-candy line the rest of the interface is.

**Key Characteristics:**

- Warm paper light theme (Study Room) and cool slate dark theme (Rapid); a
  third high-contrast theme reaches WCAG AAA.
- Print typography: Source Serif 4 display over Public Sans interface, with
  IBM Plex Mono for anything tabular.
- One action accent per theme, scarce by design.
- Flat tonal depth: brightness steps, no drop shadows.
- The board is the brightest object on every screen.

## Colors

Warm paper and ink in the light; cool slate and periwinkle in the dark. The
accent is singular and scarce. Values below are the light (base) theme; the
dark and high-contrast themes override the same roles and are described after.

### Primary

- **Terracotta** (#a03f22): the single action accent in the light theme.
  Buttons, links, and active states. Warm without drifting into saffron. Hover
  and pressed step to #86341c.

### Neutral

- **Paper** (#f7f2ea): the page ground, one step duller than any board theme.
- **Raised Paper** (#fffdf8): cards, panels, the move list. One step brighter
  than page; elevation without shadows.
- **Sunken Paper** (#efe6d8): wells and input grounds, receding behind raised
  content.
- **Ink** (#241d16): primary body text, 14.9:1 on page.
- **Muted Ink** (#584e42): secondary labels, timestamps, captions, held at
  7:1 or better so muted never means illegible.
- **Strong Border** (#847867): control boundaries, 3:1 against page.
- **Teal** (#0f5e66): informational role (coach notes, progress annotations)
  and the focus ring. It is the accent's opposite under deuteranopia and
  protanopia simulation, which is why it owns both.
- **Success** (#4c7a26) and **Danger** (#b03a52): correctness and error.
  Danger is rose-leaning to separate from the terracotta accent. Both always
  carry an icon or label.

### Named Rules

**The One Accent Rule.** One action accent per theme, used on no more than a
tenth of any screen. Its rarity is the point.

**The Never-Next-to-Green Rule.** The action accent is never placed adjacent
to green, so the pair cannot read as a flag or trip red-green deficiency.

**The Board Brightest Rule.** Page surfaces stay a step duller than any board
theme. The board is the brightest object on every screen.

**The No Hue Alone Rule.** Meaning never travels by hue alone. Every state
carries a second channel: an icon, an outline, a border, or a label.

### Dark theme (Rapid)

Page #101418, raised #1a2027, sunken #0b0e11, primary text #edf1f4, muted
#9aa7b2. The accent becomes **Periwinkle** (#7b9dff, hover #97b1ff), light
enough to pass 4.5:1 as text. Info becomes **Cyan** (#3ecbd3), success
#79c578, danger #f08a76, strong border #5a6673.

### High contrast theme

Pure white surfaces and black text, muted #333333, accent #7c2d12, and a
double-ring focus (black over a white offset) to satisfy WCAG 2.4.13 on any
ground. Authored to reach WCAG AAA for all text.

### The board

Two board themes ship at launch, independent of the UI theme. Wood: light
#ead9b7, dark #8f5e38. Tournament green: light #ebecd0, dark #587a41. Both
hold square contrast above 3:1, coordinates at 4.5:1 or better, and all four
piece-on-square combinations at 3:1 or better. White pieces carry a dark
outline; black pieces a light one, so fill contrast never decides legibility
alone. The last move is a gold fill (#e9b44c) plus an ink border, the border
carrying the meaning. Check is a red fill (#8f2b21) with a white icon inside,
always. Hint dots are ink with a paper ring so they hold 3:1 on dark squares.
The evaluation bar is neutral: white and black fills plus a numeric label,
never red-to-green.

## Typography

**Display Font:** Source Serif 4 (Georgia fallback)
**Body Font:** Public Sans (system-ui fallback)
**Mono Font:** IBM Plex Mono (ui-monospace fallback)

**Character:** A printed-book display over a legible grotesque, with a mono
for anything that should line up. Serious without being dry; credible to a
coach, readable by a child.

### Hierarchy

- **Display** (Source Serif 4, 600): headings and marketing, up to 3rem (4xl).
- **Title** (Source Serif 4, 600, 1.375rem): the app wordmark and page titles.
- **Body** (Public Sans, 1rem, line-height 1.55): everything else. Body stays
  at 1.55 or above so the page survives the WCAG 1.4.12 text-spacing override.
- **Label** (Public Sans 600, 0.875rem): field labels and control captions.
- **Mono** (IBM Plex Mono): moves, clocks, coordinates, evaluations.

Sizes run in rem from 0.75 (xs) to 3 (4xl) on an eight-step scale, so browser
zoom and user font-size preferences scale the whole interface. Line heights
are unitless: 1.2 tight, 1.35 snug, 1.55 base, 1.7 relaxed.

### Named Rules

**The Tabular Rule.** Anything that must line up, digit over digit, uses IBM
Plex Mono: moves, clocks, coordinates, evaluations.

## Layout

A single centered column carries the app shell: content max-width 48rem
(max-w-3xl) with 1rem side padding, mobile-first from a 320px floor. Spacing
is a base-4 scale in rem (0.25 to 4), with semantic names for the common
cases: inset snug/base/roomy for padding, stack tight/base/loose for vertical
rhythm. Density is calm; the board gets its own surface rather than competing
with the text column. Layouts must tolerate roughly 40 percent label expansion
for German and French.

The sign-in and sign-up screens narrow to a centered card (`max-w-sm`, 24rem)
inside that column, so the entry forms read as a focused, quiet moment rather
than a full-width form.

## Elevation & Depth

Flat by default. Depth is tonal, not shadowed: three brightness steps,
page, raised, sunken, carry hierarchy. Raised is one step brighter than page,
sunken one step duller. There is no shadow vocabulary; a drop shadow would be
an off-system signal.

**The Flat-By-Default Rule.** Surfaces are flat at rest. Depth is conveyed by
the three brightness steps, never by drop shadows.

## Shapes

Gentle, not sharp, not pill-everything. Radius comes in four steps: sm
(0.25rem), md (0.5rem), lg (0.75rem), and full (pills). Controls use md,
cards and panels use lg. Borders are hairline and decorative where subtle,
strong where a control boundary must be visible. Focus is a teal ring, 2px,
with a 2px offset, distinct from the action accent so focus never reads as
selection.

## Motion

Motion is purposeful and subtle, never decorative. The tokens are fast
(120ms) for control states (hover, press, focus), base (200ms) for reveals and
state changes, and slow (320ms) for route and board transitions. Control
transitions run on the standard ease `cubic-bezier(0.2, 0, 0, 1)`, and reveals
run on the decelerate ease `cubic-bezier(0, 0, 0, 1)`, the cleaner entrance
curve the `.reveal-in` and `.stagger-in` utilities ship. Control transitions
move color, border, and box-shadow; reveals fade and rise 6px. Every duration
collapses to zero under `prefers-reduced-motion`, both in the token theme and
in a CSS override, so no motion runs when reduced motion is requested.

The shipped surfaces layer concrete moves over the tokens. A `.press` utility
scales controls to 0.98 on `:active`, merging the color transition with a
transform so a button feels tactile. A `.stagger-in` list reveals its items in
order, capped at six steps of 45ms, and is used for the report's ranked
weakness list and the focus choice. No route transition ships: the `motion`
AnimatePresence exit left the entering surface stuck at near-zero opacity, so
it was dropped and each surface mounts statically in the shared shell.
Surface-level motion (`.stagger-in`, `.press`, `.reveal-in`) remains. The
evaluation bar's fill transitions over the slow
320ms board transition, and the proof sheet's verdict reveals with the base
200ms fade and rise. The game result on the review surface reveals through
Canvas UI's Particle Reveal, a still frame under reduced motion. Browser
surfaces are themed from the palette: text selection is terracotta on white,
the text caret is terracotta, links carry a 0.06em underline with a 0.22em
offset, and `color-scheme: light` keeps native controls in the Study Room.
The landing hero adds a decorative 3D pawn on a fixed three.js canvas, driven
by scroll (a slow spin plus a tilt that settles upright at the bottom) and
`aria-hidden`; under reduced motion the loop never starts and one static frame
stays.

## Components

### Buttons

- **Shape:** md radius (0.5rem).
- **Primary:** terracotta fill, white text, 44px comfortable target, hover
  and pressed step to the darker terracotta. Astryx `Button` with
  `variant="primary"`.
- **Focus:** teal ring; the global `::focus-visible` fallback uses a 0.25rem
  outline.

### Links

- **Style:** action hue with an underline as the mandatory second channel.
  44px touch target, inline-flex so the tap area covers the text.

### Cards / Containers

- **Corner Style:** lg radius (0.75rem).
- **Background:** raised paper (#fffdf8).
- **Shadow Strategy:** none; see Elevation.
- **Internal Padding:** inset base (1rem).

### Inputs / Fields

- **Style:** raised background, strong border (1px), md radius, 44px minimum
  height, inset padding snug-to-base.
- **Focus:** border and 2px ring both shift to teal; outline suppressed.
- **Error:** conveyed by the Danger color plus a message and icon, never color
  alone.

### Navigation

- **Style:** a hairline bottom border (subtle) under the wordmark: a small
  terracotta mark beside "Kanso Chess" in Source Serif 4. The signed-in
  header carries the wordmark and the horizontal top nav on one row: the nav
  sits to the right of the wordmark and groups routes into native
  `<details>`/`<summary>` dropdowns (Progress, Games) alongside singleton
  links (Plans, Settings). All nav text, summaries and leaves alike,
  is the terracotta accent; the active page is bold, not a hue shift. The
  dropdown opens on hover and closes on mouse leave so it follows the pointer.
  The summary is a md-radius control with the teal focus ring; the open panel
  is a raised-paper surface at 90% opacity with a hairline border, flat by the
  elevation rule. Below the 768px breakpoint the row collapses to a single
  menu icon (Astryx `IconButton` with the `menu`/`close` glyphs) that
  opens the same grouped structure, so one source of truth carries both
  widths. No drop shadows; depth stays the three brightness steps. ST-075's
  "wraps to two rows, no hamburger" decision is superseded; every route it
  made reachable stays reachable.

### Account

The account and its settings are one page at `/settings` (ST-088), because
one account became one player (ST-072) and left each page thinner than its
reason for existing. It reads as one page, not two stapled together: an H1
"Your account" over the identity block (`me.name`), then the settings
sections, Account details (email, See plans), Sign out, and Change password,
each under its own H2, the ladder both pages already used internally. The
former player card is a bare standing section: the streak and level badges
the card already carried, plus the "Edit player" link, and nothing else. The
diagnosis line and the six action links are gone with the card; the navbar
(ST-087) is the way to every surface. The `/account` path prefix is gone
entirely: every authenticated route is top-level (`/settings`, `/report`,
`/focus`, `/proof-sheet`, `/games`, `/import`, `/upgrade`, `/player`), and no
`/account` URL remains.

Sign-up creates the player from the account name, so the page always has a
standing to show. A gated minor never reaches this surface because the router
redirects the `consent_required` answer to the waiting screen.

### Player

The player form is one `Card` at `/account/players/new` and
`/account/players/$playerId/edit`, built from `FormLayout`, `Field`, and
`TextInput`. It renders exactly the `CreatePlayer` and `UpdatePlayer` fields,
grouped into three labelled sections: Identity (display name, birth year),
Federation (FIDE and USCF ids and ratings), and Platforms (Chess.com and
Lichess usernames). The owner is the session, never a field.

A muted line under the heading states the consent model: consent is confirmed
from the guardian email entered at sign-up, and the form records a birth year,
never a full date of birth. It adds no field and no path.

The create screen opens on the fresh form, every optional field empty and the
one required field marked, so a first-time parent sees the shape of the profile
without noise. The edit screen pre-fills from `/me` and answers not-found for a
player the session does not own. The `/me` load renders the router's pending
skeleton, submitting disables the primary button, and failures stay honest: a
400 maps per-field issues back to their fields, a 401 goes to sign-in, a 403
shows the cannot-be-changed message, and any other failure shows a retryable
message rather than a silent reset.

### Report and ranked lists

The ranked weakness report composes from existing primitives rather than a new
component. Each weakness is a `Card` in an ordered list; the rank, the label,
and the headline `ratingLeak` number lead in IBM Plex Mono, with the evidence
(games affected, occurrences, half-points lost) beside it in mono. The stream
is a typed search parameter with a visible segmented toggle, never a silent
default and never blended. A weakness expands into its aggregate (motifs, or
phase and time trouble) through the existing endpoints; an opening weakness
carries its evidence on the row and does not expand, because no opening
endpoint exists. The report has three states: the ranked list, an honest empty
statement ("could not identify a defensible weakness"), and a not-ready state
that separates "still being analyzed" from "no analyzed games."
The header states how current the report is and how much is behind it
(`generatedAt` and `gamesCovered`). The time-trouble figure leads on the online
report; on the tournament report it is replaced by a stated reason, never a
blank or a zero.

### Game review

The review surface is where a player sees the positions behind their mistakes:
a games list at `/account/players/$playerId/games` and one game at
`/account/players/$playerId/games/$gameId`. Both render the existing
`GameDetail` (plies and mistakes) and game list, never a new endpoint.

The board is an in-house SVG component that renders a FEN position with the
mistake's from and to squares marked in the last-move treatment (gold fill,
ink border), in the two board themes and orientable to the mover's side.
Pieces are Unicode chess glyphs with a dark or light outline, so fill contrast
never decides legibility alone. The evaluation bar is an in-house component: a
white and black fill split with a numeric label, never red-to-green, its fill
transitioning over the slow 320ms board transition.

The route lists the game's mistakes in move order; selecting one shows its
position, the move played versus the engine's best, the judgement and
centipawn loss, and the motif where one applies. The game result reveals
through Canvas UI's Particle Reveal, a decorative effect that renders a still
frame under `prefers-reduced-motion` and is `aria-hidden`, per ADR-0017.

### Import

The import form is one `Card` at `/account/players/$playerId/import` with a
method `select` of four explicit options: Chess.com username, Lichess
username, PGN upload, and tournament by name. The fields below switch with the
method, and the stream is stated per method before any request, never a hidden
default. A username import states the 12-month online period; a PGN upload
asks for the stream explicitly through the `StreamToggle`; tournament by name
states "Imports tournament results, not moves." The username is validated
client-side against the provider's charset before any request; a PGN file is
read as text, never rendered; the tournament player name is prefilled from the
player.

The import has six outcomes, never one generic failure. A username success
names the count with a rejected-games sentence appended when any game was
rejected; a PGN success names the count; a tournament success names the count
and states these games carry results, not moves, so no analysis follows. A
successful username or PGN import adds the note that analysis runs next and
arrives asynchronously, pointing to the report rather than promising instant
results. A valid username with no games in the period, and a re-import that
found only duplicates, are both `info` messages: neutral facts, not errors. An
unresolved username (422), an unreachable provider (502), an unmatched
tournament (422), a name mismatch (422, naming the closest surname), a
malformed upload (400, naming which game failed), and the reserved daily cap
(429) are each an `error` naming themselves. The waiting state names the method
and its rough duration ("about a minute" for a season, "a few seconds" for a
file or crosstable); there is no polling. `StatusMessage` carries an `info`
tone, backed by the teal informational role with an "i" icon as its second
channel.

### Focus

The focus surface is one route with two states decided by the active focus:
the choice, when none is set, and the verification trend, when one is. The
choice offers the catalogue from `GET /focuses` alongside a condensed form of
the report's ranking (rank, label, and `ratingLeak` in mono, with a link to the
full report), so a focus is chosen against evidence rather than from a bare
list. Each catalogue entry states which streams it is measured in, and the one
online-only entry says why. A coach instruction is a second path on the same
surface: an instruction textarea paired with a required measurable focus, with
the pairing explained in prose rather than a bare validation error.

The trend is not a chart. The contract carries a baseline and a current value,
two points, and a chart of two points is decoration (ADR-0028 defers TanStack
Charts). Each stream is a `Card` named "Tournament" or "Online". The direction
is a word plus an arrow glyph, never hue: "Improving", "Declining", "Flat",
each with its arrow, so meaning never travels by hue alone. The numbers are
`baselineValue` to `currentValue` in IBM Plex Mono with the measurement's
`unit`, and `windowGames` sits beside every figure so five games reads as five,
not fifty. `insufficient_evidence` is prose, never a zero or an empty chart:
what cannot be said yet, and what would change it. A coach instruction is shown
verbatim as text, marked "Unverified", with the paired focus named and its
numbers labelled as the paired number rather than a measurement of the
instruction.
The choice and the active-focus view each carry an explicit loading and error
state, matching the import and report surfaces rather than one generic
failure. The surface carries no share affordance (that is the proof sheet's,
F14) and no recommendation: a player chooses from the ranking, and the system
does not pick (F8).

### Entry and guardian consent

Sign-in and sign-up render as one centered `Card` (`max-w-sm`) inside the
column, on semantic tokens and Astryx primitives. Each shows a pristine form,
a submitting state (the primary button is disabled and loading), and distinct
errors: rejected credentials, a rate-limit retry-later message, a local
password mismatch, and a local guardian-email mismatch. Sign-up collects date
of birth; when the date makes the person under 13, the guardian email field
and a plain-words explanation reveal together ("A guardian's email is required
for players under 13, so a parent or guardian can confirm consent."), driven
by the same age check the server applies. A `Clouds` ambient renders behind
the entry cards, named by ADR-0017 as the fourth Canvas UI surface.

The two consent surfaces render outside the authenticated shell, like the
proof sheet: no wordmark, no navigation, no sign-in hint. The confirm page
(`/guardians/confirm/$token`) calls the public confirm endpoint with no
credentials and renders exactly two outcomes: "Consent recorded." on a 204,
and the one indistinguishable "This link is no longer available." page for a
tampered, expired, or unknown link. The waiting state (`/guardians/waiting`)
is reached when `/me` answers `consent_required`: it states in plain words
that a guardian has been emailed and must confirm by opening the link, names
no guardian email, and offers a Sign out action so a gated minor is never
trapped.

### Proof sheet

The proof sheet is the first surface built for someone who does not play
chess: a parent who opens a forwarded link and answers, in about a minute,
whether the focus is helping. It renders outside the authenticated shell as a
single quiet centered column (narrower than the app's 48rem), no wordmark, no
navigation, no sign-in hint. The one-sentence verdict leads, in plain English,
with the arrow glyph as the second channel, never hue. The before-to-after
numbers follow in IBM Plex Mono with their unit, each labelled "Before the
focus" or "Since the focus" and carrying its games count beside it, so five
reads as five. The stream and period are one muted line; a coach instruction
is shown verbatim as text. `insufficient_evidence` is a sentence, never a blank
or a zero. The reader's fetch carries no credentials.

The route has four states, all in the same centered column with no chrome: a
two-line skeleton while loading, the loaded sheet, one indistinguishable
unavailable page, and one unreachable page. A revoked, expired, or unknown link
(the API's one 404) shows the plain "This link is no longer available." page.
Anything that never reached the server — a network failure or a 5xx — shows a
distinct "This page could not be reached." page with a "Try again" action that
refetches, never the verdict or a partial sheet, and never the words "no longer
available".

The share act (an explicit create, copy, and confirm-then-revoke) lives on its
own player-scoped surface at `/account/players/$playerId/proof-sheet`, reached
from the player card's "Share proof sheet" link. It lists every live link,
creates a new one, copies it, and revokes after an inline confirm; a free
account is refused with the shared paid-boundary prompt, and a player with no
active focus is sent to set one. It stays out of this reader surface regardless.

### Landing

The landing page is the public marketing surface at `/`, the first thing a
new visitor meets. It renders outside the authenticated shell with its own
wordmark, a sign-in link, and a footer. It refuses the category default of a
headline over three feature cards: the hero is the free output, not a claim
about it. The first viewport is two columns. Left: the display headline
("Know the one thing to fix after every tournament."), the free-promise
subhead, the parent line ("For parents, it makes every lesson you already pay
for work harder."), and the primary call to action. Right: a raised `Card`
labelled "Synthetic example" holding a named tournament and a three-row
ranked weakness list, rank and `ratingLeak` in IBM Plex Mono, mirroring the
report's ranked list without a real player behind it.

Three sections in all: the hero, a value proposition with the free/paid
boundary, and a closing call to action. The value proposition states the
three positioning claims as plain headings, never icon-and-heading cards. The
board is absent by design as the proof: the ranked diagnosis is the proof, so the raised
sample card is the brightest object on the screen, and a decorative, `aria-hidden` 3D pawn on a fixed three.js canvas recedes behind the hero. The boundary is fact-only
from `pricing.md`: free is the diagnosis, paid is the loop, at $15 a month,
$130 a season, or $150 a year. The join call to action routes to `/sign-up`;
a secondary link routes to `/sign-in`. Copy states only facts, and the sample
carries a visible "Synthetic example" label so no visitor mistakes it for a
real diagnosis. One authored reveal eases the sample card in on load through the shared
`.reveal-in` utility (base 200ms), collapsing to zero under reduced motion;
the parallax pawn is the one other effect: scroll-driven, and a still frame under reduced motion. The sprint 12 coherence pass confirmed the sample
ranked list, wordmark, sign-in link, footer, and free/paid boundary already
matched the surfaces around it, and that no route transition ships, so `/`
mounts statically like every other surface.

### Upgrade

The upgrade surface is the one screen where money changes hands, and it
renders that fact as a fact sheet rather than a pitch. At `/account/upgrade`, a
free account sees the boundary stated in plain words: a "What free gives" list
(import by Chess.com or Lichess username plus PGN upload, one diagnosis ranked
by rating cost, and the rating leak number for the top weakness), a "What paid
gives" list of four (a focus with verification, the proof sheet, history across
seasons, and unlimited imports and re-analysis), and three plan cards priced at
exactly $15 a month, $130 a season (September to May), and $150 a year (twelve
months for the price of ten). No discount, no other price, no invented feature;
the copy states facts, never persuasion.

The tier is read from `/me` on load. While it resolves, a skeleton renders in
the page frame (`aria-busy`, `role="status"`), never the pay buttons, so a
paying account never sees the pay action flash before its tier is known. A paid
account renders the already-paid state instead of the pay cards: it names the
paid tier and never offers to charge a paying account again. The navbar is the
way back to the loop (ST-088); no back link rides the page.

The pay action on each card routes through the existing Razorpay checkout
unchanged; no card number is handled by us. The four post-pay states are
distinct and truthful, each carried by `StatusMessage` tone and text, never hue
alone:

- **Confirming** (success): "Payment received. Confirming your upgrade..."
  renders only after the Razorpay handler fires.
- **Processing** (success): "Payment received. Your account has not updated
  yet. Refresh to see your paid tier." renders only after the confirmation poll
  exhausts without a tier flip.
- **Provider unreachable** (error): "Checkout could not open. The payment
  provider could not be reached. Please try again." when the checkout script
  never loaded, so checkout never opened.
- **Checkout failure** (error): "The payment could not be started. Please try
  again." when creating the order failed.

None of the four claims a payment that did not start. Prices render in IBM Plex
Mono (the tabular rule), and the single terracotta accent stays on the pay
action only.

## Do's and Don'ts

### Do:

- **Do** keep one action accent per theme, used on a tenth or less of any
  screen.
- **Do** keep the board the brightest object; page surfaces stay a step
  duller.
- **Do** pair every status color with a second channel: icon, outline, border,
  or label.
- **Do** use md radius for controls and lg for cards.
- **Do** use IBM Plex Mono for moves, clocks, coordinates, and evaluations.
- **Do** hold muted text at 7:1 or better; body line-height at 1.55 or better.
- **Do** target 44px for primary buttons and board squares.

### Don't:

- **Don't** place the action accent next to green.
- **Don't** use red-to-green on the evaluation bar; it is white and black with
  a numeric label.
- **Don't** encode meaning by hue alone.
- **Don't** add drop shadows; depth is the three brightness steps.
- **Don't** introduce a fourth font family; display, interface, and mono are
  fixed.
- **Don't** let the interface outshine the board.
