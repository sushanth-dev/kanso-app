import type { components } from '../generated/api.ts';

type Evaluation = components['schemas']['Evaluation'];

// The API's white-absolute winning-chances sigmoid (lichess-utils.ts), reused
// here so the bar's fill agrees with the numbers the report computes.
const NNUE_SCALING_FACTOR = 2.2;

function winningChances(ev: NonNullable<Evaluation>): number {
  if (ev.mate !== null) {
    const absMate = Math.min(10, Math.abs(ev.mate));
    const cp = (21 - absMate) * 100 * (ev.mate > 0 ? 1 : -1);
    return 2 / (1 + Math.exp(-0.00368208 * cp * NNUE_SCALING_FACTOR)) - 1;
  }
  const cp = ev.cp ?? 0;
  return 2 / (1 + Math.exp(-0.00368208 * cp * NNUE_SCALING_FACTOR)) - 1;
}

/** White's share of the bar, on [0, 1]; a null evaluation is neutral. */
export function whiteShare(ev: Evaluation): number {
  if (ev === null) return 0.5;
  return (winningChances(ev) + 1) / 2;
}

/** The numeric label: "+1.2", "-0.4", "M3", or a dash for null. */
export function evalLabel(ev: Evaluation): string {
  if (ev === null) return '\u2014';
  if (ev.mate !== null) {
    return `${ev.mate > 0 ? '' : '-'}M${Math.abs(ev.mate)}`;
  }
  const cp = ev.cp ?? 0;
  return `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
}

export interface EvalBarProps {
  evaluation: Evaluation;
  label: string;
}

/**
 * The neutral white/black fill bar from DESIGN.md. White's share fills from the
 * top, black's from the bottom, never red-to-green. The fill height transitions
 * over the slow 320ms board transition, collapsing to zero under reduced motion.
 */
export function EvalBar({ evaluation, label }: EvalBarProps) {
  const share = whiteShare(evaluation);
  return (
    <div
      role="img"
      aria-label={label}
      className="relative h-40 w-6 shrink-0 overflow-hidden rounded-control border border-border-strong bg-raised"
    >
      <div
        className="absolute inset-x-0 bottom-0 bg-ink"
        style={{ height: `${(1 - share) * 100}%` }}
      />
      <div
        className="absolute inset-x-0 top-0 bg-raised"
        style={{
          height: `${share * 100}%`,
          transitionProperty: 'height',
          transitionDuration: 'var(--kanso-motion-duration-slow)',
          transitionTimingFunction: 'var(--kanso-motion-ease-standard)',
        }}
      />
    </div>
  );
}
