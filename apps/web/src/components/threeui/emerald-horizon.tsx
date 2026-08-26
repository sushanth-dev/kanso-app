'use client';

import { ThreeUiBackground } from './threeui-background.tsx';
import { createThreeSceneRenderer, type ThreeSceneConfig } from './three-scene.ts';

// Tournaments backdrop. A 3D aurora-like field: particles in teal and gold
// drifting through depth with a soft wave, light pointer parallax. Rendered
// through the shared ThreeUiBackground mount.
const TOURNAMENTS_SCENE: ThreeSceneConfig = {
  bg: 0xf7f2ea, // neutral-bg cream paper
  palette: ['#0f5e66', '#e8a33d', '#4e9b8a', '#a03f22'], // teal, gold, patina, terracotta
  particleCount: 750,
  spread: [20, 13, 13],
  speed: 4.5,
  motion: 'wave',
  interactStrength: 0.7,
  interactRadius: 3.5,
  parallax: 0.6,
  floaters: 5,
};

export function EmeraldHorizonBackground({ className }: { className?: string }) {
  return (
    <ThreeUiBackground
      className={className}
      createRenderer={(canvas) => createThreeSceneRenderer(canvas, TOURNAMENTS_SCENE)}
    />
  );
}
