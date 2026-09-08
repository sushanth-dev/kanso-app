// @vitest-environment jsdom
// ST-148. The module writes to the real documentElement and localStorage, so
// this suite runs against jsdom even though it lands in the unit project,
// mirroring contrast.test.ts next door.
import { afterEach, describe, expect, test } from 'vitest';
import { STORAGE_KEY, applyTheme, resolveInitialTheme, setTheme } from './theme-preference.ts';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('resolveInitialTheme', () => {
  test('nothing stored resolves Nocturne, the brand default', () => {
    expect(resolveInitialTheme()).toBe('nocturne');
  });

  test('the stored choice wins, either direction', () => {
    window.localStorage.setItem(STORAGE_KEY, 'study-room');
    expect(resolveInitialTheme()).toBe('study-room');
    window.localStorage.setItem(STORAGE_KEY, 'nocturne');
    expect(resolveInitialTheme()).toBe('nocturne');
  });

  test('an invalid stored value falls through to the default', () => {
    window.localStorage.setItem(STORAGE_KEY, 'midnight');
    expect(resolveInitialTheme()).toBe('nocturne');
  });
});

describe('applyTheme', () => {
  test('nocturne sets the dark value on the document element', () => {
    applyTheme('nocturne');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('study-room sets the light value rather than removing the attribute', () => {
    applyTheme('study-room');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('setTheme', () => {
  test('study-room persists the choice and flips the attribute', () => {
    applyTheme('nocturne');
    setTheme('study-room');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('study-room');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
