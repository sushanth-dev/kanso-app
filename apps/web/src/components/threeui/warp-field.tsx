'use client';

import * as THREE from 'three';
import { ThreeUiBackground } from './threeui-background.tsx';

// Vendored ThreeUI WarpField (`streaks` variant), ported to the shared
// `three` and restyled to the Study Room palette. The upstream scene is a
// camera flying through a tunnel of additive light streaks plus billboarded
// tiles; we re-tint the streaks and tiles in warm wood/terracotta/gold so it
// reads as a warm drift instead of the upstream's cool cyan. Rendered through
// the shared ThreeUiBackground mount (reduced-motion, offscreen pause, DPR
// cap, WebGL fallback, aria-hidden).

const WARP_BG = 0xf7f2ea; // neutral-bg cream paper
const WARP_PALETTE = ['#a03f22', '#0f5e66', '#e8a33d', '#8f5e38']; // terracotta-600, teal-600, gold-400, wood-600

const STREAK_COUNT = 400;
const STREAK_TOP = 200;
const STREAK_BOTTOM = -1300;
const TILE_COUNT = 40;

function createStreaks(parent: THREE.Object3D, opacity: number) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(STREAK_COUNT * 6);
  const colors = new Float32Array(STREAK_COUNT * 6);
  const palette = WARP_PALETTE.map((hex) => new THREE.Color(hex));

  for (let i = 0; i < STREAK_COUNT; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 800 + 20;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = (Math.random() - 0.5) * 2000;
    const length = Math.random() * 150 + 50;
    positions[i * 6] = x;
    positions[i * 6 + 1] = y;
    positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x;
    positions[i * 6 + 4] = y;
    positions[i * 6 + 5] = z + length;
    const color = palette[Math.floor(Math.random() * palette.length)]!;
    colors[i * 6] = color.r;
    colors[i * 6 + 1] = color.g;
    colors[i * 6 + 2] = color.b;
    colors[i * 6 + 3] = color.r;
    colors[i * 6 + 4] = color.g;
    colors[i * 6 + 5] = color.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(geometry, material);
  parent.add(lines);

  const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
  return {
    update(delta: number) {
      for (let i = 0; i < STREAK_COUNT; i += 1) {
        const idx = i * 6;
        const z1 = positions[idx + 2]! + delta;
        const z2 = positions[idx + 5]! + delta;
        positions[idx + 2] = z1;
        positions[idx + 5] = z2;
        if (z1 > STREAK_TOP) {
          const len = z2 - z1;
          positions[idx + 2] = STREAK_BOTTOM;
          positions[idx + 5] = STREAK_BOTTOM + len;
        }
      }
      positionAttr.needsUpdate = true;
    },
    setOpacity(_streak: number, _tile: number) {
      // streaks keep a fixed opacity; present for a uniform effect shape
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createTiles(parent: THREE.Object3D, opacity: number) {
  const geometry = new THREE.PlaneGeometry(8, 20);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
  });
  const tiles: THREE.Mesh[] = [];
  let currentOpacity = opacity;

  for (let i = 0; i < TILE_COUNT; i += 1) {
    const tileMaterial = material.clone();
    const roll = Math.random();
    tileMaterial.color.setHex(roll > 0.6 ? 0xa03f22 : roll > 0.5 ? 0x8f5e38 : 0xe8a33d);
    const mesh = new THREE.Mesh(geometry, tileMaterial);
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 400 + 100;
    mesh.position.x = Math.cos(angle) * radius;
    mesh.position.y = Math.sin(angle) * radius;
    mesh.position.z = (Math.random() - 0.5) * 2000;
    mesh.lookAt(0, 0, mesh.position.z + 100);
    const scale = Math.random() * 1.5 + 0.5;
    mesh.scale.set(scale, scale, scale);
    parent.add(mesh);
    tiles.push(mesh);
  }

  return {
    update(delta: number) {
      tiles.forEach((mesh) => {
        mesh.position.z += delta;
        if (mesh.position.z > STREAK_TOP) mesh.position.z = STREAK_BOTTOM;
      });
    },
    setOpacity(_streak: number, tileOpacity: number) {
      if (currentOpacity !== tileOpacity) {
        tiles.forEach((mesh) => {
          (mesh.material as THREE.MeshBasicMaterial).opacity = tileOpacity;
        });
        currentOpacity = tileOpacity;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      tiles.forEach((mesh) => (mesh.material as THREE.Material).dispose());
    },
  };
}

export function createWarpFieldRenderer(canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(WARP_BG);
  scene.fog = new THREE.FogExp2(WARP_BG, 1e-3);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 2000);
  camera.position.z = 0;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const group = new THREE.Group();
  scene.add(group);

  const streakOpacity = 0.6;
  const tileOpacity = 0.9;
  const effects = [createStreaks(group, streakOpacity), createTiles(group, tileOpacity)];

  // pointer parallax: the camera drifts toward the cursor so the tunnel reads
  // as a 3D space that responds to the pointer
  const pointer = new THREE.Vector2(0.5, 0.5);
  const target = new THREE.Vector2(0.5, 0.5);
  const onPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    target.set(
      (event.clientX - rect.left) / Math.max(1, rect.width),
      (event.clientY - rect.top) / Math.max(1, rect.height),
    );
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  return {
    resize(width: number, height: number) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    },
    render() {
      const delta = (1 / 60) * 15;
      effects.forEach((effect) => {
        effect.setOpacity?.(streakOpacity, tileOpacity);
        effect.update?.(delta);
      });
      pointer.lerp(target, 0.08);
      camera.position.x += ((pointer.x - 0.5) * 60 - camera.position.x) * 0.06;
      camera.position.y += ((pointer.y - 0.5) * 40 - camera.position.y) * 0.06;
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('pointermove', onPointer);
      effects.forEach((effect) => effect.dispose());
      renderer.dispose();
    },
  };
}

export function WarpFieldBackground({ className }: { className?: string }) {
  return (
    <ThreeUiBackground
      className={className}
      createRenderer={(canvas) => createWarpFieldRenderer(canvas)}
    />
  );
}
