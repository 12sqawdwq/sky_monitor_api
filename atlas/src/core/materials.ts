import { AdditiveBlending, Color, ShaderMaterial, Vector3 } from 'three';

// Warm-only star colour ramp (no blue/violet): hot stars read as warm white,
// cool stars as ember. Driven by B-V colour index.
const STAR_COLOUR_GLSL = /* glsl */ `
vec3 starColour(float ci) {
  float t = clamp((ci + 0.25) / 2.1, 0.0, 1.0);
  vec3 hot = vec3(1.0, 0.972, 0.925);
  vec3 sun = vec3(1.0, 0.866, 0.66);
  vec3 cool = vec3(1.0, 0.58, 0.34);
  return t < 0.42 ? mix(hot, sun, t / 0.42) : mix(sun, cool, (t - 0.42) / 0.58);
}
`;

export interface StarUniforms {
  [key: string]: { value: unknown };
  uCamPos: { value: Vector3 };
  uLimitMag: { value: number };
  uFloor: { value: number };
  uOpacity: { value: number };
  uDpr: { value: number };
  uSizeScale: { value: number };
}

/**
 * Point stars with physically based brightness: apparent magnitude is derived
 * per vertex from absolute magnitude and the live camera distance.
 */
export function createStarMaterial(): ShaderMaterial & { uniforms: StarUniforms } {
  const uniforms: StarUniforms = {
    uCamPos: { value: new Vector3() },
    uLimitMag: { value: 6.8 },
    uFloor: { value: 0 },
    uOpacity: { value: 1 },
    uDpr: { value: 1 },
    uSizeScale: { value: 1 }
  };
  return new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float absmag;
      attribute float ci;
      uniform vec3 uCamPos;
      uniform float uLimitMag;
      uniform float uFloor;
      uniform float uOpacity;
      uniform float uDpr;
      uniform float uSizeScale;
      varying vec3 vColour;
      varying float vAlpha;
      varying float vCore;
      ${STAR_COLOUR_GLSL}
      void main() {
        float d = max(length(position - uCamPos), 1e-7);
        float m = absmag + 5.0 * (log(d / 3.261563777) / log(10.0) - 1.0);
        float b = clamp((uLimitMag - m) / 7.0, 0.0, 1.6);
        b = max(b, uFloor);
        vColour = starColour(ci);
        vAlpha = smoothstep(0.0, 0.18, b) * uOpacity;
        vCore = clamp(b, 0.0, 1.0);
        gl_PointSize = (1.6 + b * b * 9.0) * uSizeScale * uDpr;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        if (vAlpha < 0.004) gl_PointSize = 0.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColour;
      varying float vAlpha;
      varying float vCore;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r2 = dot(c, c) * 4.0;
        if (r2 > 1.0) discard;
        float core = exp(-r2 * 14.0);
        float halo = exp(-r2 * 3.2) * 0.32 * vCore;
        gl_FragColor = vec4(mix(vColour, vec3(1.0, 0.98, 0.94), core * 0.6), (core + halo) * vAlpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending
  }) as ShaderMaterial & { uniforms: StarUniforms };
}

export interface DustUniforms {
  [key: string]: { value: unknown };
  uPixelScale: { value: number };
  uOpacity: { value: number };
  uMinPx: { value: number };
  uMaxPx: { value: number };
  uDpr: { value: number };
  uFalloff: { value: number };
  uFixedPx: { value: number };
  uEnergy: { value: number };
}

/**
 * Soft particles with a physical size (light-years). Used for galaxy discs,
 * clouds and the cosmic web. Sub-pixel particles dim instead of shrinking,
 * and particles that would fill the screen fade out.
 */
export function createDustMaterial(options: { falloff?: number; maxPx?: number; minPx?: number; fixedPx?: number; energy?: number } = {}): ShaderMaterial & { uniforms: DustUniforms } {
  const uniforms: DustUniforms = {
    uPixelScale: { value: 800 },
    uOpacity: { value: 1 },
    uMinPx: { value: options.minPx ?? 1.4 },
    uMaxPx: { value: options.maxPx ?? 90 },
    uDpr: { value: 1 },
    uFalloff: { value: options.falloff ?? 3.2 },
    uFixedPx: { value: options.fixedPx ?? 0 },
    // 2 conserves surface brightness for sub-pixel particles (dense discs);
    // 1 keeps sparse tracers such as the cosmic web visible.
    uEnergy: { value: options.energy ?? 1 }
  };
  return new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec4 tint;
      attribute float size;
      uniform float uPixelScale;
      uniform float uOpacity;
      uniform float uMinPx;
      uniform float uMaxPx;
      uniform float uDpr;
      uniform float uFixedPx;
      uniform float uEnergy;
      varying vec4 vTint;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        float px = size * uPixelScale / max(d, 1e-9);
        float a = uOpacity * tint.a;
        if (uFixedPx > 0.0) {
          px = uFixedPx;
        } else {
          a *= pow(clamp(px / uMinPx, 0.0, 1.0), uEnergy);
          a *= 1.0 - smoothstep(uMaxPx * 0.55, uMaxPx * 1.5, px);
        }
        vTint = vec4(tint.rgb, a);
        gl_PointSize = clamp(px, uMinPx, uMaxPx) * uDpr;
        if (d <= 0.0 || a < 0.002) gl_PointSize = 0.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFalloff;
      varying vec4 vTint;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r2 = dot(c, c) * 4.0;
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vTint.rgb, exp(-r2 * uFalloff) * (1.0 - r2) * vTint.a);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending
  }) as ShaderMaterial & { uniforms: DustUniforms };
}

/** Palette shared by layers and CSS (keep in sync with atlas.css). */
export const PALETTE = {
  ink: new Color('#e7e1d5'),
  inkDim: new Color('#b9b2a4'),
  line: new Color('#7d7a70'),
  copper: new Color('#c58a55'),
  amber: new Color('#d9a35b'),
  brass: new Color('#b8a955'),
  ember: new Color('#9a5c4c'),
  rose: new Color('#c9785f'),
  cinnabar: new Color('#c8553d'),
  cream: new Color('#f3e6cc')
};
