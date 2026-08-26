'use client';

import { ThreeUiBackground } from './threeui-background.tsx';
import { createShaderRenderer } from './shader-renderer.ts';

// Vendored ThreeUI BellField, restyled to the Study Room palette: the struck
// bell's vibration modes already read in deep teal, patina, and bronze, which
// sit naturally in the Study Room family. Ported to the shared `three` and
// rendered through the shared ThreeUiBackground mount.
const BELL_FIELD_FRAGMENT = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_strike;

#define PI 3.14159265359

float hash(vec2 p) { return fract(sin(dot(p, vec2(23.71, 91.37))) * 41537.1234); }

// damped-cosine stand-in for the Bessel envelope of a circular mode
float bess(float x) { return cos(x - 0.785398) / sqrt(1.0 + abs(x)); }

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= u_resolution.x / u_resolution.y;
    p.y += 0.08;

    vec2 m = u_mouse * 2.0 - 1.0;
    m.y = -m.y;
    m.x *= u_resolution.x / u_resolution.y;
    p -= m * 0.11;

    float t = u_time * 0.09;
    float r = length(p);
    float a = atan(p.y, p.x);

    // the bell drifts between partials the way a struck bell does
    float ang = 3.0 + 1.6 * sin(t * 0.37) + sin(t * 0.19 + 1.7);
    float k   = 3.1 + 1.0 * sin(t * 0.23 + 0.6);

    float amp = 1.0 + (1.0 - u_strike) * 0.55;
    float f1 = bess(r * k * PI - t * 2.2) * cos(ang * a + t * 0.5);
    float f2 = bess(r * k * 1.6 * PI + t * 1.4) * cos((ang * 2.0 + 1.0) * a - t * 0.31);
    float f = (f1 + f2 * 0.30) * amp;

    // nodal lines - where the metal stands still
    float node = 1.0 - smoothstep(0.0, 0.075 + 0.075 * r, abs(f));
    // antinodes - where it moves, and glows hot
    float anti = smoothstep(0.40, 0.95, abs(f));

    // the crown stays quiet - clears a reading zone under the type
    float open = smoothstep(0.14, 0.92, r);
    node *= open;
    anti *= open;

    vec3 cream  = vec3(0.969, 0.949, 0.918);   // neutral-bg #f7f2ea
    vec3 patina = vec3(0.306, 0.608, 0.541);   // patina (teal-green)
    vec3 bronze = vec3(0.847, 0.608, 0.247);   // bronze (gold)
    vec3 ink    = vec3(0.141, 0.114, 0.086);   // ink #241d16

    vec3 col = cream;
    col = mix(col, patina, node * 0.42);
    col = mix(col, bronze, anti * 0.20);
    col += ink * pow(node, 3.0) * 0.06;

    // shock ring travelling out from the strike
    float ring = smoothstep(0.06, 0.0, abs(r - u_strike * 2.3)) * (1.0 - u_strike);
    col += mix(bronze, cream, 0.5) * ring * 0.5;

    col += (hash(gl_FragCoord.xy) - 0.5) * 0.016;

    gl_FragColor = vec4(col, 1.0);
}
`;

export function BellFieldBackground({ className }: { className?: string }) {
  return (
    <ThreeUiBackground
      className={className}
      createRenderer={(canvas) =>
        createShaderRenderer(canvas, BELL_FIELD_FRAGMENT, {
          u_strike: { value: 0 },
        })
      }
    />
  );
}
