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
});
