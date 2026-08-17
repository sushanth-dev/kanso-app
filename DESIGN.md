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

This is the anti-game-portal: no saturated neon, no gamified candy, no
red-green status pairs. Every state carries its meaning in at least two
channels, never hue alone.

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
state changes, and slow (320ms) for route and board transitions, all on the
standard ease `cubic-bezier(0.2, 0, 0, 1)`. Control transitions move color,
border, and box-shadow; reveals fade and rise 6px. Every duration collapses to
zero under `prefers-reduced-motion`, both in the token theme and in a CSS
override, so no motion runs when reduced motion is requested.

The shipped surfaces add four concrete moves on top of the tokens. A `.press`
utility scales controls to 0.98 on `:active`, merging the color transition with
a transform so a button feels tactile. A `.stagger-in` list reveals its items
in order, capped at six steps of 45ms, and is used for the ranked weakness
list. Browser surfaces are themed from the palette: text selection is
terracotta on white, the text caret is terracotta, links carry a 0.06em
underline with a 0.22em offset, and `color-scheme: light` keeps native controls
in the Study Room.

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
  terracotta mark beside "Kanso Chess" in Source Serif 4. The single centered
  column is the whole navigation model at this stage; no persistent side or
  top nav exists yet.

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

### Import

The import form is one `Card` with a provider `select` (Chess.com or Lichess)
and a username `TextInput`, both through the existing `Field` wrapper. The
period is stated rather than implied: "Imports the last 12 months of online
games." The submit is a primary `Button`, with a secondary "Back to account"
link. The username is validated client-side against the provider's charset
before any request.

The import has six outcomes, never one generic failure. A successful import is
a success `StatusMessage` naming the count, with a rejected-games sentence
appended when any game was rejected. A valid username with no games in the
period, and a re-import that found only duplicates, are both `info` messages:
neutral facts, not errors. An unresolved username (422) and an unreachable
provider (502) are `error` messages naming the provider. The waiting state is
an `info` message ("this usually takes about a minute"); there is no polling.
`StatusMessage` carries an `info` tone for the first time here, backed by the
teal informational role with an "i" icon as its second channel.

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
or a zero. A revoked, expired, or unknown link shows one plain "This link is no
longer available." page. The reader's fetch carries no credentials.

The share act lives on the focus screen as a `Card`. It is an explicit create
button, never a toggle; after creation it shows the link with a copy action and
the creation date, and a revoke action that confirms before it removes the
link. Revocation reflects the server's answer and reads as "revoked" rather
than silently disappearing.

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
