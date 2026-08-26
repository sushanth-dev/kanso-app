'use client';

import { ThreeUiBackground } from './threeui-background.tsx';
import { createThreeSceneRenderer, type ThreeSceneConfig } from './three-scene.ts';

// Auth backdrop. A 3D particle field in the bell's palette (patina, bronze,
// terracotta) drifting in depth with strong pointer repulsion, so the cursor
// visibly parts the field. Rendered through the shared ThreeUiBackground mount.
const AUTH_SCENE: ThreeSceneConfig = {
  bg: 0xf7f2ea, // neutral-bg cream paper
  palette: ['#4e9b8a', '#d89a3f', '#a03f22', '#8f5e38'], // patina, bronze, terracotta, wood
  particleCount: 700,
  spread: [18, 12, 14],
  speed: 6,
  motion: 'drift',
  interactStrength: 1.4,
  interactRadius: 4,
  parallax: 0.8,
  floaters: 5,
};

export function BellFieldBackground({ className }: { className?: string }) {
  return (
    <ThreeUiBackground
      className={className}
      createRenderer={(canvas) => createThreeSceneRenderer(canvas, AUTH_SCENE)}
    />
  );
}
