/**
 * ST-025. The `%clk` parse, over the exact strings providers write.
 *
 * The security assessment is what these pin: a malformed clock is null (counted
 * as missing), never zero and never an exception.
 */
import { describe, expect, test } from 'vitest';
import { parseClockMs } from './clock.ts';

describe('parseClockMs', () => {
  test('parses H:MM:SS', () => {
    expect(parseClockMs('[%clk 0:02:58]')).toBe(178000);
  });

  test('parses hours', () => {
    expect(parseClockMs('[%clk 1:00:00]')).toBe(3600000);
  });

  test('parses fractional seconds', () => {
    expect(parseClockMs('[%clk 0:00:01.5]')).toBe(1500);
  });

  test('a comment that is not a clock is null', () => {
    expect(parseClockMs('[%eval 0.5]')).toBeNull();
    expect(parseClockMs('')).toBeNull();
  });

  test('a malformed clock is null, never zero', () => {
    expect(parseClockMs('[%clk 0:02:99]')).toBeNull();
    expect(parseClockMs('[%clk 0:2]')).toBeNull();
    expect(parseClockMs('[%clk abc]')).toBeNull();
  });

  test('a clock beside other annotations is still found', () => {
    // Providers attach %clk to a comment that also carries an eval.
    expect(parseClockMs('[%eval 0.2] [%clk 0:01:30]')).toBe(90000);
    expect(parseClockMs('0.12/0 [%clk 0:00:45]')).toBe(45000);
  });

  test('two-digit hours parse', () => {
    expect(parseClockMs('[%clk 12:34:56]')).toBe(45296000);
  });

  test('the minute and second bounds are inclusive', () => {
    expect(parseClockMs('[%clk 0:59:59]')).toBe(3599000);
    expect(parseClockMs('[%clk 1:60:00]')).toBeNull();
    expect(parseClockMs('[%clk 1:00:60]')).toBeNull();
  });

  test('fractional digits are milliseconds, one to three of them', () => {
    expect(parseClockMs('[%clk 0:00:00.1]')).toBe(100);
    expect(parseClockMs('[%clk 0:00:00.25]')).toBe(250);
    expect(parseClockMs('[%clk 0:00:00.999]')).toBe(999);
  });

  test('a bare %clk with no time is null', () => {
    expect(parseClockMs('[%clk]')).toBeNull();
    expect(parseClockMs('[%clk : :]')).toBeNull();
  });
});
