'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Board theme colour, tinting the glass instead of the prototype's white.
const WOOD_DARK = '#8f5e38';

/** Premium clear-glass material, matching the prototype's transmission setup. */
function glassMaterial(color: string): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.1,
    ior: 1.5,
    envMapIntensity: 1.4,
    transparent: true,
    opacity: 0.6,
  });

  // Flat uniform opacity makes curved surfaces (the head) read as a flat
  // translucent disc instead of a sphere. A Fresnel term makes silhouette
  // edges more opaque than the face-on centre, so the curvature actually
  // reads through the glass.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      float fresnel = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.4);
      diffuseColor.a = mix(0.22, 0.92, fresnel);
      #include <opaque_fragment>
      `,
    );
  };

  return material;
}

/** Profile (radius, y) for the pawn silhouette: base, body, head, as one
 * continuous line so the lathe produces a single seamless mesh instead of
 * three abutting parts. The head follows the actual sphere arc rather than
 * a spline guess, so the dome rounds off instead of overshooting into a
 * point. */
function pawnProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];

  // Base: flat foot, straight wall, flat collar top.
  points.push(new THREE.Vector2(0, -0.25));
  points.push(new THREE.Vector2(1, -0.25));
  points.push(new THREE.Vector2(1, 0.25));

  // Body: straight taper from the collar up to the neck below the head.
  const neckRadius = 0.42;
  const headCenterY = 2.5;
  const headRadius = 0.6;
  const neckY = headCenterY - Math.sqrt(headRadius ** 2 - neckRadius ** 2);
  points.push(new THREE.Vector2(0.8, 0.25));
  points.push(new THREE.Vector2(neckRadius, neckY));

  // Head: the visible upper cap of the sphere, from the neck join over the top.
  const angleStart = Math.asin((neckY - headCenterY) / headRadius);
  const headSegments = 20;
  for (let i = 1; i <= headSegments; i++) {
    const angle = THREE.MathUtils.lerp(angleStart, Math.PI / 2, i / headSegments);
    points.push(
      new THREE.Vector2(headRadius * Math.cos(angle), headCenterY + headRadius * Math.sin(angle)),
    );
  }

  return points;
}

/** The pawn as a single lathed mesh: no seams between base, body and head. */
function buildPawn(material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.LatheGeometry(pawnProfile(), 48), material);
}

/**
 * One big premium glass pawn behind the landing, matching the prototype's
 * transmission look and four-phase scroll animation (hero, about, features,
 * footer), tinted with the board's wood colours instead of white.
 *
 * A PMREM-baked room environment feeds the transmission and reflection, so the
 * glass refracts something instead of reading as a flat translucent blob. The
 * render loop reads a scroll-progress ref and never touches React state per
 * frame. Under `prefers-reduced-motion: reduce` one static hero frame renders
 * and the canvas carries `data-reduced-motion` for the e2e.
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
      // No WebGL context (jsdom, or WebGL disabled): the pawn is decorative,
      // so render nothing rather than crash the surface.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0.2, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xfff2df, 1.6);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd9b8, 0.9);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const material = glassMaterial(WOOD_DARK);
    const materials = [material];

    const pawn = buildPawn(material);
    pawn.position.set(0, -1, 0);
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

    const render = (delta: number) => {
      const t = scrollProgress;
      let targetScale: number;
      let targetRotX: number;
      let rotYSpeed: number;

      if (t < 0.25) {
        // Hero - centred, normal scale.
        targetScale = 1.0;
        targetRotX = 0;
        rotYSpeed = 0.5;
      } else if (t < 0.5) {
        // About - tilt forward imposingly, scale up.
        const p = (t - 0.25) / 0.25;
        targetScale = THREE.MathUtils.lerp(1.0, 1.45, p);
        targetRotX = THREE.MathUtils.lerp(0, Math.PI / 3, p);
        rotYSpeed = 0.3;
      } else if (t < 0.75) {
        // Features - tilt back, rapid spin, scale down sleek.
        const p = (t - 0.5) / 0.25;
        targetScale = THREE.MathUtils.lerp(1.45, 0.85, p);
        targetRotX = THREE.MathUtils.lerp(Math.PI / 3, -Math.PI / 4, p);
        rotYSpeed = 1.6;
      } else {
        // Footer - return upright, massive scale fills the background.
        const p = (t - 0.75) / 0.25;
        targetScale = THREE.MathUtils.lerp(0.85, 2.2, p);
        targetRotX = THREE.MathUtils.lerp(-Math.PI / 4, 0, p);
        rotYSpeed = 0.4;
      }

      const s = THREE.MathUtils.lerp(pawn.scale.x, targetScale, 0.05);
      pawn.scale.set(s, s, s);
      pawn.rotation.x = THREE.MathUtils.lerp(pawn.rotation.x, targetRotX, 0.05);
      pawn.rotation.y += delta * rotYSpeed;
      pawn.position.x = THREE.MathUtils.lerp(pawn.position.x, 0, 0.08);
      pawn.position.y = THREE.MathUtils.lerp(pawn.position.y, -1, 0.08);

      renderer.render(scene, camera);
    };

    let raf = 0;
    if (reduced) {
      canvas.dataset.reducedMotion = 'true';
      render(0); // one static hero frame, then nothing
    } else {
      let lastTime = performance.now();
      const loop = (now: number) => {
        const delta = Math.min((now - lastTime) / 1000, 1 / 30);
        lastTime = now;
        render(delta);
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
      scene.environment?.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1]"
    />
  );
}
