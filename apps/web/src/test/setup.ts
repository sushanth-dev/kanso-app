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

Object.defineProperty(window.navigator, 'clipboard', {
  writable: true,
  configurable: true,
  value: { writeText: () => Promise.resolve() },
});

// jsdom does not implement the native <dialog> modal API, which Astryx's
// AlertDialog/Dialog rely on. Polyfill the two methods the components call so
// the delete confirmations can be exercised in unit tests.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};

// The test runtime (Node 22+) implements Promise.withResolvers, but the
// project's tsconfig lib predates it. Route tests use it for deferred
// query resolution; declare the ambient type so typecheck matches reality.
declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (reason?: unknown) => void;
    };
  }
}
