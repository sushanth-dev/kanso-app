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

  test('maps any opening group to the opening theme, whatever the ECO', () => {
    expect(themeForGroup('opening', 'B22')).toBe('opening');
    expect(themeForGroup('opening', 'A00')).toBe('opening');
  });

  test('maps time trouble to the decisive-move fallback', () => {
    expect(themeForGroup('time_trouble', 'time_trouble')).toBe('crushing');
  });

  test('an unknown group maps to nothing and the route refuses it', () => {
    expect(themeForGroup('motif', 'nope')).toBeNull();
    expect(themeForGroup('phase', 'hanging_piece')).toBeNull();
  });

  test('time_trouble maps whatever key it is handed, the kind deciding alone', () => {
    expect(themeForGroup('time_trouble', 'B01')).toBe('crushing');
  });

  test("a kind only reads its own table, never another kind's keys", () => {
    expect(themeForGroup('motif', 'opening')).toBeNull();
    expect(themeForGroup('motif', 'endgame')).toBeNull();
    expect(themeForGroup('phase', 'missed_check')).toBeNull();
  });
});
