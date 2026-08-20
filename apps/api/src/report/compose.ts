/**
 * ST-027. Compose the leak figures into a ranked report, one stream.
 *
 * Pure: no database, no clock. It takes ST-026's {@link WeaknessLeak[]} and
 * ST-025's time-trouble result, applies the per-aggregate refusal thresholds,
 * drops zero-cost weaknesses, and assigns contiguous ranks in the order the
 * leak scorer already produced (worst first).
 *
 * A refused or zero-cost weakness is absent rather than present with a zero,
 * so a thin history reads as thin rather than clean. The per-aggregate
 * enumeration of what could not be assessed is prose, which is `narrative`'s
 * job under ADR-0018 and null for this story.
 */
import { MIN_GAMES } from '../openings/opening-leaks.ts';
import { MIN_POSITIONS } from '../motifs/motifs.ts';
import type { TimeTroubleResult } from '../phases/phases.ts';
import type { WeaknessKind, WeaknessLeak } from '../analysis/leak.ts';

/** One ranked weakness, ready to store, with the id left to the database. */
export interface ComposedWeakness {
  kind: WeaknessKind;
  label: string;
  eco: string | null;
  ratingLeak: number;
  /** True when the weakness saturates the season; the leak is then a floor. */
  saturated: boolean;
  halfPointsLost: number;
  gamesAffected: number;
  occurrences: number;
  rank: number;
}

export function composeReport(
  leaks: WeaknessLeak[],
  timeTrouble: TimeTroubleResult,
): {
  weaknesses: ComposedWeakness[];
  timeTroubleFromMove: number | null;
  timeTroubleReason: 'no_clock_data' | 'not_enough_evidence' | null;
} {
  // The onset move is a fact about the player's clock, reported whenever
  // ST-025's clock half reports, independent of whether the trouble-window
  // mistakes crossed a result boundary.
  const timeTroubleFromMove = timeTrouble.status === 'reported' ? timeTrouble.fromMove : null;
  const timeTroubleReason = timeTrouble.status === 'reported' ? null : timeTrouble.reason;

  const defensible = leaks.filter((w) => {
    if (w.halfPointsLost <= 0) return false;
    switch (w.kind) {
      case 'opening':
        return w.gamesAffected >= MIN_GAMES;
      case 'motif':
        return w.occurrences >= MIN_POSITIONS;
      case 'phase':
        return true;
      case 'time_trouble':
        return timeTrouble.status === 'reported';
    }
  });

  const weaknesses: ComposedWeakness[] = defensible.map((w, i) => ({
    kind: w.kind,
    label: w.label,
    eco: w.eco,
    ratingLeak: w.ratingLeak,
    saturated: w.saturated,
    halfPointsLost: w.halfPointsLost,
    gamesAffected: w.gamesAffected,
    occurrences: w.occurrences,
    rank: i + 1,
  }));

  return { weaknesses, timeTroubleFromMove, timeTroubleReason };
}
