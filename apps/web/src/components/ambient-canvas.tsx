'use client';

import { useEffect, useRef } from 'react';

/**
 * Always-visible 2D canvas ambient, one motif per route, drawn straight to a
 * <canvas> so it renders in every browser without the experimental
 * html-in-canvas flag the vendored Clouds engine depends on.
 *
 * Each motif is a small, self-contained draw function over (ctx, w, h, t).
 * The loop honors prefers-reduced-motion (one static frame), pauses offscreen
 * via IntersectionObserver, and caps DPR so low-end devices stay cheap.
 */

export type AmbientVariant = 'clouds' | 'pieces' | 'sparkle' | 'waves' | 'orbit' | 'grid';

interface AmbientCanvasProps {
  variant: AmbientVariant;
  className?: string;
}

const PALETTE = {
  terracotta: '#a03f22',
  teal: '#0f5e66',
  gold: '#f0d96e',
  ink: '#584e42',
  periwinkle: '#7b9dff',
  cyan: '#3ecbd3',
  green: '#4c7a26',
};

type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Soft translucent blobs drifting sideways - the auth and default backdrop. */
function drawClouds(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const blobs = [
    { x: 0.12, y: 0.18, r: 0.32, color: PALETTE.terracotta, speed: 0.012, alpha: 0.16 },
    { x: 0.7, y: 0.28, r: 0.26, color: PALETTE.teal, speed: 0.009, alpha: 0.13 },
    { x: 0.42, y: 0.72, r: 0.34, color: PALETTE.gold, speed: 0.015, alpha: 0.15 },
    { x: 0.85, y: 0.82, r: 0.22, color: PALETTE.periwinkle, speed: 0.011, alpha: 0.12 },
  ];
  for (const b of blobs) {
    const cx = ((b.x + t * b.speed) % 1.3) * w;
    const cy = b.y * h;
    const r = b.r * Math.min(w, h);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, hexToRgba(b.color, b.alpha));
    g.addColorStop(1, hexToRgba(b.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Chess-piece glyphs drifting upward - report, proof sheet, transfer gap. */
function drawPieces(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const glyphs = ['♟', '♞', '♝', '♜', '♛', '♚'];
  const count = 14;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < count; i++) {
    const seed = i * 1.618;
    const x = (((seed * 137.5) % 100) / 100) * w;
    const speed = 14 + (i % 5) * 6;
    const span = h + 80;
    const y = (((seed * 97) % 100) / 100) * span - ((t * speed) % span);
    const size = 14 + (i % 4) * 6;
    const alpha = 0.1 + ((i * 37) % 10) / 100;
    ctx.font = `${size}px serif`;
    ctx.fillStyle = hexToRgba(PALETTE.ink, alpha);
    ctx.fillText(glyphs[i % glyphs.length] ?? '♟', x, y);
  }
}

/** Twinkling stars fading in and out - focus. */
function drawSparkle(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const count = 26;
  for (let i = 0; i < count; i++) {
    const seed = i * 2.399;
    const x = (((seed * 137.5) % 100) / 100) * w;
    const y = (((seed * 61) % 100) / 100) * h;
    const phase = (t * (0.6 + (i % 5) * 0.15) + seed * 7) % (Math.PI * 2);
    const alpha = 0.5 + 0.5 * Math.sin(phase);
    const r = 1.5 + (i % 3);
    ctx.fillStyle = hexToRgba(i % 2 === 0 ? PALETTE.gold : PALETTE.terracotta, alpha * 0.6);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Gentle horizontal waves drifting - games and tournaments. */
function drawWaves(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const waves = [
    { y: 0.3, amp: 0.05, freq: 0.02, speed: 0.4, color: PALETTE.teal, alpha: 0.14 },
    { y: 0.55, amp: 0.07, freq: 0.014, speed: 0.28, color: PALETTE.terracotta, alpha: 0.12 },
    { y: 0.8, amp: 0.04, freq: 0.026, speed: 0.5, color: PALETTE.gold, alpha: 0.16 },
  ];
  for (const wave of waves) {
    ctx.strokeStyle = hexToRgba(wave.color, wave.alpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = wave.y * h + Math.sin(x * wave.freq + t * wave.speed) * wave.amp * h;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Dots orbiting a centre point - upgrade. */
function drawOrbit(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w * 0.5;
  const cy = h * 0.4;
  const rings = [
    { radius: Math.min(w, h) * 0.28, speed: 0.5, count: 5, color: PALETTE.gold, alpha: 0.5 },
    { radius: Math.min(w, h) * 0.4, speed: -0.35, count: 7, color: PALETTE.teal, alpha: 0.4 },
    {
      radius: Math.min(w, h) * 0.52,
      speed: 0.28,
      count: 9,
      color: PALETTE.terracotta,
      alpha: 0.35,
    },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const angle = (i / ring.count) * Math.PI * 2 + t * ring.speed;
      const x = cx + Math.cos(angle) * ring.radius;
      const y = cy + Math.sin(angle) * ring.radius;
      ctx.fillStyle = hexToRgba(ring.color, ring.alpha);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** A faint drifting dot grid - settings. */
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const spacing = 46;
  const offset = (t * 8) % spacing;
  ctx.fillStyle = hexToRgba(PALETTE.ink, 0.08);
  for (let x = -spacing + offset; x < w + spacing; x += spacing) {
    for (let y = -spacing + offset; y < h + spacing; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const DRAWERS: Record<AmbientVariant, DrawFn> = {
  clouds: drawClouds,
  pieces: drawPieces,
  sparkle: drawSparkle,
  waves: drawWaves,
  orbit: drawOrbit,
  grid: drawGrid,
};

export function AmbientCanvas({ variant, className }: AmbientCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const variantRef = useRef(variant);
  variantRef.current = variant;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const context: CanvasRenderingContext2D = ctx;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let visible = true;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        visible = entry.isIntersecting;
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

    function loop(now: number) {
      context.clearRect(0, 0, width, height);
      DRAWERS[variantRef.current](context, width, height, now / 1000);
      raf = requestAnimationFrame(loop);
    }

    if (reduced) {
      // One static frame, then nothing.
      context.clearRect(0, 0, width, height);
      DRAWERS[variantRef.current](context, width, height, 0);
      canvas.dataset.reducedMotion = 'true';
    } else {
      raf = requestAnimationFrame(loop);
    }

    window.addEventListener('resize', resize);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className ?? 'pointer-events-none fixed inset-0 -z-10 h-full w-full'}
    />
  );
}

export default AmbientCanvas;
