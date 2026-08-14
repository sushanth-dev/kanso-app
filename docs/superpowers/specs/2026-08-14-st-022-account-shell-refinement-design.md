# ST-022 account shell refinement design

## Goal

Take the account shell from correct-but-scaffolded to designed, at Apple craft
level, while staying inside the Study Room world. Raise the craft floor across
typography, spacing, surfaces, motion, and the loading, empty, and error
states, so the report and diagnosis screens that follow inherit a settled
visual language instead of rediscovering it. Move `PRODUCT.md` and `DESIGN.md`
into the app repository and true `DESIGN.md` up against what ships.

## Scope

In scope:

- The six screens ST-020 built: sign-up, sign-in, `/account`, player create,
  player edit, and guardian attach.
- The shared shell they render through: `page-frame`, `status-message`, and
  one consolidated form-field surface.
- The token layer: motion tokens and any type or spacing semantics the
  refinement needs.
- Every state on those screens: loading, empty, error, and success.
- `PRODUCT.md` and `DESIGN.md` moved into the app repository, with `DESIGN.md`
  regenerated from the shipped result.

Out of scope:

- Replacing the Study Room visual world. This is refinement, not redesign.
- New screens: report, focus, diagnosis, game, tournament, or board.
- Behavior changes: routes, queries, request and response shapes, the fields
  each form sends, and the owner-is-never-editable rule stay as they are.
- Copy that states a fact. Labels, helper text, and error messages may be
  clarified, and any such change is listed in the pull request.
- New dependencies, new third-party origins, deployment, and analytics.

## Architecture

The refinement raises the floor in the shared layer, then walks each screen
for its specific states. This is the root-cause shape the repository already
prefers: one convention in the shared path, not six bespoke passes.

The shared layer today has three concrete defects, found by reading the code
rather than by taste:

- The wordmark is a bare `p` with a font class, not an identity lockup.
- One `inputClassName` string is copy-pasted into `auth-routes`,
  `player-routes`, and `guardian-route`, so three forms carry the same field
  treatment three times.
- `StatusMessage` renders success as `text-primary` with no icon, and error as
  a bare colored paragraph, so status carries hue but no second channel.

The refinement fixes each at the source:

- `page-frame` owns the wordmark lockup, the skip link, and the flash slot,
  and applies the type, spacing, surface, and motion system once.
- `status-message` becomes a designed `StatusMessage` with icon and label,
  error and success tones from tokens.
- One form-field surface replaces the duplicated string, so sign-up, player
  create and edit, and guardian attach inherit one field treatment. This is a
  token-driven class or a thin Astryx `Field` wrapper, not a new dependency.

Astryx stays the primitive layer and native HTML the fallback, exactly as
ST-020 set it. A visual decision that does not resolve to a semantic token
from `tokens/` is a defect, per the design system policy.

Motion is 150 to 250ms ease-out on focus, hover, press, submit, error reveal,
and state change. All of it is gated behind `prefers-reduced-motion`; the
existing reduced-motion rule in `styles.css` extends to whatever motion the
components add, so no motion runs when reduced motion is requested.

## The craft system

**Typography.** Three tiers on the existing rem scale, nothing added:

- Display (Source Serif 4, 600): the wordmark and page titles.
- Label (Public Sans, 600, 0.875rem): section labels, field labels, captions.
- Body (Public Sans, 1rem/1.55) with Mono (IBM Plex Mono) for federation IDs,
  ratings, and usernames, anything that lines up digit over digit.

The wordmark becomes a considered lockup: "Kanso" in Source Serif 4 600 with a
small terracotta mark drawn from the token layer. No new imagery.

**Spacing.** The semantic tokens applied deliberately: inset snug, base, and
roomy for padding, stack tight, base, and loose for vertical rhythm. The
sign-in and sign-up screens get the generous whitespace that is the Apple
breathing-room moment; forms stay calm rather than padded for padding's sake.

**Surfaces.** Page, raised, and sunken used deliberately so hierarchy reads
without shadows. The board-brightest rule and the one-accent rule hold.

**Motion.** Purposeful and subtle, as above. No decorative animation.

**Second channel.** Every status and error carries icon and label, never hue
alone. Success becomes a check icon plus a success tone; error keeps an icon
plus message.

## Screens and states

The routes are unchanged; what changes is how each composes the craft system
and handles its states.

- `/sign-up` and `/sign-in`: a heading hero, the form, error and rate-limit
  states with icon and label, a pending submit state, and a success
  transition. Authentication errors stay generic and never reveal whether an
  email exists.
- `/account`: the account identity, separate owned and guarded sections with
  labels and badges, a designed empty state with a next action, and a sign-out
  error state.
- player create and edit: field-level errors with icon and label, a pending
  submit, and a not-found state on edit.
- guardian attach: the form, the not-found state, field errors, and a success
  flash.
- loading states are calm placeholders rather than blank screens or bare
  spinners where async data loads.

## Errors and security

Nothing about the data path changes. Credentials and sessions stay inside
Better Auth and the httpOnly cookie; browser code does not read or persist
them. React's default escaping stays and no raw HTML path is introduced. No
dependency is added and fonts and assets are self-hosted, so no third-party
origin appears.

The risk a broad visual change can drag in is named and refused: a styling
convenience dependency, a CDN font or icon set, an escape hatch that turns
rendered user data into markup, or an accessibility regression sold as polish.
If the refinement wants any of these, it stops and asks.

## Accessibility

The ST-020 floor holds and is what this story is judged against, not
re-inspected by eye: WCAG 2.2 AA proven by the axe checks in the existing
Playwright journey, a 320 CSS pixel phone viewport without horizontal scroll,
the high-contrast theme, and reduced motion. Each route keeps one clear
heading and landmark structure, inputs keep persistent labels and linked
errors, and meaning never travels by hue alone.

## Tests

The existing frontend tests pass without being edited, which is what proves
behavior did not move. The Playwright journey and its axe checks pass on the
refined screens. No new behavior test is required unless a refinement exposes
a contract worth pinning; the token-only rule is enforced by review and the
existing design system policy rather than a new gate.

## Delivery sequence

1. Run an Impeccable critique and audit over `apps/web` and record what they
   find, before changing anything, so the refinement answers findings.
2. Move `PRODUCT.md` and `DESIGN.md` into the app repository and confirm
   Impeccable reads both from there.
3. Refine the token layer and the shared shell in one pass: page-frame,
   status-message, and the consolidated form-field surface.
4. Walk the six screens for their loading, empty, error, and success states.
5. Run the Playwright journey and axe checks, and fix what either reports.
6. Regenerate `DESIGN.md` from the shipped result, reconcile it against the
   version moved in, and link it from the app docs index.
7. Verify every gate from a clean checkout before opening the pull request.

Delivery story and sprint status files remain unchanged until the app change
merges. Pushing and opening a pull request require a separate request.
