/**
 * Appearance preference (ST-148). The Nocturne dark study is the default
 * theme; the Study Room light theme stays one radio away. This module is the
 * only writer of the `data-theme` attribute (values 'dark' | 'light'), the
 * same one-writer contract the contrast module holds for `data-contrast`,
 * so the CSS and the tests can hold it to one switch.
 */

export const STORAGE_KEY = 'kanso-theme';

export type ThemePreference = 'nocturne' | 'study-room';

/**
 * The stored choice wins; nothing stored means Nocturne. Unlike contrast -
 * where the OS hint promotes an accessibility need - a light OS scheme is a
 * preference, and the brand's default is the study after dark. Study Room is
 * one settings radio away and persists once chosen.
 */
export function resolveInitialTheme(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'nocturne' || stored === 'study-room') return stored;
  return 'nocturne';
}

/** The attribute is the theme switch: 'dark' is Nocturne, 'light' is the Study Room. */
export function applyTheme(pref: ThemePreference): void {
  document.documentElement.setAttribute('data-theme', pref === 'nocturne' ? 'dark' : 'light');
}

export function setTheme(pref: ThemePreference): void {
  window.localStorage.setItem(STORAGE_KEY, pref);
  applyTheme(pref);
}
