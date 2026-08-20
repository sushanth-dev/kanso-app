'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createParticleReveal,
  type ParticleRevealInstance,
  type ParticleRevealOptions,
} from './ParticleRevealVanilla';

export interface ParticleRevealProps extends ParticleRevealOptions {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Reveals the child text as dust that converges around the cursor. The text is
 * rasterized to a 2D canvas with `fillText` and fed to the WebGL particle
 * shader, which works in every browser - no experimental `html-in-canvas` API.
 *
 * The child is rendered in-flow but invisible so it still sizes the surface and
 * stays measurable; the canvas overlays it and is the only thing the reader
 * sees. Under `prefers-reduced-motion: reduce` the engine renders the text
 * crisp instead of animating.
 */
export function ParticleReveal({ children, className, style, ...options }: ParticleRevealProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<ParticleRevealInstance | null>(null);
  const [initialOptions] = useState(options);

  useEffect(() => {
    const content = contentRef.current;
    const output = outputRef.current;
    if (!content || !output) return;
    instanceRef.current = createParticleReveal({ content, output }, initialOptions);
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [initialOptions]);

  useEffect(() => {
    instanceRef.current?.setOptions(options);
  });

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <div
        ref={contentRef}
        aria-hidden
        style={{ visibility: 'hidden', width: 'max-content', whiteSpace: 'nowrap' }}
      >
        {children}
      </div>
      <canvas
        ref={outputRef}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

export type { ParticleRevealInstance, ParticleRevealOptions };

export default ParticleReveal;
