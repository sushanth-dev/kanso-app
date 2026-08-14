import { defineConfig } from 'vitest/config';

// The test policy is in the `project` repository under docs/process/testing.md,
// and the reasoning behind this setup is in ADR-0019.
//
// Two projects, one runner. Unit tests never touch a database and must stay
// fast, because they are what the pre-commit hook runs. Integration tests
// connect to a real PostgreSQL through DATABASE_URL and are selected by name,
// so a contributor with no database can still run the suite that does not
// need one.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['apps/*/src/**/*.test.ts'],
          exclude: ['apps/*/src/**/*.integration.test.ts'],
          // Determinism is a rule, not a preference (docs/process/testing.md).
          // A test that reads the wall clock is a test that fails on a
          // Tuesday. This settles what `vi.useFakeTimers()` fakes when a test
          // asks for it, so every test that pins the clock pins the same
          // things.
          fakeTimers: {
            toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
          },
        },
      },
      {
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['apps/web/src/test/setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['apps/*/src/**/*.integration.test.ts'],
          // Applying migrations to a fresh database is measured in seconds.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['apps/*/src/**'],
      // Generated, hand-written-against, or not ours to cover.
      exclude: [
        'apps/*/src/**/*.test.ts',
        'apps/*/src/**/*.test.tsx',
        'apps/*/src/contract/emit-openapi.ts',
        'apps/web/src/generated/**',
      ],
    },
  },
});
