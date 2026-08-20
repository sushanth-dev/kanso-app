'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Board theme colours from DESIGN.md, shared with board.tsx, plus the study-room
// accent and gold so the glass reads against the warm page.
const WOOD_DARK = '#8f5e38';
const WOOD_LIGHT = '#ead9b7';
const ACCENT = '#a03f22';
const GOLD = '#e9b44c';

/** One frosted-glass material per tone, shared across every piece. */
function glassMaterial(color: string, opacity: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.25,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.3,
  });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, y: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  return m;
}

function buildPawn(dark: THREE.Material, light: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(
    mesh(new THREE.CylinderGeometry(0.7, 0.82, 0.35, 48), dark, 0.175),
    mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.9, 32), dark, 0.8),
    mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.14, 48), light, 1.32),
    mesh(new THREE.SphereGeometry(0.36, 48, 32), light, 1.72),
  );
  return g;
}

function buildRook(dark: THREE.Material, light: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(
    mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.4, 48), dark, 0.2),
    mesh(new THREE.CylinderGeometry(0.55, 0.65, 1.1, 32), dark, 0.95),
    mesh(new THREE.CylinderGeometry(0.72, 0.6, 0.28, 48), light, 1.6),
  );
  // Four merlons on the top rim.
  const merlon = new THREE.BoxGeometry(0.22, 0.24, 0.22);
  for (const [x, z] of [
    [0.26, 0.26],
    [0.26, -0.26],
    [-0.26, 0.26],
    [-0.26, -0.26],
  ] as const) {
    const m = new THREE.Mesh(merlon, light);
    m.position.set(x, 1.86, z);
    g.add(m);
  }
  return g;
}

function buildBishop(
  dark: THREE.Material,
  light: THREE.Material,
  accent: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  g.add(
    mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.35, 48), dark, 0.175),
    mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.7, 32), dark, 0.7),
    mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.12, 48), light, 1.1),
    mesh(new THREE.ConeGeometry(0.3, 0.75, 48), light, 1.5),
    mesh(new THREE.SphereGeometry(0.13, 24, 16), accent, 1.98),
  );
  return g;
}

function buildQueen(
  dark: THREE.Material,
  light: THREE.Material,
  accent: THREE.Material,
  gold: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  g.add(
    mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.4, 48), dark, 0.2),
    mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.85, 32), dark, 0.82),
    mesh(new THREE.CylinderGeometry(0.45, 0.32, 0.14, 48), light, 1.3),
    mesh(new THREE.ConeGeometry(0.32, 0.5, 48), light, 1.62),
    mesh(new THREE.SphereGeometry(0.18, 24, 16), gold, 2.0),
  );
  // A small crown of accent beads around the coronet.
  const bead = new THREE.SphereGeometry(0.07, 16, 12);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const m = new THREE.Mesh(bead, accent);
    m.position.set(Math.cos(angle) * 0.34, 1.56, Math.sin(angle) * 0.34);
    g.add(m);
  }
  return g;
}

interface PieceSpec {
  build: (...materials: THREE.Material[]) => THREE.Group;
  /** Normalized viewport position, -1..1, measured at the average piece depth. */
  nx: number;
  ny: number;
  /** World depth; nearer pieces are larger and drift more on scroll. */
  z: number;
  scale: number;
  /** Parallax strength: 1 is nearest, smaller is farther. */
  drift: number;
  phase: number;
}

const PIECES: PieceSpec[] = [
  { build: buildQueen, nx: 0.34, ny: 0.42, z: 0, scale: 0.92, drift: 1, phase: 0 },
  { build: buildRook, nx: -0.62, ny: 0.2, z: -1.5, scale: 0.82, drift: 0.7, phase: 1.6 },
  { build: buildBishop, nx: 0.58, ny: -0.3, z: -2.5, scale: 0.8, drift: 0.55, phase: 3.1 },
  { build: buildPawn, nx: -0.36, ny: -0.62, z: -4, scale: 0.9, drift: 0.34, phase: 4.5 },
  { build: buildPawn, nx: 0.3, ny: -0.72, z: -5, scale: 0.9, drift: 0.24, phase: 5.7 },
];

/**
 * A decorative, scroll-driven constellation of frosted-glass chess pieces
 * behind the whole landing page. The bottom sections sit on glass, so the
 * pieces stay in view as the visitor scrolls rather than disappearing after
 * the hero.
 *
 * Depth parallax: nearer pieces drift further on scroll than farther ones. The
 * render loop reads a scroll-progress ref and never touches React state per
 * frame. Under `prefers-reduced-motion: reduce` the loop never starts; one
 * static frame renders and stays, and the canvas carries a
 * `data-reduced-motion` marker the e2e asserts.
 */
export function ParallaxPiece() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      // No WebGL context (jsdom, or a browser with WebGL disabled): the piece is
      // decorative, so render nothing rather than crash the surface.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.9, 6);
    camera.lookAt(0, 0.9, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const key = new THREE.DirectionalLight(0xfff2df, 1.6);
    key.position.set(4, 6, 5);
    scene.add(key);
    // A warm rim from behind gives the glass its edge without darkening it.
    const rim = new THREE.DirectionalLight(0xffd9b8, 0.9);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const dark = glassMaterial(WOOD_DARK, 0.5);
    const light = glassMaterial(WOOD_LIGHT, 0.42);
    const accent = glassMaterial(ACCENT, 0.55);
    const gold = glassMaterial(GOLD, 0.6);
    const materials = [dark, light, accent, gold];

    const pieces: { group: THREE.Group; spec: PieceSpec; base: { x: number; y: number } }[] = [];
    for (const spec of PIECES) {
      const group = spec.build(dark, light, accent, gold);
      group.scale.setScalar(spec.scale);
      group.position.z = spec.z;
      group.userData.phase = spec.phase;
      group.userData.drift = spec.drift;
      scene.add(group);
      pieces.push({ group, spec, base: { x: 0, y: 0 } });
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let scrollProgress = 0;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const onResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);

      // Recompute the visible half-extents at the eye plane and place each
      // piece at its normalized position, so the constellation fills the
      // viewport at every aspect ratio rather than drifting off-screen.
      const halfH = Math.tan((45 * Math.PI) / 180 / 2) * camera.position.z;
      const halfW = halfH * camera.aspect;
      for (const piece of pieces) {
        piece.base.x = piece.spec.nx * halfW * 0.82;
        piece.base.y = piece.spec.ny * halfH * 0.66 + 0.9;
      }
    };
    onResize();
    window.addEventListener('resize', onResize);

    let frame = 0;
    const render = () => {
      for (const piece of pieces) {
        const { group, spec, base } = piece;
        const float = Math.sin(frame * 0.0008 + spec.phase) * 0.06 * spec.drift;
        group.position.x = base.x + scrollProgress * spec.drift * (spec.nx >= 0 ? -1.1 : 1.1);
        group.position.y = base.y + scrollProgress * spec.drift * 2.4 + float;
        group.rotation.y = frame * 0.002 + scrollProgress * Math.PI * spec.drift * 0.4;
      }
      renderer.render(scene, camera);
      frame += 1;
    };

    let raf = 0;
    if (reduced) {
      canvas.dataset.reducedMotion = 'true';
      render(); // one static frame, then nothing
    } else {
      const loop = () => {
        render();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      for (const piece of pieces) {
        piece.group.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const mesh = object as THREE.Mesh;
          mesh.geometry.dispose();
        });
      }
      for (const material of materials) {
        material.dispose();
      }
      renderer.dispose();
    };
  }, []);

  return (
    <>
      {/* The warm aurora the glass sits over. Behind the pieces, above the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: [
            'radial-gradient(55% 45% at 18% 12%, rgba(233,180,76,0.22), transparent 60%)',
            'radial-gradient(50% 45% at 82% 22%, rgba(160,63,34,0.16), transparent 62%)',
            'radial-gradient(65% 55% at 50% 92%, rgba(234,217,183,0.38), transparent 65%)',
          ].join(', '),
        }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[1]"
      />
    </>
  );
}
