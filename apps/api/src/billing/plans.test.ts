import { describe, expect, test } from 'vitest';
import {
  ANALYSIS_MONTHLY_CAP,
  EXPLANATION_MONTHLY_CAP,
  PLAN_PRICES,
  nextRenewal,
} from './plans.ts';

describe('plans', () => {
  test('prices are the ST-074 numbers in paise', () => {
    expect(PLAN_PRICES.intermediate.amountMinor).toBe(79900);
    expect(PLAN_PRICES.pro.amountMinor).toBe(129900);
  });

  test('analysis caps: beginner and intermediate are capped, pro is not', () => {
    expect(ANALYSIS_MONTHLY_CAP.beginner).toBe(30);
    expect(ANALYSIS_MONTHLY_CAP.intermediate).toBe(150);
    expect(ANALYSIS_MONTHLY_CAP.pro).toBeNull();
  });

  test('explanation caps: beginner 10, intermediate 100, pro is not capped', () => {
    expect(EXPLANATION_MONTHLY_CAP.beginner).toBe(10);
    expect(EXPLANATION_MONTHLY_CAP.intermediate).toBe(100);
    expect(EXPLANATION_MONTHLY_CAP.pro).toBeNull();
  });

  test('a plan renews a month later', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    expect(nextRenewal(now).toISOString()).toBe('2026-02-15T12:00:00.000Z');
  });
});
