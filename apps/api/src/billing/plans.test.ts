import { describe, expect, test } from 'vitest';
import { PLAN_PRICES, periodEndFor } from './plans.ts';

describe('plans', () => {
  test('prices are the ST-043 numbers in cents', () => {
    expect(PLAN_PRICES.monthly.amountCents).toBe(1500);
    expect(PLAN_PRICES.season.amountCents).toBe(13000);
    expect(PLAN_PRICES.yearly.amountCents).toBe(15000);
  });

  test('monthly and yearly periods end the right number of months later', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    expect(periodEndFor('monthly', now).toISOString()).toBe('2026-02-15T12:00:00.000Z');
    expect(periodEndFor('yearly', now).toISOString()).toBe('2027-01-15T12:00:00.000Z');
  });

  test('a season ends at the next May 31', () => {
    // In the season (April): this May 31.
    expect(periodEndFor('season', new Date('2026-04-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-05-31T00:00:00.000Z',
    );
    // Before the season (June): next year's May 31.
    expect(periodEndFor('season', new Date('2026-06-01T00:00:00.000Z')).toISOString()).toBe(
      '2027-05-31T00:00:00.000Z',
    );
    // At the season start (September): next year's May 31.
    expect(periodEndFor('season', new Date('2026-09-01T00:00:00.000Z')).toISOString()).toBe(
      '2027-05-31T00:00:00.000Z',
    );
  });
});
