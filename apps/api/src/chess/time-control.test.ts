/**
 * ST-040. Pins the time-control classifier's buckets, because the online
 * window's "blitz only" rule is exactly this function, and a boundary that
 * drifts silently drops games that should count or keeps games that should not.
 */
import { describe, expect, test } from 'vitest';
import { classifyTimeControl } from './time-control.ts';

describe('classifyTimeControl', () => {
  test('bullet is under three minutes', () => {
    expect(classifyTimeControl('30+0')).toBe('bullet');
    expect(classifyTimeControl('60+0')).toBe('bullet');
    expect(classifyTimeControl('120+1')).toBe('bullet');
  });

  test('blitz is three to under ten minutes', () => {
    expect(classifyTimeControl('180+0')).toBe('blitz');
    expect(classifyTimeControl('180+2')).toBe('blitz');
    expect(classifyTimeControl('300+0')).toBe('blitz');
  });

  test('rapid is ten to under thirty minutes', () => {
    expect(classifyTimeControl('600+0')).toBe('rapid');
    expect(classifyTimeControl('900+10')).toBe('rapid');
  });

  test('classical is thirty minutes and over', () => {
    expect(classifyTimeControl('1800+0')).toBe('classical');
    expect(classifyTimeControl('5400+30')).toBe('classical');
  });

  test('untimed, repeating, and unparseable forms are null', () => {
    expect(classifyTimeControl(null)).toBeNull();
    expect(classifyTimeControl('-')).toBeNull();
    expect(classifyTimeControl('40/9000')).toBeNull();
    expect(classifyTimeControl('nonsense')).toBeNull();
  });
});
