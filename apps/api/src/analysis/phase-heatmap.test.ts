/**
 * ST-155. The heatmap composition, pinned without a database: the fixed
 * zero-filled order, the three-instance floor withholding the cost figure,
 * and the count staying honest at any size.
 */
import { describe, expect, it } from 'vitest';
import { composePhaseHeatmap, HEATMAP_CELL_FLOOR, type PhaseCostRow } from './phase-heatmap.ts';

function row(
  phase: PhaseCostRow['phase'],
  occurrences: number,
  cost = occurrences * 0.5,
): PhaseCostRow {
  return { phase, occurrences, halfPointsLost: occurrences, severityWeightedCost: cost };
}

describe('composePhaseHeatmap', () => {
  it('zero-fills all three phases in fixed order', () => {
    const cells = composePhaseHeatmap([row('endgame', 4)]);
    expect(cells.map((c) => c.phase)).toEqual(['opening', 'middlegame', 'endgame']);
    expect(cells[0]).toEqual({
      phase: 'opening',
      occurrences: 0,
      halfPointsLost: 0,
      severityWeightedCost: null,
    });
    expect(cells[2]!.severityWeightedCost).toBe(2);
  });

  it('withholds the cost below the floor but keeps the count', () => {
    const thin = HEATMAP_CELL_FLOOR - 1;
    const cells = composePhaseHeatmap([row('opening', thin, 9)]);
    expect(cells[0]!.occurrences).toBe(thin);
    expect(cells[0]!.halfPointsLost).toBe(thin);
    expect(cells[0]!.severityWeightedCost).toBeNull();
  });

  it('shows the cost at exactly the floor', () => {
    const cells = composePhaseHeatmap([row('middlegame', HEATMAP_CELL_FLOOR, 2)]);
    expect(cells[1]!.severityWeightedCost).toBe(2);
  });

  it('renders an empty scope as three quiet cells, not a missing one', () => {
    const cells = composePhaseHeatmap([]);
    expect(cells).toHaveLength(3);
    expect(cells.every((c) => c.occurrences === 0 && c.severityWeightedCost === null)).toBe(true);
  });
});
