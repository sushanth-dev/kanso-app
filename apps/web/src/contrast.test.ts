// @vitest-environment jsdom
// ST-104. The module writes to the real documentElement and localStorage, so
// this suite runs against jsdom even though it lands in the unit project. The
// shared web setup file never loads here, which is what we want: it stubs
// matchMedia globally, and deciding when the hint exists is the point of
// these tests.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { STORAGE_KEY, applyContrast, resolveInitialContrast, setContrast } from './contrast.ts';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-contrast');
});

describe('resolveInitialContrast', () => {
  test('the stored choice wins over the system hint', () => {
    window.localStorage.setItem(STORAGE_KEY, 'standard');
    stubMatchMedia(true);
    expect(resolveInitialContrast()).toBe('standard');
  });

  test('with nothing stored, the system contrast hint resolves high', () => {
    stubMatchMedia(true);
    expect(resolveInitialContrast()).toBe('high');
  });

  test('with nothing stored and no hint, resolves standard', () => {
    stubMatchMedia(false);
    expect(resolveInitialContrast()).toBe('standard');
  });

  test('without matchMedia at all, resolves standard', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveInitialContrast()).toBe('standard');
  });

  test('an invalid stored value falls through to the system hint', () => {
    window.localStorage.setItem(STORAGE_KEY, 'midnight');
    stubMatchMedia(true);
    expect(resolveInitialContrast()).toBe('high');
  });
});

describe('applyContrast', () => {
  test('high sets the scope attribute on the document element', () => {
    applyContrast('high');
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');
  });

  test('standard removes the attribute rather than storing an empty value', () => {
    document.documentElement.setAttribute('data-contrast', 'high');
    applyContrast('standard');
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
  });
});

describe('setContrast', () => {
  test('high persists the choice and flips the attribute', () => {
    setContrast('high');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('high');
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');
  });

  test('standard persists the choice and clears the attribute', () => {
    document.documentElement.setAttribute('data-contrast', 'high');
    setContrast('standard');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('standard');
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
  });
});
