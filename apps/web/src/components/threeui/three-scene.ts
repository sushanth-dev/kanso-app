'use client';

import * as THREE from 'three';
import type { ThreeUiRenderer } from './threeui-background.tsx';

/**
 * Shared 3D particle-field background. One perspective camera flies a field
 * of colored points plus a few soft floating meshes through depth, giving the
 * effect real perspective (near points are larger and move faster than far
 * ones) instead of a flat full-screen shader. It is interactive: the pointer
 * repels particles within a radius and pulls the camera into a subtle
 * parallax, so the field visibly responds to the cursor.
 *
 * Each surface picks a motif via `ThreeSceneConfig` (colors, particle count,
 * motion, interaction strength). Rendered through the shared ThreeUiBackground
 * mount (reduced-motion, offscreen pause, DPR cap, WebGL fallback, aria-hidden).
 */

export interface ThreeSceneConfig {
  /** scene background color (cream paper) */
  bg: number;
  /** particle colors in the Study Room palette */
  palette: string[];
  particleCount: number;
  /** half-extents of the particle box: [x, y, z] */
  spread: [number, number, number];
  /** base drift speed, in scene units per second */
  speed: number;
  /** 'drift' | 'orbit' | 'wave' */
  motion: 'drift' | 'orbit' | 'wave';
  /** how strongly the pointer repels nearby particles (0 = off) */
  interactStrength: number;
  /** radius of pointer influence, in scene units */
  interactRadius: number;
  /** camera parallax toward the pointer, 0..1 */
  parallax: number;
  /** number of soft floating meshes for extra depth cues */
  floaters: number;
}

interface Particle {
  base: THREE.Vector3;
  velocity: THREE.Vector3;
  phase: number;
}

const FLOAT_COLORS = ['#a03f22', '#0f5e66', '#e8a33d', '#8f5e38'];

function makeParticles(cfg: ThreeSceneConfig): {
  points: THREE.Points;
  particles: Particle[];
  update: (dt: number, pointer: THREE.Vector3, t: number) => void;
} {
  const positions = new Float32Array(cfg.particleCount * 3);
  const colors = new Float32Array(cfg.particleCount * 3);
  const palette = cfg.palette.map((hex) => new THREE.Color(hex));
  const particles: Particle[] = [];

  for (let i = 0; i < cfg.particleCount; i += 1) {
    const x = (Math.random() * 2 - 1) * cfg.spread[0];
    const y = (Math.random() * 2 - 1) * cfg.spread[1];
    const z = (Math.random() * 2 - 1) * cfg.spread[2];
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    const color = palette[Math.floor(Math.random() * palette.length)]!;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    particles.push({
      base: new THREE.Vector3(x, y, z),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * cfg.speed,
        (Math.random() - 0.5) * cfg.speed,
        (Math.random() - 0.5) * cfg.speed,
      ),
      phase: Math.random() * Math.PI * 2,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.3,
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    sizeAttenuation: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);

  const posAttr = geometry.attributes.position as THREE.BufferAttribute;
  const interactStrength = cfg.interactStrength;
  const interactRadius = cfg.interactRadius;
  const spread = cfg.spread;
  const speed = cfg.speed;
  const motion = cfg.motion;

  function update(dt: number, pointer: THREE.Vector3, t: number) {
    const arr = posAttr.array as Float32Array;
    const r2 = interactRadius * interactRadius;
    for (let i = 0; i < cfg.particleCount; i += 1) {
      const p = particles[i]!;
      const idx = i * 3;
      const px = arr[idx]!;
      const py = arr[idx + 1]!;
      const pz = arr[idx + 2]!;

      // base motion
      if (motion === 'orbit') {
        const a = t * speed * 0.3 + p.phase;
        p.base.x = Math.cos(a) * spread[0] * 0.9;
        p.base.z = Math.sin(a) * spread[2] * 0.9;
      } else if (motion === 'wave') {
        p.base.y = Math.sin(px * 0.02 + t * speed * 0.5 + p.phase) * spread[1];
      } else {
        p.base.x += p.velocity.x * dt;
        p.base.y += p.velocity.y * dt;
        p.base.z += p.velocity.z * dt;
        if (Math.abs(p.base.x) > spread[0]) p.velocity.x *= -1;
        if (Math.abs(p.base.y) > spread[1]) p.velocity.y *= -1;
        if (Math.abs(p.base.z) > spread[2]) p.velocity.z *= -1;
      }

      // pointer repulsion
      if (interactStrength > 0) {
        const dx = px - pointer.x;
        const dy = py - pointer.y;
        const dz = pz - pointer.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r2 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const force = (1 - d / interactRadius) * interactStrength * dt * 60;
          arr[idx] = px + (dx / d) * force;
          arr[idx + 1] = py + (dy / d) * force;
          arr[idx + 2] = pz + (dz / d) * force;
        } else {
          arr[idx] = px;
          arr[idx + 1] = py;
          arr[idx + 2] = pz;
        }
      } else {
        arr[idx] = px;
        arr[idx + 1] = py;
        arr[idx + 2] = pz;
      }
    }
    posAttr.needsUpdate = true;
  }

  return { points, particles, update };
}

function makeFloaters(cfg: ThreeSceneConfig): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const palette = FLOAT_COLORS.map((hex) => new THREE.Color(hex));

  for (let i = 0; i < cfg.floaters; i += 1) {
    const size = 20 + Math.random() * 60;
    const geometry =
      i % 3 === 0
        ? new THREE.TorusGeometry(size * 0.5, size * 0.06, 8, 24)
        : i % 3 === 1
          ? new THREE.IcosahedronGeometry(size * 0.6, 0)
          : new THREE.OctahedronGeometry(size * 0.5, 0);
    const material = new THREE.MeshBasicMaterial({
      color: palette[i % palette.length],
      transparent: true,
      opacity: 0.08,
      wireframe: i % 2 === 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      (Math.random() * 2 - 1) * cfg.spread[0] * 1.4,
      (Math.random() * 2 - 1) * cfg.spread[1] * 1.4,
      (Math.random() * 2 - 1) * cfg.spread[2] * 0.6,
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    group.add(mesh);
    meshes.push(mesh);
  }

  return {
    group,
    update(t: number) {
      meshes.forEach((mesh, i) => {
        mesh.rotation.x += 0.001 * (i % 2 === 0 ? 1 : -1);
        mesh.rotation.y += 0.0015;
        mesh.position.y += Math.sin(t * 0.4 + i) * 0.02;
      });
    },
  };
}

export function createThreeSceneRenderer(
  canvas: HTMLCanvasElement,
  cfg: ThreeSceneConfig,
): ThreeUiRenderer {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(cfg.bg);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  camera.position.z = cfg.spread[2] * 1.6;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const particles = makeParticles(cfg);
  const floaters = makeFloaters(cfg);
  scene.add(particles.points);
  scene.add(floaters.group);

  // pointer in scene space, normalized to the particle box
  const pointer = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(0, 0, 0);
  const onPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
    const ny = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
    target.set(nx * cfg.spread[0] * 2, -ny * cfg.spread[1] * 2, 0);
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  let last = performance.now();

  return {
    resize(width: number, height: number) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    },
    render(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now * 0.001;

      pointer.lerp(target, 0.08);
      particles.update(dt, pointer, t);
      floaters.update(t);

      // camera parallax toward the pointer
      const px = cfg.parallax * pointer.x * 0.06;
      const py = cfg.parallax * pointer.y * 0.06;
      camera.position.x += (px - camera.position.x) * 0.06;
      camera.position.y += (py - camera.position.y) * 0.06;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('pointermove', onPointer);
      particles.points.geometry.dispose();
      (particles.points.material as THREE.Material).dispose();
      floaters.group.children.forEach((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      renderer.dispose();
    },
  };
}
