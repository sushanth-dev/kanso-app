import { afterEach, describe, expect, test, vi } from 'vitest';
// Dynamic import + resetModules is required: the module captures
// import.meta.env at load time, so each branch re-imports it after mutating
// the environment (restored afterwards).
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('API base URL resolution', () => {
  test('falls back to the page origin when no API URL is configured', async () => {
    delete (import.meta.env as Record<string, string | undefined>).VITE_API_URL;
    const { apiBaseUrl } = await import('./base-url.ts');
    expect(apiBaseUrl).toBe(window.location.origin);
  });

  test('ignores an empty VITE_API_URL only when unset, treating empty as configured', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const { apiBaseUrl } = await import('./base-url.ts');
    expect(apiBaseUrl).toBe('');
  });

  test('uses the baked-in API URL in production', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.chess.example');
    const { apiBaseUrl } = await import('./base-url.ts');
    expect(apiBaseUrl).toBe('https://api.chess.example');
  });
});
