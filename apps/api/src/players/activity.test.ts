import { describe, expect, test } from 'vitest';
import { levelFromXp } from './activity.ts';

describe('levelFromXp', () => {
  test('level 1 covers 0 to 99 xp', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
  });

  test('every 100 xp is one more level', () => {
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(250)).toBe(3);
    expect(levelFromXp(1000)).toBe(11);
  });
});
