'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Board theme colours from DESIGN.md, shared with board.tsx, plus the study-room
// gold so the glass reads against the warm page.
const WOOD_DARK = '#8f5e38';
const WOOD_LIGHT = '#ead9b7';
const GOLD = '#e9b44c';

/** One frosted-glass material per tone, shared across the pawn's parts. */
function glassMaterial(color: string, opacity: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.2,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.25,
  });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, y: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  return m;
}

function buildPawn(dark: THREE.Material, light: THREE.Material, gold: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(
    mesh(new THREE.CylinderGeometry(0.7, 0.82, 0.35, 48), dark, 0.175),
    mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.9, 32), dark, 0.8),
    mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.14, 48), light, 1.32),
    mesh(new THREE.SphereGeometry(0.36, 48, 32), light, 1.72),
    mesh(new THREE.SphereGeometry(0.1, 24, 16), gold, 2.02),
  );
  return g;
}

/**
 * One big frosted-glass pawn behind the whole landing page. The bottom sections
 * sit on light glass, so the pawn stays in view as the visitor scrolls rather
 * than disappearing after the hero.
 *
 * Depth parallax: the pawn drifts gently and turns as the visitor scrolls. The
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
    camera.position.set(0, 0, 7);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xfff2df, 1.8);
    key.position.set(4, 6, 5);
    scene.add(key);
    // A warm rim from behind gives the glass its edge without darkening it.
    const rim = new THREE.DirectionalLight(0xffd9b8, 1.1);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const dark = glassMaterial(WOOD_DARK, 0.55);
    const light = glassMaterial(WOOD_LIGHT, 0.5);
    const gold = glassMaterial(GOLD, 0.62);
    const materials = [dark, light, gold];

    const pawn = buildPawn(dark, light, gold);
    scene.add(pawn);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let scrollProgress = 0;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // Scale the pawn to a large but not overwhelming fraction of the viewport,
    // and centre it. The pawn group's origin is its base, so it is lowered by
    // half its height to sit mid-screen.
    let scale = 1.6;
    const onResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);

      const halfH = Math.tan((45 * Math.PI) / 180 / 2) * camera.position.z;
      scale = halfH * 0.55;
    };
    onResize();
    window.addEventListener('resize', onResize);

    let frame = 0;
    const render = () => {
      const float = Math.sin(frame * 0.0008) * 0.08;
      pawn.position.x = scrollProgress * 0.4;
      pawn.position.y = -scale + scrollProgress * 0.5 + float;
      pawn.rotation.y = frame * 0.002 + scrollProgress * 0.5;
      pawn.scale.setScalar(scale);
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
      pawn.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const mesh = object as THREE.Mesh;
        mesh.geometry.dispose();
      });
      for (const material of materials) {
        material.dispose();
      }
      renderer.dispose();
    };
  }, []);

  return (
    <>
      {/* The warm aurora the glass sits over. Behind the pawn, above the page. */}
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
