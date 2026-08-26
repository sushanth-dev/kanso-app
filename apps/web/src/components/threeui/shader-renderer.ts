'use client';

import * as THREE from 'three';
import type { ThreeUiRenderer } from './threeui-background.tsx';

/**
 * Shared builder that ports a raw-WebGL fragment shader to a
 * `THREE.ShaderMaterial` on a full-screen quad, reusing the project's shared
 * `three` (the upstream ThreeUI shader backgrounds call `canvas.getContext`
 * directly; we keep one rendering runtime). Every effect gets a standard
 * uniform set: `u_time` (seconds), `u_resolution` (CSS pixels), and `u_mouse`
 * (normalized pointer, smoothed toward the cursor). The vertex shader is a
 * plain pass-through.
 */
export function createShaderRenderer(
  canvas: HTMLCanvasElement,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): ThreeUiRenderer {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const material = new THREE.ShaderMaterial({
    vertexShader: `
      void main() {
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader,
    uniforms: {
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_mouse: { value: new THREE.Vector2(0.5, 0.5) },
      ...uniforms,
    },
    transparent: true,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(mesh);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const shaderUniforms: Record<string, THREE.IUniform> = material.uniforms;
  const resolution = shaderUniforms['u_resolution']!.value as THREE.Vector2;
  const mouseUniform = shaderUniforms['u_mouse']!.value as THREE.Vector2;
  const timeUniform = shaderUniforms['u_time']!;

  const mouse = new THREE.Vector2(0.5, 0.5);
  const target = new THREE.Vector2(0.5, 0.5);
  const onPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    target.set(
      (event.clientX - rect.left) / Math.max(1, rect.width),
      1 - (event.clientY - rect.top) / Math.max(1, rect.height),
    );
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  return {
    resize(width, height) {
      resolution.set(width, height);
      renderer.setSize(width, height, false);
    },
    render(time) {
      mouse.lerp(target, 0.08);
      mouseUniform.copy(mouse);
      timeUniform.value = time * 0.001;
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('pointermove', onPointer);
      mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
