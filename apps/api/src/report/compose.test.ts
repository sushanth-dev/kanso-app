/**
 * ST-027. The pure composition: refusal thresholds, zero-cost drop, rank
 * contiguity, time-trouble onset, and label/eco pass-through.
 *
 * No database, no clock. The leak scorer's ordering is pinned in leak.test.ts;
 * here the composition's contract is pinned over already-scored leak rows.
 */
import { describe, expect, test } from 'vitest';
import { composeReport } from './compose.ts';
import type { WeaknessLeak } from '../analysis/leak.ts';
import type { TimeTroubleResult } from '../phases/phases.ts';

function leak(
  over: Partial<WeaknessLeak> & { kind: WeaknessLeak['kind']; key: string },
): WeaknessLeak {
  return {
    label: over.key,
    eco: null,
    halfPointsLost: 1,
    severityWeightedHalfPoints: 1,
    occurrences: 1,
    gamesAffected: 1,
    ratingLeak: 10,
    saturated: false,
    ...over,
  };
}

const unavailable: TimeTroubleResult = { status: 'unavailable', reason: 'no_clock_data' };
const thinEvidence: TimeTroubleResult = { status: 'unavailable', reason: 'not_enough_evidence' };
const reported: TimeTroubleResult = {
  status: 'reported',
  clockedGames: 3,
  fromMove: 23,
  troubleMoves: 10,
  troubleMistakeRate: 0.5,
  calmMoves: 100,
  calmMistakeRate: 0.1,
};

describe('composeReport', () => {
  test('ranks what survives, worst first, contiguous from one', () => {
    const { weaknesses } = composeReport(
      [
        leak({ kind: 'phase', key: 'middlegame', halfPointsLost: 2, ratingLeak: 100 }),
        leak({
          kind: 'motif',
          key: 'hanging_piece',
          halfPointsLost: 1,
          ratingLeak: 50,
          occurrences: 3,
        }),
        leak({ kind: 'phase', key: 'opening', halfPointsLost: 0.5, ratingLeak: 25 }),
      ],
      unavailable,
    );
    expect(weaknesses.map((w) => [w.kind, w.label, w.rank])).toEqual([
      ['phase', 'middlegame', 1],
      ['motif', 'hanging_piece', 2],
      ['phase', 'opening', 3],
    ]);
  });

  test('withholds openings below two games and motifs below three occurrences', () => {
    const { weaknesses } = composeReport(
      [
        leak({ kind: 'opening', key: 'B22', gamesAffected: 1 }),
        leak({ kind: 'opening', key: 'B20', gamesAffected: 2 }),
        leak({ kind: 'motif', key: 'hanging_piece', occurrences: 2 }),
        leak({ kind: 'motif', key: 'missed_capture', occurrences: 3 }),
      ],
      unavailable,
    );
    expect(weaknesses.map((w) => w.eco ?? w.label)).toEqual(['B20', 'missed_capture']);
  });

  test('drops a zero-cost weakness regardless of kind', () => {
    const { weaknesses } = composeReport(
      [
        leak({ kind: 'phase', key: 'opening', halfPointsLost: 0, ratingLeak: 0 }),
        leak({ kind: 'phase', key: 'middlegame', halfPointsLost: 1, ratingLeak: 50 }),
      ],
      unavailable,
    );
    expect(weaknesses.map((w) => w.label)).toEqual(['middlegame']);
  });

  test('reports the time-trouble onset only when the clock half reports', () => {
    const withTrouble = composeReport(
      [leak({ kind: 'time_trouble', key: 'time_trouble', halfPointsLost: 1, ratingLeak: 40 })],
      reported,
    );
    expect(withTrouble.timeTroubleFromMove).toBe(23);
    expect(withTrouble.timeTroubleReason).toBeNull();
    expect(withTrouble.weaknesses.map((w) => w.kind)).toEqual(['time_trouble']);

    const withoutTrouble = composeReport(
      [leak({ kind: 'time_trouble', key: 'time_trouble', halfPointsLost: 1, ratingLeak: 40 })],
      unavailable,
    );
    expect(withoutTrouble.timeTroubleFromMove).toBeNull();
    expect(withoutTrouble.timeTroubleReason).toBe('no_clock_data');
    expect(withoutTrouble.weaknesses).toEqual([]);

    const thin = composeReport(
      [leak({ kind: 'time_trouble', key: 'time_trouble', halfPointsLost: 1, ratingLeak: 40 })],
      thinEvidence,
    );
    expect(thin.timeTroubleFromMove).toBeNull();
    expect(thin.timeTroubleReason).toBe('not_enough_evidence');
    expect(thin.weaknesses).toEqual([]);
  });

  test('passes label and eco through, eco on openings only', () => {
    const { weaknesses } = composeReport(
      [
        leak({
          kind: 'opening',
          key: 'B22',
          label: 'Sicilian, Alapin',
          eco: 'B22',
          gamesAffected: 2,
        }),
        leak({ kind: 'motif', key: 'hanging_piece', label: 'Hanging piece', occurrences: 3 }),
      ],
      unavailable,
    );
    expect(weaknesses[0]).toMatchObject({ kind: 'opening', label: 'Sicilian, Alapin', eco: 'B22' });
    expect(weaknesses[1]).toMatchObject({ kind: 'motif', label: 'Hanging piece', eco: null });
  });

  test('an empty report is a valid outcome', () => {
    const { weaknesses, timeTroubleFromMove } = composeReport(
      [
        leak({ kind: 'opening', key: 'B22', gamesAffected: 1 }),
        leak({ kind: 'motif', key: 'hanging_piece', occurrences: 2 }),
      ],
      unavailable,
    );
    expect(weaknesses).toEqual([]);
    expect(timeTroubleFromMove).toBeNull();
  });
});
