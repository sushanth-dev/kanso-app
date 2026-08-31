/**
 * Contrast preference (ST-104). The authored high-contrast theme scopes to
 * `html[data-contrast='high']`; this module is the only writer of that
 * attribute so the CSS and the tests can hold it to one contract.
 */

export const STORAGE_KEY = 'kanso-contrast';

export type ContrastPreference = 'standard' | 'high';

/**
 * The stored choice wins over the operating system. Only then does the
 * system's `prefers-contrast: more` hint promote the initial theme to high,
 * so a user who never touches Settings still gets the theme their OS asked
 * for. The matchMedia guard keeps this honest in environments without the
 * API (jsdom tests, older embeds).
 */
export function resolveInitialContrast(): ContrastPreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'standard' || stored === 'high') return stored;
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-contrast: more)').matches
  ) {
    return 'high';
  }
  return 'standard';
}

/** The attribute is the theme's on/off switch: present is high, absent is standard. */
export function applyContrast(pref: ContrastPreference): void {
  if (pref === 'high') {
    document.documentElement.setAttribute('data-contrast', 'high');
  } else {
    document.documentElement.removeAttribute('data-contrast');
  }
}

export function setContrast(pref: ContrastPreference): void {
  window.localStorage.setItem(STORAGE_KEY, pref);
  applyContrast(pref);
}
