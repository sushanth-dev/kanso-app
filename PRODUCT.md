# Product

<!-- impeccable:product-schema 1 -->

## Platform

web, plus a browser extension that primes the player in the seconds before a
game on the sites where they already play (ST-153). The extension reads only
the KansoChess API and shows no page content of its own beyond the primer.

## Users

Three personas, in priority order (from `project/main/docs/personas.md`):

- **Player** is the whole of version one. A junior improver rated roughly
  1000 to 1800 who plays rated tournaments and has a coach. Persona: Maya,
  13, 1340 US Chess, one tournament a month, an hour of coaching a week,
  most evenings online. She imports games, gets a ranked diagnosis, sets one
  focus, and finds out later whether it stuck.
- **Coach** is second, and out of scope for version one as an account, but
  load-bearing: the focus comes from the coach's instruction, and coaches are
  how we reach players at all. Persona: Ravi, teaches sixteen juniors, short
  on hours, game review is unpaid labor.
- **Parent** is the buyer, not the user. Persona: Deepa, does not play chess,
  spends two to four hundred dollars a month on her daughter's chess, holds
  the card, cannot evaluate any of it. The page a coach forwards to a parent
  is the screen that decides whether we get paid.

## Product Purpose

Help chess players improve, and earn money doing it. The player reaches a
specific, ranked diagnosis of their own play in the first session, acts on a
single focus, and gets an honest verdict afterwards on whether the work
helped, without waiting for their rating to say so.

Success is the loop, not the report: a player imports, learns something
specific, sets a focus, and imports again to have it checked (objective O2 in
`project/main/docs/business-analysis.md`).

## Positioning

One claim, three parts (from `project/main/docs/positioning.md`):

> Every other tool watches your online games and tells you what you are bad
> at. We watch your tournaments, tell you the one thing to fix, and prove
> whether it worked.

1. **The tournament is a first-class object**, not a filter on a game stream.
   It has a name, date, section, result, and five to nine classical games,
   and it is how a junior, a coach, and a parent already think.
2. **Games arrive without typing** where possible: PGN upload first,
   eventually scoresheet capture.
3. **Verification is two-speed and says which speed it is**: online blitz is
   the fast signal, on the opening and endgame; the next tournament is the
   proof for everything else.

The market is niche on purpose: tens of thousands of players in the US, too
small for Chess.com to chase, which is the moat.

## Operating Context

- Scholastic chess runs September to May; parents budget by season.
- A junior's chess is a household expense, estimated two to four hundred
  dollars a month across coaching, entries, and travel, decided by a parent
  who cannot evaluate it.
- The player's rating is decided by classical tournament games written on
  paper scoresheets, which every existing tool is blind to. Online play is
  faster, looser, and describes a different player.
- Coaches assign work and review games; the product depends on the coach's
  instruction existing even before coach accounts ship.
- The motivation window after a tournament is about two days wide. Nothing
  the player owns currently turns that window into a decision.

## Capabilities and Constraints

Version one in scope (`project/main/docs/business-analysis.md`):

- Account creation and sign-in, with a paying adult attachable to a playing
  child from the start, and a minor able to sign up directly: sign-up collects
  a date of birth, a stated age under 13 creates a guardian consent request,
  and the account is gated until the guardian confirms by email (ADR-0030,
  ADR-0035).
- The age posture is stated age rather than verified age, and it reaches the
  analytics suite: an account that says it is 13 or over, or whose guardian has
  consented, runs the full PostHog suite, while an account that states no age
  sends named product events only (ST-176, ADR-0038).
- Import by Chess.com or Lichess username, plus tournament PGN upload,
  tagged tournament versus online and reported apart everywhere downstream.
- Asynchronous engine analysis of imported games.
- A weakness report aggregated across games, ranked by cost: openings by ECO
  code, missed tactical motifs, evaluation loss by phase, time trouble onset.
- A rating-leak number per weakness, counting only evaluation swings that
  crossed a result boundary.
- One active focus from a versioned catalogue of four measurable options
  (converting won positions, time management, opening repertoire results,
  tactical alertness), or entered from the coach's instruction.
- Verification over a rolling window of recent games, kept separate for
  tournament and online play, with the evidence shown honestly.
- A proof sheet: a shareable before-and-after page a coach sends a parent.
- A free tier (the diagnosis) and a paid tier (the loop), per
  `project/main/docs/pricing.md`.

Deliberately out of scope: playing opponents, our own engine, native mobile
apps (the web app must work on a phone), coach and parent accounts, video
lessons, a coach marketplace, live annotation, scoresheet capture. Practice on
the report's own mistakes ships (ST-101 through ST-103), drawing its drills
from a theme-matched, rating-banded slice of the Lichess puzzle database
(ST-106), and due reviews are dealt ahead of fresh material on a fixed ladder
(ST-122, ST-124). What stays out is free-play browsing of that pool,
player-chosen puzzle sets, generated curricula, and scheduling beyond the
ladder.

Constraints:

- One developer working with AI agents alongside senior year; capacity is
  small and irregular.
- Engine analysis has a real unit cost: measured at about 1.1 cents per game
  and 1.9 cents per tournament of compute, judged against competitors whose
  marginal cost is zero.
- Chess.com and Lichess public APIs make onboarding cheap but are outside
  our control and need watching.

Undecided product facts:

- What coaches pay, if anything, once coach accounts exist.
- What the first coaches get for helping (a permanent early free tier is
  hard to withdraw).

## Brand Commitments

Working title: **Kanso Chess** (rendered in the web app header and page
title). No final name decision is recorded.

Existing binding identity, already version-controlled as DTCG 2025.10 tokens
in `app/main/tokens/` and documented in `project/main/docs/brand-style.md`:

- Two UI themes: **Study Room** (light: warm paper neutrals, Source Serif 4,
  one terracotta action accent) and **Rapid** (dark: cool slate surfaces,
  periwinkle accent). A third, high contrast, reaches WCAG AAA.
- One action accent per theme, never placed next to a green.
- The board is the brightest object on every screen; page surfaces stay a
  step duller.
- Meaning never travels by hue alone: every state carries a second channel.
- Typography: Source Serif 4 (display), Public Sans (interface), IBM Plex
  Mono (moves, clocks, coordinates, evaluations).
- Two board themes: Wood (default) and Tournament green.
- Interface primitives from Astryx (`@astryxdesign/core`); chess-specific
  components (board, move list, evaluation bar) are app-owned.

## Evidence on Hand

- Personas are composites drawn from scholastic chess, not interviews. The
  first ten users are how they get corrected.
- Competitor analysis checked against the live web in August 2026.
- Analysis cost measured (about 1.1 cents per game, 1.9 cents per
  tournament), per `project/main/docs/analysis-cost.md`.
- Testimonials and case studies are not available yet. Future work must not
  fabricate them, and must not present personas, projections, or imagined
  customers as customer evidence.
- Two rendered token reference pages: `project/main/docs/design/`.

## Product Principles

1. The tournament is the unit of truth, not a filter on a game stream.
2. A diagnosis only counts if it leads to a verified focus; the loop is the
   product.
3. Say which evidence you have: online signal versus tournament proof, never
   conflated.
4. The coach and parent are the real gatekeepers even when the player is the
   user.
5. Give away the commodity (diagnosis), charge for what nobody else has
   (verification).

## Accessibility & Inclusion

WCAG 2.2 at level AA is the floor for every screen; high contrast theme
targets AAA. Chess-specific commitments: meaning never encoded in hue alone,
piece-on-square contrast of 3:1 across all four combinations, board
coordinates at full text contrast, and keyboard play plus click-to-move
alongside drag and drop. Full rules in
`project/main/docs/process/design-system.md`.
