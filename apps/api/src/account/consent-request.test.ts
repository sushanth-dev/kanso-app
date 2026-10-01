/**
 * The sign-up date-of-birth boundary. The COPPA gate reads a date string
 * through `Date`, so a value that is not strict YYYY-MM-DD silently reads as
 * an adult; `isIsoDate` is the check that keeps such a value from ever
 * reaching the gate.
 */
import { describe, expect, test } from 'vitest';
import { isIsoDate, isUnder13 } from './consent-request.ts';

describe('isIsoDate', () => {
  test('accepts strict YYYY-MM-DD calendar dates', () => {
    expect(isIsoDate('2000-06-01')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
  });

  test('rejects non-ISO shapes that Date would mangle', () => {
    expect(isIsoDate('2015/06/01')).toBe(false);
    expect(isIsoDate('2015-6-1')).toBe(false);
    expect(isIsoDate('20150601')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  test('rejects impossible calendar dates', () => {
    expect(isIsoDate('2023-02-30')).toBe(false);
    expect(isIsoDate('2021-13-01')).toBe(false);
  });
});

describe('isUnder13 on validated input', () => {
  test('a recent birth date is under 13 and one long past is not', () => {
    const today = new Date('2026-09-30T00:00:00Z');
    expect(isUnder13('2015-06-01', today)).toBe(true);
    expect(isUnder13('2000-06-01', today)).toBe(false);
    // Exactly the 13th birthday is adult: the gate is "before the 13th".
    expect(isUnder13('2013-09-30', today)).toBe(false);
  });
});
