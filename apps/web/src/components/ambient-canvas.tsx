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

export type AmbientVariant =
  | 'clouds'
  | 'pieces'
  | 'sparkle'
  | 'waves'
  | 'orbit'
  | 'grid'
  | 'confetti'
  | 'rays'
  | 'bubbles'
  | 'pulse'
  | 'drops';

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

export interface AmbientPointer {
  /** normalized pointer position, 0..1 across the canvas */
  x: number;
  y: number;
  /** true while the pointer is over the canvas */
  active: boolean;
}

type DrawFn = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  pointer: AmbientPointer,
) => void;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Soft translucent blobs drifting sideways - the auth and default backdrop. */
function drawClouds(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  pointer: AmbientPointer,
) {
  const blobs = [
    { x: 0.12, y: 0.18, r: 0.32, color: PALETTE.terracotta, speed: 0.012, alpha: 0.26 },
    { x: 0.7, y: 0.28, r: 0.26, color: PALETTE.teal, speed: 0.009, alpha: 0.22 },
    { x: 0.42, y: 0.72, r: 0.34, color: PALETTE.gold, speed: 0.015, alpha: 0.24 },
    { x: 0.85, y: 0.82, r: 0.22, color: PALETTE.periwinkle, speed: 0.011, alpha: 0.2 },
  ];
  const drift = pointer.active ? (pointer.x - 0.5) * 0.1 : 0;
  for (const b of blobs) {
    const cx = ((b.x + t * b.speed + drift) % 1.3) * w;
    const cy = b.y * h + (pointer.active ? (pointer.y - 0.5) * h * 0.04 : 0);
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

/** Chess-piece glyphs drifting upward, faint and slow so they read as a wash
 * rather than bleeding ink - report. */
function drawPieces(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const glyphs = ['♟', '♞', '♝', '♜', '♛', '♚'];
  const colors = [PALETTE.terracotta, PALETTE.teal, PALETTE.gold, PALETTE.periwinkle];
  const count = 10;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < count; i++) {
    const seed = i * 1.618;
    const x = (((seed * 137.5) % 100) / 100) * w;
    const speed = 8 + (i % 4) * 3;
    const span = h + 60;
    const y = (((seed * 97) % 100) / 100) * span - ((t * speed) % span);
    const size = 12 + (i % 3) * 4;
    const alpha = 0.1 + ((i * 37) % 6) / 100;
    ctx.font = `${size}px serif`;
    ctx.fillStyle = hexToRgba(colors[i % colors.length] ?? PALETTE.terracotta, alpha);
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
    ctx.fillStyle = hexToRgba(i % 2 === 0 ? PALETTE.gold : PALETTE.terracotta, alpha * 0.75);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Gentle horizontal waves drifting - games. A pointer ripple bends the waves
 * toward the cursor so the field reacts without dominating the page. */
function drawWaves(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  pointer: AmbientPointer,
) {
  const waves = [
    { y: 0.3, amp: 0.05, freq: 0.02, speed: 0.4, color: PALETTE.teal, alpha: 0.24 },
    { y: 0.55, amp: 0.07, freq: 0.014, speed: 0.28, color: PALETTE.terracotta, alpha: 0.2 },
    { y: 0.8, amp: 0.04, freq: 0.026, speed: 0.5, color: PALETTE.gold, alpha: 0.26 },
  ];
  const px = pointer.active ? pointer.x * w : -999;
  const py = pointer.active ? pointer.y * h : -999;
  for (const wave of waves) {
    ctx.strokeStyle = hexToRgba(wave.color, wave.alpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      let y = wave.y * h + Math.sin(x * wave.freq + t * wave.speed) * wave.amp * h;
      // ripple: a gentle bulge in the wave near the pointer, decaying with distance
      const dx = x - px;
      const dy = y - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      const ripple = Math.exp(-d / (w * 0.22)) * Math.sin(t * 3 + d * 0.02);
      y += ripple * wave.amp * h * 2.2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Dots orbiting a centre point - upgrade. */
function drawOrbit(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  pointer: AmbientPointer,
) {
  const cx = w * 0.5 + (pointer.active ? (pointer.x - 0.5) * w * 0.08 : 0);
  const cy = h * 0.4 + (pointer.active ? (pointer.y - 0.5) * h * 0.06 : 0);
  const rings = [
    { radius: Math.min(w, h) * 0.28, speed: 0.5, count: 5, color: PALETTE.gold, alpha: 0.75 },
    { radius: Math.min(w, h) * 0.4, speed: -0.35, count: 7, color: PALETTE.teal, alpha: 0.6 },
    {
      radius: Math.min(w, h) * 0.52,
      speed: 0.28,
      count: 9,
      color: PALETTE.terracotta,
      alpha: 0.55,
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
  ctx.fillStyle = hexToRgba(PALETTE.ink, 0.14);
  for (let x = -spacing + offset; x < w + spacing; x += spacing) {
    for (let y = -spacing + offset; y < h + spacing; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Small coloured confetti rectangles falling and rotating - proof sheet. */
function drawConfetti(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const colors = [
    PALETTE.gold,
    PALETTE.teal,
    PALETTE.terracotta,
    PALETTE.periwinkle,
    PALETTE.green,
  ];
  const count = 24;
  for (let i = 0; i < count; i++) {
    const seed = i * 1.91;
    const x = (((seed * 137.5) % 100) / 100) * w;
    const speed = 30 + (i % 6) * 12;
    const span = h + 60;
    const y = (((seed * 53) % 100) / 100) * span - ((t * speed) % span);
    const size = 5 + (i % 4) * 3;
    const rot = t * (0.6 + (i % 4) * 0.4) + seed;
    const alpha = 0.34 + ((i * 29) % 10) / 100;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = hexToRgba(colors[i % colors.length] ?? PALETTE.gold, alpha);
    ctx.fillRect(-size / 2, -size / 2, size, size * 0.6);
    ctx.restore();
  }
}

/** Rotating radial light rays - tournaments. */
function drawRays(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w * 0.5;
  const cy = h * 0.45;
  const rays = 12;
  const len = Math.max(w, h) * 0.6;
  const rot = t * 0.08;
  for (let i = 0; i < rays; i++) {
    const angle = (i / rays) * Math.PI * 2 + rot;
    const alpha = 0.16 + ((i % 3) / 3) * 0.12;
    ctx.strokeStyle = hexToRgba(i % 2 === 0 ? PALETTE.gold : PALETTE.terracotta, alpha);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 40, cy + Math.sin(angle) * 40);
    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.stroke();
  }
}

/** Translucent bubbles rising - tournament detail. */
function drawBubbles(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const count = 16;
  for (let i = 0; i < count; i++) {
    const seed = i * 2.13;
    const x = (((seed * 137.5) % 100) / 100) * w;
    const speed = 12 + (i % 5) * 6;
    const span = h + 60;
    const y = h - (((seed * 61) % 100) / 100) * span + ((t * speed) % span);
    const r = 4 + (i % 5) * 4;
    const alpha = 0.2 + ((i * 31) % 8) / 100;
    ctx.strokeStyle = hexToRgba(PALETTE.cyan, alpha);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Soft pulsing radial glows - game review. */
function drawPulse(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const centers = [
    { x: 0.25, y: 0.3, color: PALETTE.teal },
    { x: 0.75, y: 0.6, color: PALETTE.terracotta },
    { x: 0.5, y: 0.85, color: PALETTE.gold },
  ];
  for (const c of centers) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.2 + c.x * 9);
    const r = (0.12 + pulse * 0.1) * Math.min(w, h);
    const alpha = 0.16 + pulse * 0.14;
    const g = ctx.createRadialGradient(c.x * w, c.y * h, 0, c.x * w, c.y * h, r);
    g.addColorStop(0, hexToRgba(c.color, alpha));
    g.addColorStop(1, hexToRgba(c.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x * w, c.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Falling ink drops - player edit. */
function drawDrops(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const count = 14;
  for (let i = 0; i < count; i++) {
    const seed = i * 1.37;
    const x = (((seed * 137.5) % 100) / 100) * w;
    const speed = 20 + (i % 5) * 8;
    const span = h + 40;
    const y = (((seed * 71) % 100) / 100) * span - ((t * speed) % span);
    const r = 2 + (i % 4) * 2;
    const alpha = 0.2 + ((i * 23) % 8) / 100;
    ctx.fillStyle = hexToRgba(PALETTE.ink, alpha);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

const DRAWERS: Record<AmbientVariant, DrawFn> = {
  clouds: drawClouds,
  pieces: drawPieces,
  sparkle: drawSparkle,
  waves: drawWaves,
  orbit: drawOrbit,
  grid: drawGrid,
  confetti: drawConfetti,
  rays: drawRays,
  bubbles: drawBubbles,
  pulse: drawPulse,
  drops: drawDrops,
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

    // pointer state, shared by every motif so the field reacts to the cursor
    const pointer: AmbientPointer = { x: 0.5, y: 0.5, active: false };
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = (event.clientX - rect.left) / Math.max(1, rect.width);
      pointer.y = (event.clientY - rect.top) / Math.max(1, rect.height);
    };
    const onPointerEnter = () => {
      pointer.active = true;
    };
    const onPointerLeave = () => {
      pointer.active = false;
    };
    canvas.addEventListener('pointermove', onPointer, { passive: true });
    canvas.addEventListener('pointerenter', onPointerEnter, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });

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
    function loop(now: number) {
      DRAWERS[variantRef.current](context, width, height, now / 1000, pointer);
      raf = requestAnimationFrame(loop);
    }

    if (reduced) {
      // One static frame, then nothing.
      context.clearRect(0, 0, width, height);
      DRAWERS[variantRef.current](context, width, height, 0, pointer);
      canvas.dataset.reducedMotion = 'true';
    } else {
      raf = requestAnimationFrame(loop);
    }

    window.addEventListener('resize', resize);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerenter', onPointerEnter);
      canvas.removeEventListener('pointerleave', onPointerLeave);
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
