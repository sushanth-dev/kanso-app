import { defineConfig } from 'vitest/config';

// The test policy is in the `project` repository under docs/process/testing.md,
// and the reasoning behind this setup is in ADR-0019.
export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.ts'],
    // Determinism is a rule, not a preference (docs/process/testing.md). A test
    // that reads the wall clock is a test that fails on a Tuesday. This does
    // not fake anything on its own; it settles what `vi.useFakeTimers()` fakes
    // when a test asks for it, so every test that pins the clock pins the same
    // things.
    fakeTimers: { toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['apps/*/src/**'],
      // Generated, hand-written-against, or not ours to cover.
      exclude: ['apps/*/src/**/*.test.ts', 'apps/*/src/contract/emit-openapi.ts'],
    },
  },
});
