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
ground. Authored to reach WCAG AAA for all text. The theme ships behind
`data-contrast='high'` on the html element (ST-104): Settings offers a
Contrast choice under Appearance, the system's `prefers-contrast: more` hint
sets the initial theme, and a stored choice always wins over the hint.

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

Glass is the one exception to flat, and it is a recipe, not a mood (ST-071,
ST-094): every Card frosts the raised-paper token at 60% opacity over a 16px
backdrop blur, so whatever sits behind reads through the card, blurred. The
recipe keeps one inset top highlight and one soft
ambient shadow as part of the glass treatment; the shadow belongs to the
glass, not to a shadow vocabulary. Muted ink holds 7.7:1 over the mix, so the
contrast floors survive the transparency. The report's analysing list adds
`.glass-raised` (ST-104), the same recipe mixed from white at 55% because the
list sits on a card rather than on the page. Under
`prefers-reduced-transparency: reduce`, the glass surfaces (cards, `.glass`,
`.glass-top`, `.glass-raised`) fall back to their opaque token surfaces with
no blur. Under the high-contrast theme the whole family flattens further
(ST-104): opaque token surfaces, no blur, no glass shadows, and a hairline
`border-strong` boundary on the raised surfaces so a white card keeps an edge
on the white page, while the decorative canvas fields behind content are
hidden entirely.

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
in a CSS override, so no motion runs when reduced motion is requested. The one
exception is the Spinner (ST-093): its canvas keeps the library's slow 3s
rotation under that media query, because a frozen spinner reads as broken
rather than calm.

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
200ms fade and rise.

The sticky navigation header is the one glass surface that must hide what
passes under it (ST-093): `.glass-top` keeps the `.glass` recipe but mixes the
page surface token at 88% instead of 40%, so scrolled content no longer reads
through the bar. Landing sections and the footer keep the lighter `.glass`,
where nothing scrolls beneath.

**Landing motion (ST-133).** The landing page is the one surface driven by
GSAP rather than the CSS token utilities above. A single Lenis instance is
the app's one smooth-scroll engine; it drives from GSAP's own ticker so the
two never compete over a frame, and `ScrollTrigger` refreshes once fonts
finish loading. The hero's headline enters as a word stagger, then the
subhead, parent line, call to action, and sample card follow; the
value-proposition grid and the free/paid boundary each reveal independently
through a `useScrollReveal` hook, the `ScrollTrigger` equivalent of
`.stagger-in` capped at the same six steps. Every move stays on the shared
`--kanso-motion-duration-slow` (320ms) and decelerate ease, so it reads as
the same voice as the rest of the app. `gsap.matchMedia()` branches on
`prefers-reduced-motion`, and a container whose reveal line cannot be
reached even at full scroll (the closing CTA on a compact page) reveals
immediately rather than staying hidden.
The same `gsap.matchMedia()` also branches on
`prefers-reduced-motion` and sets every hero element to its end state with
`gsap.set()`, no tween, so a visitor who asked for less motion sees the
complete page immediately rather than a suppressed animation.

**Icons (ST-133).** Icons ship as Solar, via Iconify's `@iconify-json/solar`
data resolved at build time through `unplugin-icons` into inline SVG
components; there is no runtime Iconify API call. They compose with the
existing Astryx `Icon` component's component mode, the same pattern
`password-input.tsx`'s `EyeIcon` already proved. The landing hero's primary
call to action carries the first one shipped, an arrow-right glyph after the
button label.

## Components

### Buttons

- **Shape:** md radius (0.5rem).
- **Primary:** terracotta fill, white text, 44px comfortable target, hover
  and pressed step to the darker terracotta. Astryx `Button` with
  `variant="primary"`.
- **Focus:** teal ring; the global `::focus-visible` fallback uses a 0.25rem
  outline. Under the high-contrast theme the ring doubles (ST-104): the black
  token outline over a white offset ring, so focus reads on any ground.

### Links

- **Style:** action hue with an underline as the mandatory second channel.
  44px touch target, inline-flex so the tap area covers the text.

### Cards / Containers

- **Corner Style:** lg radius (0.75rem).
- **Background:** frosted raised paper: the raised token at 60% opacity over
  a 16px backdrop blur (ST-094); opaque raised under
  `prefers-reduced-transparency`.
- **Shadow Strategy:** flat by default; the glass recipe carries its own one
  soft ambient shadow and inset highlight, see Elevation & Depth.
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
  `<details>`/`<summary>` dropdowns (Progress, Games) alongside
  singleton links (Plans, Settings). The groups walk the loop the product
  sells (ST-111): Progress leads with the Report and the work it assigns
  (Curriculum, Puzzles, Focus), and Games leads with Import. The Help group
  is gone: ST-112 replaced in-app feedback and what's-new with PostHog
  surveys and the support widget. All nav text, summaries and leaves alike,
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
  One slim dismissible bar may sit above the header: the announcement, its
  wording and one link configured through the PostHog `announcements` flag's
  payload. With no announcement it renders nothing.

### Account

The account and its settings are one page at `/settings` (ST-088), because
one account became one player (ST-072) and left each page thinner than its
reason for existing. It reads as one page, not two stapled together: an H1
"Your account" over the identity block (the username, `me.player.displayName`),
then the settings sections, Account details (email, See plans), Sign out, and
Change password, each under its own H2, the ladder both pages already used
internally. The former player card is a bare standing section: the streak and
level badges the card already carried, plus the "Edit player" link, and nothing
else. The diagnosis line and the six action links are gone with the card; the
navbar (ST-087) is the way to every surface. The `/account` path prefix is gone
entirely: every authenticated route is top-level (`/settings`, `/report`,
`/focus`, `/proof-sheet`, `/games`, `/import`, `/upgrade`, `/player`), and no
`/account` URL remains.

ST-092 groups the page into H2 sections; it is five today: Account details
(email and See plans), Appearance, Default usernames, Security, and the
Danger zone. Security owns both the change-password form and Sign out. The
change-password inputs reveal behind a "Change password" button (progressive
disclosure, not a security control; the rate limiting and rejection copy are
unchanged). Appearance holds the Contrast choice (standard or high) that
ST-104 introduced; it is the section's only control. The Default usernames
section holds the Chess.com and Lichess usernames that prefill the import
form, written through the same `PATCH /me` the player form uses. Sign-in and
sign-up land on the report, not settings, and the report's empty state links
to import, so a player with no games is never stranded.

Each settings section sits on the shared glass Card (Sushanth's ask, 31 August
2026): Account details, Appearance, Default usernames, Security and the Danger
zone render as Cards from `@astryxdesign/core`, so the page carries the same
bordered, ground-tinted surfaces every other page uses. ST-135 states the
decision the redesign asks of this surface: the glass treatment carries
forward unchanged under the new system, and every Card mounts with
`.reveal-in`, the same fade-and-rise entrance the entry surfaces carry, so
the page settles as one gesture instead of appearing inert. The identity
block and the "Your player" badges stay bare under the H1. Every button on
the page carries the `min-h-11 press` 44px treatment, so the touch-target
floor holds by construction.

The username is the player's public handle: what a kid shows to other players
instead of their real name. It is set in the player form and must be unique
across accounts (ST-084). The real name (`me.name`) is kept for guardian-facing
and legal contexts (consent emails, guardian confirmations) and for matching
games against PGN tags and crosstables; it is never the face of the product.

Sign-up creates the player from the account name, so the page always has a
standing to show. A gated minor never reaches this surface because the router
redirects the `consent_required` answer to the waiting screen.

### Player

The player form is one `Card` at `/player`, built from `FormLayout`, `Field`,
and `TextInput`, and it renders exactly the `UpdatePlayer` fields grouped
into three labelled sections: Identity (username, birth year), Federation
(FIDE and USCF ids and ratings), and Platforms (Chess.com and Lichess
usernames). It is an edit form only: sign-up creates the player (ST-072), so
there is no create screen, and the `/account` prefix the old create and edit
paths named is gone (ST-088). The owner is the session, never a field. The
username is the public handle (ST-084): it must be unique across accounts,
and a taken name answers `409 username_taken` rather than silently
overwriting.

A muted line under the heading states the consent model: consent is confirmed
from the guardian email entered at sign-up, and the form records a birth year,
never a full date of birth. It adds no field and no path.

The form pre-fills from `/me` and answers not-found for a player the session
does not own. The `/me` load renders the router's pending skeleton,
submitting disables the primary button, and failures stay honest: a 400 maps
per-field issues back to their fields, a 401 goes to sign-in, a 403 shows
the cannot-be-changed message, and any other failure shows a retryable
message rather than a silent reset. ST-135 gives the Card the same
`.reveal-in` mount entrance as the settings page, and both the Save changes
and Cancel buttons carry the `min-h-11 press` 44px treatment.

### Report and ranked lists

The ranked weakness report composes from existing primitives rather than a new
component. Each weakness is a `Card` in an ordered list; the rank, the label,
and the headline `ratingLeak` number lead in IBM Plex Mono, with the evidence
(games affected, occurrences, half-points lost) beside it in mono. The stream
is a typed search parameter with a visible segmented toggle, never a silent
default and never blended.

ST-098 split the surface in two. The tournament stream without a tournament
picked is a directory: the header, one card per tournament, and nothing else.
Each card opens that tournament's own report (`/report?stream=tournament&tournamentId=…`,
button "Open report"); under six games a card greys out (`opacity-75`,
`aria-disabled`), its button disables, and a full-contrast line states the
shortfall ("A report needs 6 games; this tournament has 3."), so the state
never travels by opacity alone. The directory carries no blended weakness
list: a tournament's diagnosis belongs to the tournament. A scoped report
heads itself with the tournament's name; the online stream keeps the
stream-level report and renders no card, because online play has no
tournaments. The card list is gated on the stream itself, not just the query,
so a cached tournament list cannot leak across a stream switch.

A weakness expands ("Show evidence") into the places behind its own figure:
one line of advice for that kind of weakness, then up to three instances as a
list - the move number, the move played, the engine's better move, the
judgement and centipawn loss - each with a "Review game" link into the game.
The instances come from the same rows and window the leak was summed over, so
the places and the number cannot disagree. An opening weakness carries its
evidence on the row and does not expand, because the games page already lists
the games of an ECO.

ST-111 moved the assigned resources off the report: the card carries a
"View curriculum" link beside the practice link instead of listing the items,
because the curriculum page owns the resources, their assessments, and their
state, and a report that lists them shows the same thing twice. For an
opening weakness the "Get resources" click stays the trigger that writes the
group's resources; the link replaces the list once they exist.

Games still analysing render as a numbered list ("Analyzing 3 games:"),
on the report banner and in the full analysing state alike; a list grows
downward without the reflow that made inline name runs read as flicker. The
server serves the stored report unchanged while games in scope are still
analysing and regenerates once the stream is quiet, so polling never churns
weakness identities mid-batch.

The report has three states: the ranked list, an honest empty
statement ("could not identify a defensible weakness"), and a not-ready state
that separates "still being analyzed" from "no analyzed games."
The rank-one weakness's `ratingLeak` number, the one thing to
fix, is the report's one authored motion moment: the visible digits count up
through a GSAP tween (0.32s, decelerate, whole numbers) on the figure's first
render - a poll refetch carrying the same number never restarts it - while a
visually hidden span carries the value for assistive technology and the
animated digits are `aria-hidden` on top of it. Under
`prefers-reduced-motion: reduce` the figure renders its final value
immediately, with no tween. The remaining weaknesses render as plain mono
text. The ranked list reveals as a stagger, and the page's entry blocks
(header, time-trouble note, narrative card, analysing banner, empty and
not-ready states, the tournament directory's card list) reveal with the
same `reveal-in` treatment the rest of the system uses.

### Game review

The review surface is where a player sees the positions behind their mistakes:
a games list at `/games` and one game at `/games/$gameId`. Both render the
existing `GameDetail` (plies and mistakes) and game list, never a new endpoint.

The board is an in-house SVG component that renders a FEN position with the
mistake's from and to squares marked in the last-move treatment (gold fill,
ink border), in the two board themes and orientable to the mover's side.
Pieces are Unicode chess glyphs with a dark or light outline, so fill contrast
never decides legibility alone. A small circle beside the board marks the
player's own colour (white or black, or a neutral grey when the game has no
player colour set), so the player always knows which side they are; the board
defaults to that colour at the bottom and the player can flip it. The board
renders large, as the brightest object on the screen. The move counter reads in
full moves (a ply pair), not plies. The notation panel sits beside the board
in a bordered, scrollable column that keeps about six moves visible and
auto-scrolls the active move into view; the arrow keys step through the game
(up and down jump to the first and last move). The advantage is shown as a
signed number in the move card (a plus for White's edge, a minus for Black's),
not as a separate bar.

The route lists the game's mistakes in move order; selecting one shows its
position, the move played versus the engine's best, the judgement and
centipawn loss, and the motif where one applies. The game result is the
surface's one authored motion moment (ST-138): the mono figure enters through
a GSAP timeline, a fade and rise on the slow 320ms decelerate token with the
result gloss following on the same ease, the accessible values held in
sr-only spans and the animated figures aria-hidden on top of them, the
dual-span pattern the landing hero established. `gsap.matchMedia()` renders
the final state with no tween under reduced motion, and the DOM's natural
state is that same final state, so the sequence degrades everywhere. The
shared game reader renders the same component over its own gloss.

ST-096 adds an analysing state to the review page for games that are queued,
analysing, or pending with a known colour: a `role="status"` banner with the
Spinner ("Analysing this game. The mistakes and evaluations appear here as
soon as it finishes.") renders between the header and the board, while the
board and notation stay readable underneath, because the importer writes the
un-evaluated plies at import time. The page polls every five seconds and the
banner disappears when the analysis lands; a colourless game shows the
name-your-side prompt instead, because it is waiting for the player, not the
engine. This is also where an upload under six games lands (see Import), so
the loader carries the analysing flow the report would otherwise show.

Every game card and the review page carry a destructive **Delete** action
(ST-089). The games list shows a `Delete` button on each card and the review
header a `Delete game` button beside "Back to games"; both open the same
Astryx `AlertDialog` confirmation ("Delete this game?"), which is the only
place the danger colour appears, so deletion reads as a deliberate, confirmed
act rather than a casual control. Confirming calls `DELETE /games/{gameId}`,
then the list invalidates its `['games', stream]` query so the card disappears,
and the review page navigates back to the games list. The dialog does not
auto-close: it stays open with a loading state while the request is in flight,
and an honest error line ("The game could not be deleted. Please try again.")
is shown if the delete fails rather than a silent reset.

The games list states analysis status explicitly, never with silence. A
`complete` game shows its `Review` link; `pending`, `queued`, and `analyzing`
show "Analysis in progress."; a `failed` game shows "Analysis failed." with a
`Retry` action that re-queues `POST /games/{gameId}/analysis` and refetches
the list. The status text and the Delete button are separate channels, so the
state never travels by hue alone.

ST-138 restyles the surface onto the ST-133 system: the games list's header
and its pending, error, and empty states, and the review page's header,
analysing banner, no-moves card, and share-links section enter with the same
`reveal-in` treatment every surface ships, and the card list keeps its
`stagger-in`. The position section is the deliberate exception: no entrance
wraps the board, on the owner's page or the shared reader's, so ADR-0017's
no-animation-on-the-board rule holds and the player's position is static
from the first frame.

ST-106 replaced the review page's practice replay with Lichess drills: the
flagged mistake card carries a **Drill this pattern** link into `/practice`,
which owns the drill loop itself, the dealt puzzle, the setup move, the three
attempt pips, the wrong-move refusal, and the reveal. None of that runs here.
What the review page keeps from the replay is the lasting rule behind it,
ADR-0017's no-animation-on-the-board line, and the board's aria-label keeps
describing the live position through `describePosition`.

ST-118 gives the review surface its share act. Creation, list, copy, and
confirm-then-revoke live in a "Share links" section below the position on the
review page, built from the same primitives as the proof sheet's shares: a
Card over FormLayout with the native date input for the optional expiry, a
mono link line with Copy beside it, and revoke behind its inline confirm. The
public reader (`/shared/games/$token`) renders outside the authenticated shell
in the same quiet centered column as the other shared pages: mark, "A shared
game review", the PGN names as the heading, the raw result and the one-line
gloss, then the review composition itself - the same board, notation panel,
transport, and mistake card the owner's page renders, read-only. Every account
affordance stays behind the session: no back link, no delete, no
name-your-side prompt, no drill link, and no coach cards, because the
explanation and the Socratic question consume the account's coach budget and
carry generated prose. Opening a link never spends a unit. Its four states are
the proof sheet's: skeleton, payload, the one indistinguishable unavailable
page, and the unreachable page with a retry. The document title carries the
pairing ("White name vs Black name"), so a browser tab names the game it
holds.

### Import

The import form is one `Card` at `/import` that mounts with `reveal-in`, the
same entrance as every surface since ST-134: the heading, the supporting line
naming the player, and the form. The method `select` offers three options -
Chess.com username, Lichess username, and PGN upload - matching the API
contract: `StartImport.source` is `chesscom | lichess | pgn_upload`. There is
no tournament-by-name method; ST-084's name matching serves PGN uploads'
crosstables server-side. The fields below switch with the method. A username
import prefills from the player's stored username for the provider the moment
the method is picked and states "Imports the last 12 months of online
games."; a PGN upload asks for the file. The stream is fixed per method,
never chosen: a username import is online, a PGN upload is tournament, and
the PGN branch submits its stream as a hidden default, with nothing about it
stated on the surface. The username is validated client-side against the
provider's charset before any request; a PGN file is read as text, never
rendered, and a missing file is a field error before any request.

A successful import, from any method, is one shape: it names the count,
appends a rejected-games sentence when any game was rejected, and appends the
side sentence when games could not be tied to the player's colour (ST-095) -
those games are stored, but analysis will not start on its own, and the
sentence tells the player to open each under Games and pick the colour they
played to start it. A valid username with no games in the period, and a
re-import that found only duplicates, are both `info` messages: neutral
facts, not errors. An unresolved username, an unreachable provider, a batch
over the size limit, and the reserved daily cap are each an `error` naming
themselves; a malformed upload names itself and lists, per game, the path
and message that failed, in a danger list. A 403 renders "This player cannot
be imported from this account."; a 401 returns to sign-in; anything else
falls back to "The import failed. Please try again." The waiting state names
the method and its rough duration ("about a minute" for a season, "a few
seconds" for a file"); there is no polling. `StatusMessage` carries an
`info` tone, backed by the teal informational role with an "i" icon as its
second channel.

ST-115 redelivers where a successful import lands. A tournament batch that
imported games never navigates: it ends in the debrief on the same page,
whose skip carries `gameId` only when the tournament holds fewer than six
games (or the batch names no tournament), so the skip lands on that game's
review where the ST-096 landing used to be. Every other import - online
batches, and a tournament batch whose games were all rejected - lands on the
report with the batch's ids riding along (ST-093), so the analysing counter
counts this upload only. ST-096's landing paragraph is superseded.

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
what cannot be said yet, and what would change it. A coach instruction is
shown verbatim as text, marked "Unverified", with the paired focus named and
its numbers labelled as the paired number rather than a measurement of the
instruction.

The active-focus verdict number is the surface's one authored motion moment
(ST-139): the mono `baselineValue → currentValue unit` line enters through a
GSAP timeline, a fade and rise on the slow 320ms decelerate token with the
`windowGames` line following on the same ease, the accessible value held in
an sr-only span with the animated figure aria-hidden on top of it, the
dual-span pattern the landing hero established. `gsap.matchMedia()` renders
the final state with no tween under reduced motion, and the DOM's natural
state is that same final state, so the sequence degrades everywhere. The
mechanic is shared: `use-reveal-sequence.ts` is the one hook behind the
focus verdict and the game result's reveal, extracted when the verdict
became its third caller.

ST-139 restyles the surface onto the ST-133 system: the route's loading and
error states, both states' headers, the ranking section (its pending
skeleton included), the coach-instruction card and form, the catalogue focus
card, the practice line, both trend cards, and the assignment-links section
enter with the same `reveal-in` treatment every surface ships, and the
catalogue grid keeps its `stagger-in`. The public shared assignment reader
carries the same entrances on its header lines, its instruction block, and
each of the confirm section's four states, minus every account affordance,
exactly as it does today.

ST-117 adds the assignment link to the same surface. Creation, list, copy, and
confirm-then-revoke live in an "Assignment links" section on the focus page in
both of its states, built from the shared primitives: a Card over FormLayout
with a catalogue select, an instruction textarea, and the native date input
for the optional expiry. The public reader (`/shared/assignments/$token`)
renders outside the authenticated shell like the shared proof sheet, in the
same quiet centered column: the focus title and description, then the coach's
instruction verbatim under its label, then the one confirm action. Its four
states are the proof sheet's: skeleton, payload, the one indistinguishable
unavailable page, and the unreachable page with a retry. Confirming asks for
the session first - signed out it offers sign-in, consent-gated it points to
the waiting page, and a paid boundary names the paid loop rather than failing
quietly.

### Entry and guardian consent

Sign-in, sign-up, forgot-password, and reset-password each render as one
centered `Card` (`max-w-sm`) inside the column, on semantic tokens and Astryx
primitives. Every state of every one of these `Card`s carries `.reveal-in`
(ST-134), so the surface fades and rises 6px on mount instead of appearing
inert; the class is on every returned `Card`, not just the first render, so
switching between a form and its success/error state re-triggers the same
entrance. Sign-in and sign-up each show a pristine form, a submitting state
(the primary button is disabled and loading), and distinct errors: rejected
credentials, a rate-limit retry-later message, a local password mismatch, and
a local guardian-email mismatch. Sign-up collects date of birth; when the
date makes the person under 13, the guardian email field and a plain-words
explanation reveal together ("A guardian's email is required for players
under 13, so a parent or guardian can confirm consent."), driven by the same
age check the server applies. Forgot-password and reset-password follow the
same shape: a pristine form, a rate-limit and generic-failure error, and a
confirmation state ("Check your email", "Password reset") that links back to
sign-in; reset-password additionally renders an "invalid link" state for a
used, expired, or malformed token.

The two consent surfaces render outside the authenticated shell, like the
proof sheet: no wordmark, no navigation, no sign-in hint. Each keeps its own
`<main>` landmark (the bypass-list precedent shared with the proof sheet and
the nudge-unsubscribe page) and wraps its content in the same `reveal-in`
`Card` used across the rest of entry, rather than a bare, unstyled block. The
confirm page (`/guardians/confirm/$token`) calls the public confirm endpoint
with no credentials and renders exactly two outcomes: "Consent recorded." on
a 204, and the one indistinguishable "This link is no longer available." page
for a tampered, expired, or unknown link. The waiting state
(`/guardians/waiting`) is reached when `/me` answers `consent_required`: it
states in plain words that a guardian has been emailed and must confirm by
opening the link, names no guardian email, and offers a Sign out action so a
gated minor is never trapped.

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
Every block enters with the one `reveal-in` fade: the supporting line and
heading first, then the verdict, the figures or `insufficient_evidence`
sentence, the stream and period line, and any coach instruction; the skeleton,
unavailable, and unreachable pages enter the same way, and under
`prefers-reduced-motion: reduce` everything renders settled immediately.

The route has four states, all in the same centered column with no chrome: a
two-line skeleton while loading, the loaded sheet, one indistinguishable
unavailable page, and one unreachable page. A revoked, expired, or unknown link
(the API's one 404) shows the plain "This link is no longer available." page.
Anything that never reached the server — a network failure or a 5xx — shows a
distinct "This page could not be reached." page with a "Try again" action that
refetches, never the verdict or a partial sheet, and never the words "no longer
available".

The share act (an explicit create, copy, and confirm-then-revoke) lives on its
own account surface at `/proof-sheet`, reached from the Progress nav group. It
lists every live link, creates a new one, copies it, and revokes after an
inline confirm; a free account is refused with the shared paid-boundary
prompt, and a player with no active focus is sent to set one. It stays out of
this reader surface regardless. The surface enters the same way: the header
first, then the create card and the share-link list, under the same
reduced-motion collapse.

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

Four sections in all: the hero, a value proposition with the free/paid
boundary, the technology behind the diagnosis, and a closing call to action.
Each section sizes to its content with a generous `py-12 md:py-16`
padding, so the page reads as four joined bands rather than four screens
of white space; the scroll-triggered reveals run on the sections as they
enter view.
The value proposition states the three positioning claims as plain headings, never
icon-and-heading cards. The technology section names Stockfish (the
open-source engine checking every game), GLM-5.3-Flash (the model writing
each weakness's coaching explanation), and Lichess (the open platform ratings
and imports reach directly), the same plain-heading treatment, with no
company marks: Iconify's `Logos` set is not installed, and adding it for a
name-check is not worth a new dependency. The
board is absent by design as the proof: the ranked diagnosis is the proof, so the raised
sample card is the brightest object on the screen. The boundary is fact-only
from `pricing.md`: free is the diagnosis, paid is the loop, from ₹799 a month
on the paid plans. The join call to action routes to `/sign-up`;
a secondary link routes to `/sign-in`. Copy states only facts, and the sample
carries a visible "Synthetic example" label so no visitor mistakes it for a
real diagnosis.

**ST-133** rebuilt the hero's composition and motion narrative in place,
without touching the Study Room color or type system above: this is a new
sequence on the same palette and typeface, not a new look. The headline
carries a dual rendering — an unsplit, screen-reader-only accessible name,
and a decorative, `aria-hidden` word-by-word duplicate the intro timeline
animates — so the complete headline is present with no JavaScript, and only
its motion depends on GSAP. On mount, the words stagger in first, then the
subhead, parent line, call to action, and sample card follow as one group,
overlapping slightly with the words so the whole hero settles as a single
gesture rather than two disconnected reveals; see Motion above for the
Lenis/GSAP wiring and the reduced-motion behaviour, which is identical here
to the rest of the page: every element snaps to its end state immediately,
no tween. The value-proposition grid and the free/paid boundary each reveal
on scroll through the same `useScrollReveal` hook, independently of each
other and of the hero, and the closing call to action reveals the same way.
The sprint 12 coherence pass confirmed the sample ranked list, wordmark,
sign-in link, footer, and free/paid boundary already matched the surfaces
around it; that still holds. No route transition ships, so `/` mounts
statically like every other surface.

### Upgrade

The upgrade surface is the one screen where money changes hands, and it
renders that fact as a fact sheet rather than a pitch. At `/upgrade`, a
free account sees the boundary stated in plain words - "Your first diagnosis is
free. The loop after it is paid." - and three plan cards, each stating its
games-analysed limit, its feature list, and its one monthly price. Beginner
is free (30 games a month, one ranked diagnosis, 10 coach explanations);
Intermediate is ₹799 a month (150 games, the full loop: focus, verification,
proof sheet, unlimited imports, 100 coach explanations) and is marked "Most
popular"; Pro is ₹1,299 a month (uncapped, unlimited coach explanations,
plus history across seasons). No discount, no other price, no invented
feature; the copy states facts, never persuasion.

The three cards sit in a three-column grid that collapses to one column at
the 320px floor. Intermediate is given visual prominence beyond the orange
"Most popular" badge: its card carries a terracotta border (`border-accent`),
the single place the accent appears on the surface besides the primary pay
action, so the recommended plan reads as raised without breaking the
flat-by-default rule. Prices render in IBM Plex Mono (the tabular rule) with
a `/month` unit in supporting type beside them; the terracotta accent stays
on the pay action and the recommended card only.

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
  yet. Refresh to see your new plan." renders only after the confirmation poll
  exhausts without a tier flip.
- **Provider unreachable** (error): "Checkout could not open. The payment
  provider could not be reached. Please try again." when the checkout script
  never loaded, so checkout never opened.
- **Checkout failure** (error): "The payment could not be started. Please try
  again." when creating the order failed.

None of the four claims a payment that did not start. Prices render in IBM Plex
Mono (the tabular rule), and the terracotta accent stays on the pay action and
the recommended card's border only.

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
