'use client';

import { ThreeUiBackground } from './threeui-background.tsx';
import { createThreeSceneRenderer, type ThreeSceneConfig } from './three-scene.ts';

// Tournaments backdrop. A calm 3D field: a few teal, gold, and patina particles
// drifting slowly through depth with a soft wave and light pointer parallax.
// Kept quiet so the tournament cards stay the brightest object.
const TOURNAMENTS_SCENE: ThreeSceneConfig = {
  bg: 0xf7f2ea, // neutral-bg cream paper
  palette: ['#0f5e66', '#e8a33d', '#4e9b8a'], // teal, gold, patina
  particleCount: 300,
  spread: [22, 14, 14],
  speed: 2,
  motion: 'drift',
  interactStrength: 0.4,
  interactRadius: 4,
  parallax: 0.3,
  floaters: 1,
};

export function EmeraldHorizonBackground({ className }: { className?: string }) {
  return (
    <ThreeUiBackground
      className={className}
      createRenderer={(canvas) => createThreeSceneRenderer(canvas, TOURNAMENTS_SCENE)}
    />
  );
}
