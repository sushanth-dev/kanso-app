'use client';

import { ThreeUiBackground } from './threeui-background.tsx';
import { createShaderRenderer } from './shader-renderer.ts';

// Vendored ThreeUI StreamConvergence, restyled to the Study Room palette:
// the converging light streams read in teal and periwinkle instead of the
// upstream's violet-indigo. Ported to the shared `three` and rendered through
// the shared ThreeUiBackground mount.
const STREAM_CONVERGENCE_FRAGMENT = `
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_interactive_fidelity;

mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

void main() {
    vec2 p = gl_FragCoord.xy / u_resolution.xy * 2.0 - 1.0;
    p.x *= u_resolution.x / u_resolution.y;
    p = rotate2d(0.55) * p;

    vec3 cream = vec3(0.969, 0.949, 0.918);   // neutral-bg #f7f2ea
    vec3 teal = vec3(0.059, 0.369, 0.400);    // teal-600
    vec3 periwinkle = vec3(0.42, 0.55, 0.75); // periwinkle
    vec3 gold = vec3(0.914, 0.706, 0.298);    // gold-400
    vec3 color = cream;
    float spread = 0.06 * (0.3 + u_interactive_fidelity * 0.7);

    for(int i = 0; i < 3; i++) {
        float offset = float(1 - i) * spread;
        float y = p.y + offset + (sin(p.x * 2.5 - u_time * 1.5) * 0.12);
        float wave = smoothstep(0.85, 0.99, sin(y * 6.0 + u_time * 2.0) * 0.5 + 0.5);

        vec3 streamColor = i == 0 ? periwinkle : (i == 1 ? teal : gold);
        color = mix(color, streamColor, wave * 0.28);
    }

    gl_FragColor = vec4(color, 1.0);
}
`;

export function StreamConvergenceBackground({ className }: { className?: string }) {
  return (
    <ThreeUiBackground
      className={className}
      createRenderer={(canvas) =>
        createShaderRenderer(canvas, STREAM_CONVERGENCE_FRAGMENT, {
          u_interactive_fidelity: { value: 0.5 },
        })
      }
    />
  );
}
