/**
 * ST-122. Spot checks on the generated ECO map: the mainstream codes the
 * players leak sit at their family root, the narrower codes stay inside their
 * variation family, and the table covers every published code. The map is
 * generated - these tests pin the shape of what generation may not drift on.
 */
import { describe, expect, test } from 'vitest';
import { ECO_OPENINGS } from './eco-openings.ts';

describe('ECO_OPENINGS', () => {
  test('mainstream ECOs point at their family root', () => {
    expect(ECO_OPENINGS['B01']).toBe('Scandinavian_Defense');
    expect(ECO_OPENINGS['B10']).toBe('Caro-Kann_Defense');
    expect(ECO_OPENINGS['C30']).toBe('Kings_Gambit');
  });

  test('a narrower ECO stays inside its variation family', () => {
    expect(ECO_OPENINGS['B90']).toBe('Sicilian_Defense_Najdorf_Variation');
  });

  test('every published code is covered', () => {
    expect(Object.keys(ECO_OPENINGS)).toHaveLength(500);
  });

  test('every key is a published ECO code', () => {
    for (const key of Object.keys(ECO_OPENINGS)) {
      expect(key).toMatch(/^[A-E][0-9]{2}$/);
    }
  });

  test('every value is a Lichess tag slug the opening rungs can prefix-match', () => {
    for (const value of Object.values(ECO_OPENINGS)) {
      // Like the tags themselves: word characters and hyphens, joined by
      // single underscores, never a leading or trailing one.
      expect(value).toMatch(/^[A-Za-z0-9-]+(_[A-Za-z0-9-]+)*$/);
    }
  });

  test('the map answers uppercase codes only; a lowercase code is absent', () => {
    expect(ECO_OPENINGS['b01']).toBeUndefined();
  });

  test('each letter band is covered', () => {
    for (const letter of ['A', 'B', 'C', 'D', 'E']) {
      expect(Object.keys(ECO_OPENINGS).some((code) => code.startsWith(letter))).toBe(true);
    }
  });
});
