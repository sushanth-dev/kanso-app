'use client';

import { ThreeUiBackground } from './threeui-background.tsx';
import { createShaderRenderer } from './shader-renderer.ts';

// Vendored ThreeUI EmeraldHorizon (Lumina), restyled to the Study Room
// palette: the aurora horizon reads in teal and gold instead of the
// upstream's emerald. Ported to the shared `three` and rendered through the
// shared ThreeUiBackground mount.
const EMERALD_HORIZON_FRAGMENT = `
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_wave_scale;
uniform float u_variation;
uniform float u_glow;
uniform float u_vignette;

float hash(float n) { return fract(sin(n) * 1e4); }
float noise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), u);
}

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution.xy;
  float yPos = st.y;
  float wave1 = sin(st.x * 3.0 + u_time * 0.5) * 0.1 * u_wave_scale;
  float wave2 = sin(st.x * 5.0 - u_time * 0.3) * 0.05 * u_wave_scale;
  float combinedWave = wave1 + wave2;
  float intensity = smoothstep(0.4, -0.1, yPos + combinedWave);
  float variation = noise(st.x * 2.0 + u_time * 0.1) * 0.5 + 0.5;
  intensity *= variation * 1.5 * u_variation;

  vec3 cream = vec3(0.969, 0.949, 0.918);   // neutral-bg #f7f2ea
  vec3 glowColor1 = vec3(0.059, 0.369, 0.400);   // teal-600
  vec3 glowColor2 = vec3(0.914, 0.706, 0.298);   // gold-400
  vec3 finalGlow = mix(glowColor1, glowColor2, st.x + sin(u_time * 0.2) * 0.5);
  vec3 color = mix(cream, finalGlow, pow(intensity, 1.5) * 0.55 * u_glow);

  float vignette = mix(1.0, smoothstep(1.2, 0.5, length(st - vec2(0.5, 0.0))), u_vignette);
  color = mix(color, cream, vignette * 0.35);

  gl_FragColor = vec4(color, 1.0);
}
`;

export function EmeraldHorizonBackground({ className }: { className?: string }) {
  return (
    <ThreeUiBackground
      className={className}
      createRenderer={(canvas) =>
        createShaderRenderer(canvas, EMERALD_HORIZON_FRAGMENT, {
          u_wave_scale: { value: 1 },
          u_variation: { value: 1 },
          u_glow: { value: 1 },
          u_vignette: { value: 1 },
        })
      }
    />
  );
}
