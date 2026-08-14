# ST-022 Account Shell Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the ST-020 account shell from correct-but-scaffolded to designed, at Apple craft level, inside the Study Room world.

**Architecture:** Raise the floor in the shared layer first (token additions, one `TextInput`, the header wordmark, `StatusMessage` icon and tone), then a light pass per screen for hierarchy, motion, and states. Astryx already carries the Kanso tokens through `theme.ts` and `<Theme>` in `main.tsx`, so the work is the hand-rolled pieces and composition, not re-theming.

**Tech Stack:** React 19, TanStack Router + Query, Astryx Core 0.4 (StyleX), Tailwind CSS 4 (token-wired via `@theme inline`), Style Dictionary tokens, Playwright + axe, Vitest.

## Global Constraints

- Refinement, not redesign: keep Study Room identity, behavior, and copy. No new visual world.
- No new dependency. Fonts and assets stay self-hosted; no third-party origin appears.
- React default escaping stays; no `dangerouslySetInnerHTML` or raw HTML path.
- Routes, queries, request/response shapes, form fields, and the owner-is-never-editable rule: unchanged.
- Copy that states a fact: unchanged. Label/helper/error copy clarifications are allowed but listed in the PR.
- Every visual decision resolves to a semantic token from `tokens/`. A raw hex/px/radius literal in a component is a defect.
- Motion: `--kanso-motion-duration-fast` (120ms) for control states, `--kanso-motion-duration-base` (200ms) for reveals, `--kanso-motion-ease-standard` everywhere; all gated behind `prefers-reduced-motion`.
- Accessibility: WCAG 2.2 AA via the axe checks in `apps/web/e2e/account.spec.ts`, 320 CSS px viewport without horizontal scroll, high-contrast and reduced-motion themes hold, meaning never by hue alone.
- Node `^24.19.0`. All commands run from the app repo root.

---

### Task 1: Relocate design docs and record critique/audit findings

**Files:**
- Create: `PRODUCT.md` (copied from workspace root, unchanged)
- Create: `DESIGN.md` (copied from workspace root, unchanged)
- Create: `.impeccable/design.json` (regenerated from `DESIGN.md`)

**Interfaces:**
- Consumes: nothing.
- Produces: `PRODUCT.md` and `DESIGN.md` living in the app repo, an Impeccable `design.json` in the repo, and a findings list that the later tasks answer.

- [ ] **Step 1: Copy the two docs into the app repo unchanged**

Run: `cp ../../PRODUCT.md ./PRODUCT.md && cp ../../DESIGN.md ./DESIGN.md`
Expected: both files present at the app repo root, byte-identical to the workspace-root originals.

- [ ] **Step 2: Confirm Impeccable reads both from the app repo**

Load `skill://impeccable`. Run its setup command against the web surface:
`node <impeccable-base>/scripts/context.mjs --target apps/web`
(`<impeccable-base>` is the base directory the runtime reports for the skill; fallback `.claude/skills/impeccable/scripts`.)
Expected: context reports `PRODUCT.md` and `DESIGN.md` found and loads the Study Room world.

- [ ] **Step 3: Regenerate the Impeccable design artifact in the repo**

Run the skill's `document` command over `apps/web` so `.impeccable/design.json` is written inside the app repo from the shipped design, not the stale workspace-root copy.

- [ ] **Step 4: Run critique and audit and record findings**

Run the skill's `critique apps/web/src` and `audit apps/web/src`. Record every finding in the commit body and keep the list in the worktree (`docs/superpowers/plans/2026-08-14-st-022-account-shell-refinement.md` notes at the end). The refinement tasks already answer the three known defects (bare wordmark, duplicated `inputClassName`, iconless success); any additional findings get folded into Tasks 6–8.

- [ ] **Step 5: Commit**

```bash
git add PRODUCT.md DESIGN.md .impeccable/design.json
git commit -m "docs: relocate design docs into the app repo"
```

---

### Task 2: Add success/info color tokens and motion utilities

**Files:**
- Modify: `apps/web/src/styles.css` (add `success`, `info`, and the `--text-*` scale to `@theme inline`)
- Modify: `apps/web/src/styles.css` (append motion utilities; extend reduced-motion rule)

**Interfaces:**
- Consumes: token values already emitted by Style Dictionary (`--kanso-color-success`, `--kanso-color-info`, `--kanso-text-xs` through `--kanso-text-4xl`, `--kanso-motion-duration-fast`, `--kanso-motion-duration-base`, `--kanso-motion-ease-standard`).
- Produces: Tailwind utilities `text-success`, `text-info`, and `text-xs` through `text-4xl`; classes `transition-control` and `reveal-in`, consumed by Tasks 3–8.

- [ ] **Step 1: Add `success`, `info`, and the type scale to `@theme inline`**

In `@theme inline`, after the `--color-danger` line, add:

```css
  --color-success: var(--kanso-color-success);
  --color-info: var(--kanso-color-info);
```

Then, after the `--radius-surface` line (the last entry in `@theme inline`), add the text ramp so `text-*` utilities resolve to the tokens instead of Tailwind's defaults:

```css
  --text-xs: var(--kanso-text-xs);
  --text-sm: var(--kanso-text-sm);
  --text-base: var(--kanso-text-base);
  --text-lg: var(--kanso-text-lg);
  --text-xl: var(--kanso-text-xl);
  --text-2xl: var(--kanso-text-2xl);
  --text-3xl: var(--kanso-text-3xl);
  --text-4xl: var(--kanso-text-4xl);
```

- [ ] **Step 2: Add the motion utility class and the reveal animation**

Append after the `:focus-visible` rule:

```css
.transition-control {
  transition-property: color, background-color, border-color, box-shadow;
  transition-duration: var(--kanso-motion-duration-fast);
  transition-timing-function: var(--kanso-motion-ease-standard);
}
@keyframes reveal-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.reveal-in {
  animation: reveal-in var(--kanso-motion-duration-base) var(--kanso-motion-ease-standard);
}
```

- [ ] **Step 3: Extend reduced motion to cover animations**

Change the existing `prefers-reduced-motion` block so it also stops CSS animations (the Astryx button spinner):

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
  }
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add apps/web/src/styles.css
git commit -m "feat: add success and info tokens and motion utilities"
```

---

### Task 3: Consolidate the form field into one TextInput

**Files:**
- Create: `apps/web/src/components/text-input.tsx`
- Modify: `apps/web/src/routes/auth-routes.tsx` (drop the local `inputClassName`, import and use `TextInput`)
- Modify: `apps/web/src/routes/player-routes.tsx` (same)
- Modify: `apps/web/src/routes/guardian-route.tsx` (same)

**Interfaces:**
- Consumes: `transition-control` from Task 2.
- Produces: `TextInput` (props `ComponentPropsWithoutRef<'input'>`, owns the shared field class) and `TextInputProps`. Consumed by Tasks 6 and 8. The old per-file `inputClassName` constant is deleted everywhere.

- [ ] **Step 1: Create the shared component**

```tsx
import type { ComponentPropsWithoutRef } from 'react';

const textInputClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus';

export type TextInputProps = ComponentPropsWithoutRef<'input'>;

export function TextInput({ className, ...props }: TextInputProps) {
  return <input {...props} className={className ?? textInputClassName} />;
}
```

- [ ] **Step 2: Convert auth-routes**

Add `import { TextInput } from '../components/text-input.tsx';` and delete:

```tsx
const inputClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus';
```

Replace each `<input ... className={inputClassName} />` with `<TextInput ... />`, keeping every other prop verbatim (id, name, type, autoComplete, required, maxLength, minLength). There are four: name, email, password, passwordConfirmation.

- [ ] **Step 3: Convert player-routes**

Same import and constant deletion. Convert all eight inputs (displayName, birthYear, fideId, fideRating, uscfId, uscfRating, chesscomUsername, lichessUsername) from `<input ... className={inputClassName} />` to `<TextInput ... />`, keeping every other prop verbatim.

- [ ] **Step 4: Convert guardian-route**

Same import and constant deletion. Convert the two inputs (guardianEmail, relationship), keeping every other prop verbatim.

- [ ] **Step 5: Verify and commit**

Run: `npm test`
Expected: PASS. The route tests assert by label, autocomplete, and message text, not by tag name or className, so the tag swap is behavior-preserving.

```bash
git add apps/web/src/components/text-input.tsx apps/web/src/routes/auth-routes.tsx apps/web/src/routes/player-routes.tsx apps/web/src/routes/guardian-route.tsx
git commit -m "refactor: consolidate form field styling into TextInput"
```

---

### Task 4: Give the header a wordmark lockup

**Files:**
- Modify: `apps/web/src/components/page-frame.tsx` (the wordmark `p`)

**Interfaces:**
- Consumes: `--kanso-color-action-primary-default` via the `bg-accent` utility.
- Produces: nothing new; the header renders the lockup.

- [ ] **Step 1: Replace the bare wordmark**

Replace:

```tsx
<p className="font-display text-xl leading-tight">Kanso Chess</p>
```

with:

```tsx
<div className="flex items-center gap-2">
  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-control bg-accent" />
  <span className="font-display text-xl leading-tight">Kanso Chess</span>
</div>
```

- [ ] **Step 2: Verify and commit**

Run: `npm test`
Expected: PASS. No test asserts the wordmark markup.

```bash
git add apps/web/src/components/page-frame.tsx
git commit -m "feat: add wordmark lockup to the header"
```

---

### Task 5: Give StatusMessage an icon and a success tone

**Files:**
- Modify: `apps/web/src/components/status-message.tsx` (the `StatusMessage` component only; keep `StatusMessageProvider`, `useStatusMessage`, and all types)

**Interfaces:**
- Consumes: `text-success` and `text-danger` from Task 2; `reveal-in` from Task 2.
- Produces: `StatusMessage` with the same `tone` (`'error' | 'success'`) and `role` contract (`error` → `alert`, `success` → `status`), now rendering an icon and a tone color. Consumers (auth, account, player, guardian) are unchanged.

- [ ] **Step 1: Rewrite the component**

Keep the top of the file through `useStatusMessage` unchanged. Replace the `StatusMessage` function with:

```tsx
const toneClassName: Record<StatusTone, string> = {
  error: 'text-danger',
  success: 'text-success',
};

function StatusIcon({ tone }: { tone: StatusTone }) {
  if (tone === 'success') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0" fill="none">
        <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path d="m6 10 2.5 2.5L14 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0" fill="none">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

export function StatusMessage({ tone, children }: StatusMessageProps) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`flex items-center gap-2 reveal-in ${toneClassName[tone]}`}>
      <StatusIcon tone={tone} />
      <span>{children}</span>
    </p>
  );
}
```

- [ ] **Step 2: Verify and commit**

Run: `npm test`
Expected: PASS. Tests query by role and message text; both are preserved.

```bash
git add apps/web/src/components/status-message.tsx
git commit -m "feat: add icons and success tone to StatusMessage"
```

---

### Task 6: Refine the auth screens to a centered hero

**Files:**
- Modify: `apps/web/src/routes/auth-routes.tsx` (the `AuthScreen` return)

**Interfaces:**
- Consumes: `TextInput` from Task 3, `StatusMessage` from Task 5, `transition-control` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Narrow and center the card**

Change the return's opening `<Card>` to:

```tsx
<Card className="mx-auto w-full max-w-sm">
```

- [ ] **Step 2: Add motion and a hover state to the switch link**

Change the `<Link>` className from:

```tsx
className="inline-flex min-h-11 items-center font-ui text-accent underline"
```

to:

```tsx
className="inline-flex min-h-11 items-center font-ui text-accent underline transition-control hover:text-accent-hover"
```

- [ ] **Step 3: Verify and commit**

Run: `npm test`
Expected: PASS (labels, autocomplete, rejection copy, 429 copy, and navigation assertions unchanged).

```bash
git add apps/web/src/routes/auth-routes.tsx
git commit -m "feat: refine auth screens to a centered hero"
```

---

### Task 7: Refine the account screen hierarchy and states

**Files:**
- Modify: `apps/web/src/routes/account-route.tsx`
- Modify: `apps/web/src/router.tsx` (add the pending skeleton and wire it)

**Interfaces:**
- Consumes: `StatusMessage` from Task 5, `transition-control` from Task 2.
- Produces: `PendingComponent` in `router.tsx`.

- [ ] **Step 1: Give the account name display hierarchy**

Replace `<p>{me.name}</p>` with:

```tsx
<p className="font-display text-lg leading-tight">{me.name}</p>
```

- [ ] **Step 2: Add motion and a hover state to the create-player link**

Change the create-player `<Link>` className from:

```tsx
className="mt-3 inline-flex min-h-11 items-center rounded-control bg-accent px-4 py-2 font-ui text-on-accent focus:outline-none focus:ring-2 focus:ring-focus"
```

to:

```tsx
className="mt-3 inline-flex min-h-11 items-center rounded-control bg-accent px-4 py-2 font-ui text-on-accent transition-control hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus"
```

- [ ] **Step 3: Add motion to the owned-card action links**

On both the Edit and Add guardian `<Link>` elements in `PlayerCard`, append ` transition-control` to the existing className.

- [ ] **Step 4: Add a calm pending component for the account shell**

The account child routes resolve their `me` query in `beforeLoad`, so TanStack Router shows its default bare spinner during that fetch. Replace it with a calm skeleton. In `router.tsx`, add a component next to `DefaultErrorComponent`:

```tsx
function PendingComponent() {
  return (
    <div role="status" aria-label="Loading" aria-busy="true" className="space-y-3">
      <div className="h-5 w-40 rounded-control bg-sunken" />
      <div className="h-4 w-64 rounded-control bg-sunken" />
    </div>
  );
}
```

And in `createAppRouter`, add `defaultPendingComponent: PendingComponent,` on the line after `defaultErrorComponent: DefaultErrorComponent,`.

- [ ] **Step 5: Verify and commit**

Run: `npm test`
Expected: PASS (identity, lists, sign-out, empty-state, and link assertions unchanged).

```bash
git add apps/web/src/routes/account-route.tsx apps/web/src/router.tsx
git commit -m "feat: refine account screen hierarchy and states"
```

---

### Task 8: Refine the player and guardian forms

**Files:**
- Create: `apps/web/src/components/secondary-link.ts`
- Modify: `apps/web/src/routes/player-routes.tsx`
- Modify: `apps/web/src/routes/guardian-route.tsx`

**Interfaces:**
- Consumes: `TextInput` from Task 3, `StatusMessage` from Task 5, `transition-control` from Task 2.
- Produces: `secondaryLinkClassName` (a string constant), used by the two Cancel links.

- [ ] **Step 1: Create the shared secondary-link constant**

```ts
export const secondaryLinkClassName =
  'inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-raised px-3 py-2 font-ui text-primary transition-control hover:bg-sunken focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus';
```

- [ ] **Step 2: Use it for the guardian Cancel link**

In `guardian-route.tsx`, add `import { secondaryLinkClassName } from '../components/secondary-link.ts';` and change the Cancel `<Link>` from its inline className string to `className={secondaryLinkClassName}`.

- [ ] **Step 3: Use it for the player Cancel link**

In `player-routes.tsx`, add the same import and change the Cancel `<Link>` to `className={secondaryLinkClassName}`. The two files now share one class; no drift.

- [ ] **Step 4: Confirm field-level error states already carry a second channel**

Verify by reading the rendered output that Astryx `Field` with `status={{ type: 'error', message }}` shows the message text next to the label. No code change: the text message is the second channel; hue is not relied on alone. Record this confirmation in the commit body.

- [ ] **Step 5: Verify and commit**

Run: `npm test`
Expected: PASS (playerBody parsing, create/edit flows, guardian attach, field-error, not-found, and 409 assertions unchanged).

```bash
git add apps/web/src/components/secondary-link.ts apps/web/src/routes/player-routes.tsx apps/web/src/routes/guardian-route.tsx
git commit -m "feat: refine player and guardian forms"
```

---

### Task 9: Regenerate DESIGN.md and verify all gates

**Files:**
- Modify: `DESIGN.md` (regenerated from the shipped result, reconciled against the moved-in copy)
- Modify: `docs/index.md` (link the design doc)

**Interfaces:**
- Consumes: the refined shell from Tasks 2–8.
- Produces: a `DESIGN.md` that matches the shipped visual world.

- [ ] **Step 1: Regenerate DESIGN.md from the shipped result**

Run the Impeccable skill's `document` command over `apps/web` to regenerate `DESIGN.md` from the shipped code, then reconcile it against the copy moved in during Task 1. List every deviation in the commit body.

- [ ] **Step 2: Link the design doc from the docs index**

Add a line under the docs index linking `DESIGN.md` (and `PRODUCT.md`), matching the existing link format in `docs/index.md`.

- [ ] **Step 3: Run the full gate suite from the repo root**

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run format:check
```

Expected: all PASS. `test:e2e` runs the Playwright journey and its axe checks (`apps/web/e2e/account.spec.ts`), which is the visual and accessibility proof for the refined screens.

- [ ] **Step 4: Visual confirmation**

Run `npm run dev --workspace apps/web`, then drive the browser over `/sign-in`, `/sign-up`, `/account`, and the player/guardian forms. Confirm the wordmark lockup, the centered auth hero, icon-plus-label status, and the field focus transition render as intended at 320px and at a desktop width.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md docs/index.md
git commit -m "docs: regenerate DESIGN.md from the refined shell"
```

---

## Recorded findings

The three known defects answered by design:

- Bare `<p>` wordmark in the header (`apps/web/src/components/page-frame.tsx`) — Task 4.
- `inputClassName` duplicated in three routes (`auth-routes.tsx`, `player-routes.tsx`, `guardian-route.tsx`) — Task 3.
- Iconless `text-primary` success status (`apps/web/src/components/status-message.tsx`) — Task 5.

Additional findings from the Task 1 critique and audit (the Impeccable mechanical detector, `detect.mjs`, returned no anti-pattern findings over `apps/web/src`; these are from the manual critique and audit):

- Hand-rolled secondary "Cancel" link duplicated in `player-routes.tsx` and `guardian-route.tsx`, recreating Astryx `Button variant="secondary"` (already used for "Sign out" in `account-route.tsx`) — fold into Task 8.
- The design type ramp is not wired to Tailwind: `styles.css` `@theme inline` maps color/radius/font/spacing but no `--text-*` scale, so the wordmark's `text-xl` renders Tailwind's 1.25rem instead of the `--kanso-text-xl` Title token (1.375rem) — fold into Task 2 (theme layer; the wordmark in Task 4 then inherits it).
