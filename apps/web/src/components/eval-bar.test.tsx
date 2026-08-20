import { describe, expect, test } from 'vitest';
import { evalLabel, whiteShare } from './eval-bar.tsx';

describe('whiteShare', () => {
  test('a null evaluation is neutral', () => {
    expect(whiteShare(null)).toBe(0.5);
  });

  test('a dead-equal position is half white', () => {
    expect(whiteShare({ cp: 0, mate: null })).toBeCloseTo(0.5, 2);
  });

  test('white advantage fills most of the bar', () => {
    expect(whiteShare({ cp: 400, mate: null })).toBeGreaterThan(0.8);
    expect(whiteShare({ cp: -400, mate: null })).toBeLessThan(0.2);
  });

  test('a mate resolves to a near-certain fill', () => {
    expect(whiteShare({ cp: null, mate: 3 })).toBeGreaterThan(0.99);
    expect(whiteShare({ cp: null, mate: -3 })).toBeLessThan(0.01);
  });
});

describe('evalLabel', () => {
  test('formats centipawns in pawns with a sign', () => {
    expect(evalLabel({ cp: 120, mate: null })).toBe('+1.2');
    expect(evalLabel({ cp: -40, mate: null })).toBe('-0.4');
    expect(evalLabel({ cp: 0, mate: null })).toBe('0.0');
  });

  test('formats a mate as a move count', () => {
    expect(evalLabel({ cp: null, mate: 3 })).toBe('M3');
    expect(evalLabel({ cp: null, mate: -2 })).toBe('-M2');
  });

  test('a null evaluation is a dash', () => {
    expect(evalLabel(null)).toBe('\u2014');
  });
});
