import { describe, expect, test } from 'vitest';
import { tierAtResourceIndex } from './action-items.ts';

describe('tierAtResourceIndex', () => {
  test('an untagged resource takes the tier of its position in the set', () => {
    expect(tierAtResourceIndex(0)).toBe('beginner');
    expect(tierAtResourceIndex(1)).toBe('intermediate');
    expect(tierAtResourceIndex(2)).toBe('advanced');
  });

  test('a position outside the three-part set stays the middle default', () => {
    expect(tierAtResourceIndex(3)).toBe('intermediate');
  });
});
