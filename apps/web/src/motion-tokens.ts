/**
 * The same three motion durations and two eases DESIGN.md's Motion section
 * names for the CSS-driven `.reveal-in`/`.stagger-in` utilities
 * (`--kanso-motion-duration-*`, `--kanso-motion-ease-*`), expressed for GSAP
 * timelines so JS-driven motion moves at the same rhythm as the rest of the
 * app rather than inventing a second, uncoordinated set of numbers.
 */
export const MOTION_DURATION = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
} as const;

export const MOTION_EASE = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  decelerate: 'cubic-bezier(0, 0, 0, 1)',
} as const;

/** Matches `.stagger-in`'s per-item delay step, capped the same way. */
export const STAGGER_STEP_SECONDS = 0.045;
export const STAGGER_STEP_CAP = 6;
