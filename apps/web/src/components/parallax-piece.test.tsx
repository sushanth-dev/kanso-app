/**
 * ParallaxPiece is a decorative three.js scene; the WebGL work is not
 * unit-testable in jsdom (and the effect deliberately bails without a WebGL
 * context). These tests cover the prop-driven surface: a single decorative,
 * non-interactive canvas, and a clean unmount.
 */
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ParallaxPiece } from './parallax-piece.tsx';

describe('ParallaxPiece', () => {
  test('renders a single decorative canvas behind the page', () => {
    const { container } = render(<ParallaxPiece />);
    const canvases = container.querySelectorAll('canvas');
    expect(canvases).toHaveLength(1);
    const canvas = canvases[0]!;
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas.className).toContain('pointer-events-none');
    expect(canvas.className).toContain('fixed');
  });

  test('unmounts cleanly when no WebGL context is available', () => {
    const { unmount } = render(<ParallaxPiece />);
    expect(() => unmount()).not.toThrow();
  });
});
