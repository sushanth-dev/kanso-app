import { describe, expect, test } from 'vitest';
import { costMicrosFor } from './cost.ts';

describe('costMicrosFor', () => {
  test('matches the three games measured in analysis-cost.md', () => {
    // The doc rounds to three figures; the column stores the exact value.
    expect(costMicrosFor(31_800) / 1_000_000).toBeCloseTo(0.00125, 4);
    expect(costMicrosFor(80_700) / 1_000_000).toBeCloseTo(0.00316, 4);
    expect(costMicrosFor(276_600) / 1_000_000).toBeCloseTo(0.01083, 4);
  });

  test('returns whole micro-dollars', () => {
    expect(Number.isInteger(costMicrosFor(31_800))).toBe(true);
  });
});
