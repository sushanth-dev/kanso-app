# Polish plan (ST-159)

The motion and finish audit of every shipped surface, graded against the
Emil Kowalski animation standards (`improve-animations`,
`find-animation-opportunities`, `review-animations`). One prioritized list;
the batch stories ST-160, ST-161, and ST-162 execute it.

## How the audit was run

Static read first: the 27 route components in `apps/web/src/router.tsx`,
the 44 non-test files that reference motion (the CSS utilities in
`apps/web/src/styles.css`, `src/motion-tokens.ts`, the `use-scroll-reveal`,
`use-smooth-scroll`, and `use-reveal-sequence` hooks, and the landing
components). Then the running app: the core surfaces (landing, games,
report, game review, curriculum, practice, settings) observed in a real
browser on Nocturne and on Study Room light, with reduced-motion emulation
and the no-JavaScript degradation checked.

What the running app confirmed:

- The GSAP and Lenis end-states hold under reduced motion: the landing
  hero renders at final opacity 1 with no transform, and smooth scroll
  never constructs. The CSS reduced-motion block zeroes every
  animation-driven duration while keeping colour transitions on
  `.transition-control` and `.press`.
- The games list renders with no entrance treatment at all (only the page
  header reveals). Finding 1 below is confirmed live, not just in source.
- No JavaScript: the app is a pure SPA with an empty `#root` in
  `index.html` and no `noscript` fallback, so nothing renders without
  JavaScript and there is no motion to degrade. This is a product-level
  fact, not a motion defect; it is recorded here so the no-JS acceptance
  criteria in the batch stories are read as "the degradation is the blank
  page, and nothing half-renders".
- Both themes were observed. Nocturne and Study Room carry the same
  motion; the Nocturne glass overrides in `styles.css` replace blur with
  hairlines and do not touch durations or eases, so every finding below
  applies to both themes equally.

## Constraints every item inherits

These are floors, not preferences. No plan item may trade one away.

- WCAG 2.2 AA on every shipped surface.
- The 44px touch floor on every interactive target.
- Never hue alone: state changes pair colour with text, icon, or weight.
- Reduced motion: final states render immediately, transitions gentler
  not zero (colour and shadow transitions stay; transforms go instant).
- ADR-0017: no board animation. ADR-0044: functional board motion only.
- Motion vocabulary stays inside `src/motion-tokens.ts`: 120/200/320 ms,
  `MOTION_EASE.standard` and `MOTION_EASE.decelerate`, stagger 45 ms
  capped at 6. New durations or eases are a plan amendment, not a
  local decision.

## Plan items

Priority order: trust surfaces first, state-change feedback second,
token polish third. Each item names the skill and the standard it serves.

### P1. Entrance gaps on trust surfaces

1. **Games list has no entrance treatment.**
   Surface: `apps/web/src/routes/games-route.tsx:203-207`, the game list
   `ul`. Change: apply `stagger-in` to the list container (45 ms step,
   cap 6) so the cards settle in as a sequence instead of appearing as
   one block. Serves: `find-animation-opportunities`, standard
   "stagger 30-80 ms for related entries" and the continuity principle
   (the report and landing already reveal; the games list is the same
   journey). Executes in ST-160.
2. **ClockCurve card has no entrance treatment.**
   Surface: `apps/web/src/components/report/clock-curve.tsx:172`. Change:
   apply `reveal-in`, matching its sibling report cards. Serves:
   `find-animation-opportunities`, standard "related content enters with
   one consistent motion". Executes in ST-160.
3. **Report share-cards section has no entrance treatment.**
   Surface: `apps/web/src/components/report/report-share-cards-section.tsx:92`.
   Change: apply `reveal-in`, matching siblings. Serves:
   `find-animation-opportunities`, same consistency standard. Executes in
   ST-160.
4. **Landing hero word stagger is un-capped.**
   Surface: `apps/web/src/components/landing/hero.tsx:163-166`. Nine
   words at 40 ms each put the last word 360 ms behind the first; the
   repo's own cap is 6 (see `use-scroll-reveal.ts:55` and the CSS
   `.stagger-in` cap). Change: cap the GSAP stagger at 6 steps the way
   the hook does. Serves: `review-animations`, standard "stagger caps at
   six steps". Executes in ST-160.

### P2. State changes that snap

5. **Curriculum assessment-passed text swap snaps.**
   Surface: `apps/web/src/routes/curriculum-route.tsx:90-95`. Change:
   `pop-in` on the success text swap. The pattern is proven in the same
   file's sibling at `practice-route.tsx:662-665`; `pop-in` is the
   delight-budget entrance for rare, high-emotion moments and passing an
   assessment is one. Serves: `find-animation-opportunities`, standard
   "reward moments earn the settle". Executes in ST-161.
6. **Curriculum tab swap snaps.**
   Surface: `apps/web/src/routes/curriculum-route.tsx:283-290`. Change:
   `reveal-in` on a keyed remount of the tab body, the pattern
   `game-review-route.tsx:442` already uses. Serves:
   `find-animation-opportunities`, standard "state changes transition,
   never teleport". Executes in ST-161.
7. **Puzzles tab swap snaps.**
   Surface: `apps/web/src/routes/puzzles-route.tsx:257-297`. Change:
   `reveal-in` on the keyed body, no stagger (dense review data reads
   better settling as one block). Same standard as item 6. Executes in
   ST-161.
8. **Upgrade success message snaps.**
   Surface: `apps/web/src/routes/upgrade-route.tsx:277-293`. Change:
   `pop-in` on the success `StatusMessage` only; the error path stays
   instant so failure never feels celebrated. Serves:
   `find-animation-opportunities`, standard "match motion weight to
   meaning". Executes in ST-162.
9. **Import success message snaps.**
   Surface: `apps/web/src/routes/import-route.tsx:117`. Change: `pop-in`
   on the success `StatusMessage` only, error path instant. Same
   standard as item 8. Executes in ST-162.
10. **Settings username-saved message snaps.**
    Surface: `apps/web/src/routes/settings-route.tsx:220-223`. Change:
    `reveal-in` at 200 ms on the saved confirmation; no exit animation
    (the message is informational, and exits that linger on informational
    text violate the frequency principle). Serves:
    `find-animation-opportunities`, standard "state changes transition,
    never teleport". Executes in ST-162.
11. **Games delete-error message snaps.**
    Surface: `apps/web/src/routes/games-route.tsx:130-134`. Change:
    `reveal-in` at 200 ms. Same standard as item 10. Executes in ST-160.
12. **Confirm and revoke inline panels mount with a jump.**
    Surface: `apps/web/src/components/settings/assignment-links-section.tsx:206`
    and `apps/web/src/components/settings/priming-link-section.tsx:133`.
    Change: `reveal-in` on the inline panel mount so the rows below move
    instead of jumping. Serves: `find-animation-opportunities`, standard
    "appearance of new content transitions in". Executes in ST-162.
13. **Inline form errors appear abruptly.**
    Surface: `apps/web/src/components/settings/assignment-links-section.tsx:154`
    and `apps/web/src/components/settings/priming-link-section.tsx:85`.
    Change: `reveal-in` at 200 ms, fast enough to stay urgent. Same
    standard as item 12. Executes in ST-162.

### P3. Token polish

14. **Landing hero uses a GSAP ease outside the motion vocabulary.**
    Surface: `apps/web/src/components/landing/hero.tsx:183,187` uses
    `'power2.out'` while the rest of the app names its curves in
    `motion-tokens.ts`. Change: export a `MOTION_EASE_GSAP` mapping from
    `motion-tokens.ts` (standard/decelerate to their GSAP equivalents)
    and use it in the hero, so the vocabulary has one source. Serves:
    `review-animations`, standard "one easing vocabulary, defined once".
    Executes in ST-160.
15. **Input focus settle is off-token.**
    Surface: `apps/web/src/styles.css:191`, the 180 ms
    `input-focus-settle` animation. Change: snap to the 120 ms fast
    token; focus feedback is high-frequency and belongs on the shortest
    duration. Serves: `review-animations`, standard "UI feedback under
    300 ms, high-frequency actions fastest". Executes in ST-160 (it is
    one CSS value; carrying it separately is not worth a story).
16. **DebtBoard pending-to-loaded double fade.**
    Surface: `apps/web/src/components/report/debt-board.tsx:172,223`.
    Pending and loaded states both apply `reveal-in`, so a fast resolve
    fades the same card twice. Change: keep `reveal-in` on the first
    mount only (key the animation to the card, not the state). Serves:
    `review-animations`, standard "interrupting an animation must not
    restart it". Executes in ST-161 (the debrief lives in the practice
    batch).

## Accepted exceptions (recorded, not fixed)

- `.fold` transitions `grid-template-rows` (`styles.css:132-143`), a
  layout property. This is the documented exception: the fold exists so
  the page around the report's evidence accordion moves instead of
  jumping, the alternative (mount/unmount) is worse, and the element is
  closed and rare. Revisit only if profiling shows jank on low-end
  devices.
- `status-message.tsx:95` reuses the `reveal-in` keyframe on re-render,
  which restarts the animation on a message change. The message text
  changes at the same moment, so the restart reads as emphasis, not
  glitch. Left as is.
- Raw `Button` without `.press` is not a defect anywhere: the Astryx
  core Button ships its own `:active` scale at 0.98.

## Not to animate

The audit's rejections, so nobody re-proposes them:

- **Navigation and CTAs.** The landing hero CTA and the sign-in CTA get
  no entrance or attention animation. Navigation is 100+ times a day;
  animating it spends patience on the thing users already decided to do.
- **Puzzle queue rows.** No stagger. The queue is high-frequency; rows
  must be there the instant the data is.
- **Board move feedback.** ADR-0017 forbids board animation and
  ADR-0044 reserves motion for functional board state. The shared-game
  flip button included.
- **Report charts.** The clock curve and accuracy data are surfaces
  players analyse; entrance animation delays the reading.
- **Route transitions.** Deliberately dropped once already
  (`router.tsx:57-60`); nothing in the audit re-opens that.
- **Toasts.** The product ships none (`ask-sonner` stays out). If a
  toast need appears, it is a decision first, not a dependency.
- **Error paths.** No `pop-in` on any error state anywhere. Failure is
  instant; celebration is reserved for success.

## Batches and shed order

- **ST-160 core loop**: items 1, 2, 3, 4, 11, 14, 15 (landing, report,
  game review, games list, proof sheet).
- **ST-161 practice loop**: items 5, 6, 7, 16 (practice, puzzles,
  curriculum, post-import debrief).
- **ST-162 periphery**: items 8, 9, 10, 12, 13 (upgrade, import,
  settings, shared readers, entry and consent).

Shed order if the sprint overruns, whole items only, nothing lands
half-applied: shed P3 first (items 16, then 14, then 15), then P2 tail
(13, then 12, then 10). P1 never sheds: the entrance gaps on trust
surfaces are the reason this sprint exists.

## Open question

The acceptance criteria name Nocturne and light, so the high-contrast
theme was not graded. `styles.css` already ships a high-contrast set
(`data-contrast='high'` scopes that drop blur and force opaque
surfaces), but no surface was observed under it and no item above claims
it holds. Before ST-163's strict pass, either grade the high-contrast
theme against this plan or record explicitly that it is out of scope.
