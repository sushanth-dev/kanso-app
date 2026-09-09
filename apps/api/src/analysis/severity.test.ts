/**
 * ST-149. The opponent-normalized severity weight, pinned against the
 * worked cases from the implementation plan.
 *
 * No database, no clock. These are the numbers a coach will check, so they
 * are the numbers tested.
 */
import { describe, expect, test } from 'vitest';
import {
  severityWeight,
  SEVERITY_ELO_SCALE,
  SEVERITY_REFERENCE_ELO,
  weightedSeverity,
} from './severity.ts';

describe('severityWeight', () => {
  test("the 1500 anchor is weight 1 (regression: today's ranking must not move)", () => {
    expect(severityWeight(1500).weight).toBeCloseTo(1, 10);
  });

  test('a stronger opponent weighs a mistake more than a weaker one', () => {
    expect(severityWeight(2200).weight).toBeGreaterThan(severityWeight(1400).weight);
  });

  test('a missing opponent Elo falls back to a neutral weight, not a fabricated rating', () => {
    expect(severityWeight(null)).toEqual({ weight: 1, isFallback: true });
  });

  test('the constants are the numbers the story decided', () => {
    expect(SEVERITY_REFERENCE_ELO).toBe(1500);
    expect(SEVERITY_ELO_SCALE).toBe(400);
  });

  test('the weight is monotonic across a small Elo ladder', () => {
    const ladder = [1000, 1200, 1400, 1500, 1600, 1800, 2200].map(
      (elo) => severityWeight(elo).weight,
    );
    ladder.slice(1).forEach((weight, i) => {
      expect(weight).toBeGreaterThan(ladder[i]!);
    });
  });
});

describe('weightedSeverity', () => {
  test('identical cpLoss at a stronger opponent outranks the same cpLoss at a weaker one', () => {
    const cpLoss = 300;
    expect(weightedSeverity(cpLoss, 2200)).toBeGreaterThan(weightedSeverity(cpLoss, 1400));
  });

  test('a missing opponent Elo leaves the magnitude unweighted', () => {
    expect(weightedSeverity(300, null)).toBe(300);
  });

  test('the 1500 anchor leaves the magnitude unweighted too', () => {
    expect(weightedSeverity(300, 1500)).toBeCloseTo(300, 8);
  });
});
