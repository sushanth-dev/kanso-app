'use client';

import { ThreeUiBackground } from './threeui-background.tsx';
import { createThreeSceneRenderer, type ThreeSceneConfig } from './three-scene.ts';

// Settings backdrop. A 3D ribbon-like field: particles in teal, gold, and
// wood flowing in a gentle wave through depth, with light pointer parallax.
// Rendered through the shared ThreeUiBackground mount.
const SETTINGS_SCENE: ThreeSceneConfig = {
  bg: 0xf7f2ea, // neutral-bg cream paper
  palette: ['#0f5e66', '#e8a33d', '#8f5e38', '#3ecbd3'], // teal, gold, wood, cyan
  particleCount: 900,
  spread: [20, 14, 12],
  speed: 4,
  motion: 'wave',
  interactStrength: 0.6,
  interactRadius: 3.5,
  parallax: 0.5,
  floaters: 4,
};

export function RibbonFieldBackground({ className }: { className?: string }) {
  return (
    <ThreeUiBackground
      className={className}
      createRenderer={(canvas) => createThreeSceneRenderer(canvas, SETTINGS_SCENE)}
    />
  );
}
