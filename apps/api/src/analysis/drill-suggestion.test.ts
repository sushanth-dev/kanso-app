/**
 * ST-155. The drill budget's ordering, pinned without a database: the
 * bleeding phase outranks an equal-cost group, a group with no recent
 * mistakes falls to the back, and the tiebreak order is stable.
 */
import { describe, expect, it } from 'vitest';
import { orderSuggestions, phaseCostCurve, type RecentMistake } from './drill-suggestion.ts';

function mistake(overrides: Partial<RecentMistake> = {}): RecentMistake {
  return {
    phase: 'middlegame',
    halfPointsLost: 2,
    opponentElo: null,
    eco: null,
    motif: null,
    inTrouble: false,
    ...overrides,
  };
}

describe('phaseCostCurve', () => {
  it('weights the worst phase 1 and a quiet phase 0', () => {
    const curve = phaseCostCurve([
      mistake({ phase: 'opening', halfPointsLost: 2 }),
      mistake({ phase: 'middlegame', halfPointsLost: 2 }),
      mistake({ phase: 'middlegame', halfPointsLost: 2 }),
    ]);
    expect(curve.get('middlegame')).toBe(1);
    expect(curve.get('opening')).toBe(0.5);
    expect(curve.get('endgame')).toBe(0);
  });

  it('degrades to equal weighting when the recent cost is zero', () => {
    const curve = phaseCostCurve([]);
    expect(curve.get('opening')).toBe(1);
    expect(curve.get('middlegame')).toBe(1);
    expect(curve.get('endgame')).toBe(1);
  });
});

describe('orderSuggestions', () => {
  const candidates = [
    { kind: 'phase' as const, groupKey: 'opening', label: 'Opening' },
    { kind: 'phase' as const, groupKey: 'endgame', label: 'Endgame' },
    { kind: 'motif' as const, groupKey: 'hanging_piece', label: 'Hanging piece' },
  ];

  it('puts the group whose recent mistakes sit in the bleeding phase first', () => {
    // Both groups lost the same recent cost; one sits in the bleeding
    // middlegame, the other in the quiet endgame.
    const mistakes = [
      mistake({ phase: 'middlegame', motif: 'hanging_piece' }),
      mistake({ phase: 'middlegame', motif: 'hanging_piece' }),
      mistake({ phase: 'endgame' }),
      mistake({ phase: 'endgame' }),
    ];
    const ordered = orderSuggestions(candidates, mistakes);
    expect(ordered[0]!.kind).toBe('motif');
    expect(ordered[0]!.groupKey).toBe('hanging_piece');
    // The endgame phase group carries its own recent cost, so it outranks the
    // opening phase group even though its curve weight is 0.
    expect(ordered[1]!.groupKey).toBe('endgame');
    expect(ordered[2]!.groupKey).toBe('opening');
  });

  it('scores a phase group at its own recent cost', () => {
    const mistakes = [mistake({ phase: 'opening', halfPointsLost: 2 })];
    const ordered = orderSuggestions(candidates, mistakes);
    const opening = ordered.find((s) => s.groupKey === 'opening')!;
    expect(opening.score).toBe(opening.recentCost);
    expect(opening.recentCost).toBeGreaterThan(0);
  });

  it('sends a group with no recent mistakes to the back', () => {
    const mistakes = [mistake({ phase: 'opening' })];
    const ordered = orderSuggestions(candidates, mistakes);
    // The opening phase group owns the mistake; the endgame phase group and
    // the motif both score zero and tie-break by kind then key.
    expect(ordered[0]).toMatchObject({ kind: 'phase', groupKey: 'opening' });
    expect(ordered.at(-1)).toMatchObject({ kind: 'phase', groupKey: 'endgame', score: 0 });
  });

  it('breaks equal scores by kind and key when nothing is recent', () => {
    const ordered = orderSuggestions(
      [
        { kind: 'motif' as const, groupKey: 'b', label: 'B' },
        { kind: 'motif' as const, groupKey: 'a', label: 'A' },
      ],
      [],
    );
    expect(ordered.map((s) => s.groupKey)).toEqual(['a', 'b']);
  });
});
