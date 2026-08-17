import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// jsdom does not implement window.matchMedia, which Astryx's useMediaQuery
// hook requires when a loading state (e.g. the Button spinner) mounts.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom does not implement the async clipboard; the share section's copy
// affordance reads it. A real browser provides writeText.
Object.defineProperty(window.navigator, 'clipboard', {
  writable: true,
  configurable: true,
  value: { writeText: () => Promise.resolve() },
});
