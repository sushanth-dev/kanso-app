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
});
