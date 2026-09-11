/**
 * ST-153. The brief validator is the extension's trust boundary: everything
 * the card may render must survive it, and everything malformed must not.
 */
import { describe, expect, test } from 'vitest';
import { isBrief } from './brief.ts';

const valid = {
  groups: [{ label: 'Hanging piece', stream: 'online', weekCount: 4 }],
  focusLabel: 'Check the loose pieces first',
};

describe('isBrief', () => {
  test('accepts the endpoint payload with empty groups and a null focus', () => {
    expect(isBrief({ groups: [], focusLabel: null })).toBe(true);
    expect(isBrief(valid)).toBe(true);
  });

  test('refuses non-objects and missing keys', () => {
    expect(isBrief(null)).toBe(false);
    expect(isBrief('brief')).toBe(false);
    expect(isBrief({})).toBe(false);
    expect(isBrief({})).toBe(false);
    expect(isBrief({ groups: [] })).toBe(false);
    expect(isBrief({ focusLabel: null })).toBe(false);
  });

  test('refuses a group with a wrong or missing field', () => {
    expect(
      isBrief({ groups: [{ label: 'x', stream: 'online', weekCount: 1.5 }], focusLabel: null }),
    ).toBe(false);
    expect(isBrief({ groups: [{ label: 'x', stream: 'online' }], focusLabel: null })).toBe(false);
    expect(isBrief({ groups: [{ label: 'x', weekCount: 1 }], focusLabel: null })).toBe(false);
    expect(isBrief({ groups: [{ stream: 'online', weekCount: 1 }], focusLabel: null })).toBe(false);
  });

  test('refuses a non-string focus', () => {
    expect(isBrief({ groups: [], focusLabel: 7 })).toBe(false);
  });
});
