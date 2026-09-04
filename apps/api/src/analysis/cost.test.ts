import { describe, expect, test } from 'vitest';
import { DEFAULT_MEMORY_MB, GB_SECOND_USD, costMicrosFor } from './cost.ts';

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

  test('zero duration costs nothing', () => {
    expect(costMicrosFor(0)).toBe(0);
  });

  test('the memory default is the shape the rate was measured against', () => {
    expect(costMicrosFor(1_000)).toBe(costMicrosFor(1_000, DEFAULT_MEMORY_MB));
  });

  test('cost scales linearly with memory and duration', () => {
    // Double the memory at a fixed duration: exactly double the cost, because
    // the rounding boundary is not hit at these sizes.
    expect(costMicrosFor(60_000, 6_016)).toBe(2 * costMicrosFor(60_000, 3_008));
    expect(costMicrosFor(120_000)).toBe(2 * costMicrosFor(60_000));
  });

  test('rounds to whole micro-dollars at tiny durations', () => {
    expect(Number.isInteger(costMicrosFor(1))).toBe(true);
  });

  test('the rate and default memory are the numbers analysis-cost.md measured', () => {
    expect(GB_SECOND_USD).toBe(0.0000133334);
    expect(DEFAULT_MEMORY_MB).toBe(3008);
  });
});
