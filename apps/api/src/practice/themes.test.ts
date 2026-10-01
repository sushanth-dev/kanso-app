/**
 * ST-106. The theme map is the whole bridge between the report's weakness
 * groups and the Lichess puzzle themes, so every group the report can name
 * is pinned here. A group that loses its mapping is a report card whose
 * practice link answers 422 - the test makes that a deliberate change.
 */
import { describe, expect, test } from 'vitest';
import { themeForGroup } from './themes.ts';

describe('themeForGroup', () => {
  test('maps every motif group to its Lichess theme', () => {
    expect(themeForGroup('motif', 'hanging_piece')).toBe('hangingPiece');
    expect(themeForGroup('motif', 'missed_check')).toBe('intermezzo');
    expect(themeForGroup('motif', 'missed_capture')).toBe('advantage');
    expect(themeForGroup('motif', 'missed_threat')).toBe('crushing');
  });

  test('maps the phase groups to the same-name themes', () => {
    expect(themeForGroup('phase', 'opening')).toBe('opening');
    expect(themeForGroup('phase', 'middlegame')).toBe('middlegame');
    expect(themeForGroup('phase', 'endgame')).toBe('endgame');
  });

  test('maps an opening group to the opening theme when the key is an ECO code', () => {
    expect(themeForGroup('opening', 'B22')).toBe('opening');
    expect(themeForGroup('opening', 'A00')).toBe('opening');
  });

  test('refuses an opening key that cannot be an ECO code', () => {
    expect(themeForGroup('opening', 'zzz')).toBeNull();
    expect(themeForGroup('opening', 'B0')).toBeNull();
    expect(themeForGroup('opening', 'B123')).toBeNull();
    expect(themeForGroup('opening', '')).toBeNull();
  });

  test('maps time trouble to the decisive-move fallback', () => {
    expect(themeForGroup('time_trouble', 'time_trouble')).toBe('crushing');
  });

  test('an unknown group maps to nothing and the route refuses it', () => {
    expect(themeForGroup('motif', 'nope')).toBeNull();
    expect(themeForGroup('phase', 'hanging_piece')).toBeNull();
  });

  test('time trouble accepts only its own key, the evidence deciding alone', () => {
    // groupKeyOf returns exactly 'time_trouble' for the kind; a different
    // string is not a group this player could have, so B01 - the pinned
    // behaviour bug 26.9 named - now refuses like any other unknown group.
    expect(themeForGroup('time_trouble', 'B01')).toBeNull();
  });

  test("a kind only reads its own table, never another kind's keys", () => {
    expect(themeForGroup('motif', 'opening')).toBeNull();
    expect(themeForGroup('motif', 'endgame')).toBeNull();
    expect(themeForGroup('phase', 'missed_check')).toBeNull();
  });
});
