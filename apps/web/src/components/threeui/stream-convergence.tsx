'use client';

import { ThreeUiBackground } from './threeui-background.tsx';
import { createThreeSceneRenderer, type ThreeSceneConfig } from './three-scene.ts';

// Upgrade backdrop. A 3D orbital field: particles in teal, periwinkle, and
// gold orbiting the centre in depth, with strong pointer repulsion. Rendered
// through the shared ThreeUiBackground mount.
const UPGRADE_SCENE: ThreeSceneConfig = {
  bg: 0xf7f2ea, // neutral-bg cream paper
  palette: ['#0f5e66', '#7b9dff', '#e8a33d', '#a03f22'], // teal, periwinkle, gold, terracotta
  particleCount: 480,
  spread: [16, 12, 14],
  speed: 3.5,
  motion: 'orbit',
  interactStrength: 0.8,
  interactRadius: 4,
  parallax: 0.45,
  floaters: 3,
};

export function StreamConvergenceBackground({ className }: { className?: string }) {
  return (
    <ThreeUiBackground
      className={className}
      createRenderer={(canvas) => createThreeSceneRenderer(canvas, UPGRADE_SCENE)}
    />
  );
}
