'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createClouds, type CloudsInstance, type CloudsOptions } from './CloudsVanilla';

export interface CloudsProps extends CloudsOptions {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Drifts procedural clouds over the child content in a transparent WebGL
 * overlay. The content stays live in the DOM (interactive and styled) and the
 * clouds render on top, so no experimental `html-in-canvas` API is needed.
 */
export function Clouds({ children, className, style, ...options }: CloudsProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<CloudsInstance | null>(null);
  const [initialOptions] = useState(options);

  useEffect(() => {
    const content = contentRef.current;
    const output = outputRef.current;
    if (!content || !output) return;
    instanceRef.current = createClouds({ content, output }, initialOptions);
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
      <div ref={contentRef} style={{ position: 'absolute', inset: 0 }}>
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

export type { CloudsInstance, CloudsOptions };

export default Clouds;
