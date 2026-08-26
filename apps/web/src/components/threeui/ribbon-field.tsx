'use client';

import { ThreeUiBackground } from './threeui-background.tsx';
import { createShaderRenderer } from './shader-renderer.ts';

// Vendored ThreeUI RibbonField, restyled to the Study Room palette: the
// flowing ribbons and bloom read in teal and gold instead of the upstream's
// cyan/indigo/purple. Ported to the shared `three` and rendered through the
// shared ThreeUiBackground mount.
const RIBBON_FIELD_FRAGMENT = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float ribbon(vec2 uv, float offset, float width, float phase) {
  float y = 0.55 + 0.20 * sin((uv.x * 2.15) + phase) + 0.045 * sin((uv.x * 7.0) - phase * 0.7);
  float d = abs(uv.y - y - offset);
  return exp(-(d * d) / width);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv;
  p.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.22;
  float drift = (u_mouse.x - 0.5) * 0.06;

  float rightFade = smoothstep(0.28, 0.72, uv.x);
  float centerDark = 1.0 - smoothstep(0.0, 0.88, distance(uv, vec2(0.18, 0.48)));

  float r1 = ribbon(vec2(uv.x + drift, uv.y), 0.03, 0.0065, t + 0.9);
  float r2 = ribbon(vec2(uv.x - drift * 0.7, uv.y), -0.23, 0.0085, t + 3.25);
  float r3 = ribbon(vec2(uv.x + drift * 0.4, uv.y), 0.25, 0.014, t + 1.85);

  float glow = r1 * 1.14 + r2 * 1.05 + r3 * 0.48;

  vec3 teal = vec3(0.059, 0.369, 0.400);   // teal-600
  vec3 tealLight = vec3(0.243, 0.796, 0.827); // cyan-300
  vec3 gold = vec3(0.914, 0.706, 0.298);   // gold-400
  vec3 wood = vec3(0.561, 0.369, 0.220);   // wood-600
  vec3 sand = vec3(0.518, 0.471, 0.404);   // sand-500

  vec3 col = vec3(0.0);
  col += teal * r1 * 0.62;
  col += gold * r3 * 0.42;
  col += sand * r2 * 0.66;
  col += wood * (r2 + r3) * 0.30;

  float bloom = exp(-pow(distance(uv, vec2(0.76, 0.40 + 0.035 * sin(t))), 2.0) / 0.050);
  bloom += exp(-pow(distance(uv, vec2(0.71, 0.75 + 0.025 * cos(t))), 2.0) / 0.030);
  col += tealLight * bloom * 0.34;

  vec2 grid = fract(gl_FragCoord.xy / 7.0) - 0.5;
  float dotShape = smoothstep(0.29, 0.11, length(grid));
  float noise = hash(floor(gl_FragCoord.xy / 7.0));
  float scan = 0.72 + 0.28 * sin((uv.x + uv.y) * 38.0 + u_time * 1.3);
  float dots = dotShape * (0.48 + 0.52 * noise) * scan;

  float micro = hash(gl_FragCoord.xy + u_time) * 0.035;
  float alpha = clamp((glow * 1.55 + bloom * 0.50) * dots * rightFade, 0.0, 1.0);
  alpha *= 1.0 - centerDark * 0.56;

  vec3 cream = vec3(0.969, 0.949, 0.918);   // neutral-bg #f7f2ea
  vec3 finalColor = mix(cream, col, clamp(alpha * 1.55, 0.0, 1.0));
  finalColor += micro * rightFade;

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export function RibbonFieldBackground({ className }: { className?: string }) {
  return (
    <ThreeUiBackground
      className={className}
      createRenderer={(canvas) => createShaderRenderer(canvas, RIBBON_FIELD_FRAGMENT, {})}
    />
  );
}
