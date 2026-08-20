'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Board theme colours from DESIGN.md, shared with board.tsx. The pawn recedes
// behind the hero so the sample diagnosis card stays the brightest object on
// the landing page.
const WOOD_DARK = '#8f5e38';
const WOOD_LIGHT = '#ead9b7';

function buildPawn(): THREE.Group {
  const dark = new THREE.MeshStandardMaterial({
    color: WOOD_DARK,
    roughness: 0.6,
    metalness: 0.05,
  });
  const light = new THREE.MeshStandardMaterial({
    color: WOOD_LIGHT,
    roughness: 0.5,
    metalness: 0.05,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.82, 0.35, 48), dark);
  base.position.y = 0.175;

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.9, 32), dark);
  stem.position.y = 0.8;

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.14, 48), light);
  collar.position.y = 1.32;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 48, 32), light);
  head.position.y = 1.72;

  const pawn = new THREE.Group();
  pawn.add(base, stem, collar, head);
  return pawn;
}

/**
 * A decorative, scroll-driven 3D pawn behind the landing hero.
 *
 * One scene, one pawn built from primitives, muted wood tones. The render loop
 * reads a scroll-progress ref and never touches React state per frame. Under
 * `prefers-reduced-motion: reduce` the loop never starts; one static frame
 * renders and stays, and the canvas carries a `data-reduced-motion` marker the
 * e2e asserts.
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

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.9, 6);
    camera.lookAt(0, 0.9, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 5, 4);
    scene.add(key);

    const pawn = buildPawn();
    scene.add(pawn);

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
    };
    onResize();
    window.addEventListener('resize', onResize);

    let frame = 0;
    const render = () => {
      // Slow idle spin plus a half turn over the page, tilting upright at the
      // bottom: the piece reads as the visitor scrolls but never plays on its
      // own enough to be the point.
      pawn.rotation.y = frame * 0.003 + scrollProgress * Math.PI;
      pawn.rotation.x = (1 - scrollProgress) * 0.45;
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
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          material.dispose();
        }
      });
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-60"
    />
  );
}
