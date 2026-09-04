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

  test('every bucket boundary falls on the correct side', () => {
    expect(classifyTimeControl('179+0')).toBe('bullet');
    expect(classifyTimeControl('180+0')).toBe('blitz');
    expect(classifyTimeControl('599+0')).toBe('blitz');
    expect(classifyTimeControl('600+0')).toBe('rapid');
    expect(classifyTimeControl('1799+0')).toBe('rapid');
    expect(classifyTimeControl('1800+0')).toBe('classical');
  });

  test('increments and delays do not shift the bucket', () => {
    expect(classifyTimeControl('120+59')).toBe('bullet');
    expect(classifyTimeControl('179+999')).toBe('bullet'); // 179 base seconds: bullet, however long the delay
    expect(classifyTimeControl('180+59')).toBe('blitz');
    expect(classifyTimeControl('5400+30')).toBe('classical');
  });

  test('a control with no increment still classifies', () => {
    expect(classifyTimeControl('60')).toBe('bullet');
    expect(classifyTimeControl('300')).toBe('blitz');
  });

  test('zero base seconds is bullet rather than unparseable', () => {
    expect(classifyTimeControl('0')).toBe('bullet');
    expect(classifyTimeControl('0+2')).toBe('bullet');
  });

  test('an astronomically large base is still classical', () => {
    expect(classifyTimeControl('99999999')).toBe('classical');
  });

  test('surrounding whitespace is trimmed before parsing', () => {
    expect(classifyTimeControl('  180+2  ')).toBe('blitz');
    expect(classifyTimeControl(' - ')).toBeNull();
  });

  test('malformed shapes are null rather than guessed', () => {
    expect(classifyTimeControl('')).toBeNull(); // empty string
    expect(classifyTimeControl('   ')).toBeNull(); // whitespace only
    expect(classifyTimeControl('+')).toBeNull(); // increment only
    expect(classifyTimeControl('+30')).toBeNull(); // no base before the plus
    expect(classifyTimeControl('40/9000+30')).toBeNull(); // repeating with increment
    expect(classifyTimeControl('18o+0')).toBeNull(); // letter in the digits
    expect(classifyTimeControl('180 +2')).toBeNull(); // space inside the base
    expect(classifyTimeControl('180-2')).toBeNull(); // wrong separator
  });
});
