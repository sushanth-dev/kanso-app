import { describe, expect, test } from 'vitest';
import {
  ANALYSIS_MONTHLY_CAP,
  CURRENCY,
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

  test('explanation caps: beginner 50, intermediate 100, pro is not capped', () => {
    expect(EXPLANATION_MONTHLY_CAP.beginner).toBe(50);
    expect(EXPLANATION_MONTHLY_CAP.intermediate).toBe(100);
    expect(EXPLANATION_MONTHLY_CAP.pro).toBeNull();
  });

  test('a plan renews a month later', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    expect(nextRenewal(now).toISOString()).toBe('2026-02-15T12:00:00.000Z');
  });

  test('renewal crosses the year boundary', () => {
    const now = new Date('2026-12-15T09:30:00.000Z');
    expect(nextRenewal(now).toISOString()).toBe('2027-01-15T09:30:00.000Z');
  });

  test('renewal keeps the time of day and does not mutate the input', () => {
    const now = new Date('2026-06-10T08:00:00.000Z');
    const renewal = nextRenewal(now);
    expect(renewal.toISOString()).toBe('2026-07-10T08:00:00.000Z');
    expect(now.toISOString()).toBe('2026-06-10T08:00:00.000Z');
  });

  test('a renewal bought on a month-end rolls over like UTC month arithmetic', () => {
    // Jan 31 + one month has no Feb 31, so JavaScript lands on Mar 3. The
    // renewal is informational only today; this pins what it currently does.
    const now = new Date('2026-01-31T23:59:59.000Z');
    expect(nextRenewal(now).toISOString()).toBe('2026-03-03T23:59:59.000Z');
  });

  test('checkout is denominated in INR paise', () => {
    expect(CURRENCY).toBe('INR');
    for (const price of Object.values(PLAN_PRICES)) {
      expect(Number.isInteger(price.amountMinor)).toBe(true);
      expect(price.amountMinor).toBeGreaterThan(0);
    }
  });
});
