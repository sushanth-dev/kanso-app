'use client';

import { useEffect, useRef } from 'react';

export interface ThreeUiRenderer {
  resize(width: number, height: number): void;
  render(time: number): void;
  dispose(): void;
}

export type CreateThreeUiRenderer = (canvas: HTMLCanvasElement) => ThreeUiRenderer;

interface ThreeUiBackgroundProps {
  createRenderer: CreateThreeUiRenderer;
  className?: string;
}

/**
 * Shared mount for a vendored ThreeUI WebGL background. Mirrors the
 * AmbientCanvas guarantees: `prefers-reduced-motion` renders one static frame
 * and marks the canvas, the loop pauses offscreen and when the tab is hidden,
 * and a missing WebGL context renders nothing rather than crashing the
 * surface. The effect is `aria-hidden`, carries no information, and never
 * gates an interaction.
 */
export function ThreeUiBackground({ createRenderer, className }: ThreeUiBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: ThreeUiRenderer;
    try {
      renderer = createRenderer(canvas);
    } catch {
      // No WebGL context (jsdom, or WebGL disabled): the effect is decorative,
      // so render nothing rather than crash the surface.
      return;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let visible = true;

    const onResize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      renderer.resize(width, height);
      renderer.render(performance.now());
    };
    onResize();

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
        if (!visible && raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        } else if (visible && !raf && !reduced) {
          raf = requestAnimationFrame(loop);
        }
      },
      { threshold: 0 },
    );
    observer.observe(canvas);

    const onVisibility = () => {
      if (document.hidden && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!document.hidden && visible && !raf && !reduced) {
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);

    function loop(now: number) {
      renderer.render(now);
      raf = requestAnimationFrame(loop);
    }

    if (reduced) {
      canvas.dataset.reducedMotion = 'true';
      renderer.render(performance.now()); // one static frame, then nothing
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, [createRenderer]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
