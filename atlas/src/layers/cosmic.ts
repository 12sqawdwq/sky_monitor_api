import { AdditiveBlending, Color, DoubleSide, Group, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { createDustMaterial, PALETTE } from '../core/materials';
import { galacticToScene, length, type Vec3 } from '../core/coords';
import { gaussian, logWindow, mulberry32 } from '../core/units';
import { NEARBY_UNIVERSE } from '../data/objects';
import { mixColour, ParticleBuilder } from './particles';
import type { FrameState, Layer } from './types';

export const OBSERVABLE_RADIUS_LY = 4.65e10;

function randomInShell(rand: () => number, rMin: number, rMax: number): Vec3 {
  const u = rand() * 2 - 1;
  const phi = rand() * Math.PI * 2;
  const r = Math.cbrt(rMin ** 3 + rand() * (rMax ** 3 - rMin ** 3));
  const s = Math.sqrt(1 - u * u);
  return [r * s * Math.cos(phi), r * u, r * s * Math.sin(phi)];
}

interface WebOptions {
  nodes: Vec3[];
  links: number;
  thickness: number;
  density: number;
  size: number;
  alpha: number;
  nodeBlob: number;
  exclude: number;
}

/** Filaments between nearest neighbours plus a blob per node. */
function buildWeb(builder: ParticleBuilder, rand: () => number, options: WebOptions): void {
  const { nodes } = options;
  const seen = new Set<string>();
  const colours = [PALETTE.cream, PALETTE.amber, PALETTE.copper, PALETTE.rose];
  const tint = () => mixColour(colours[Math.floor(rand() * colours.length)], PALETTE.cream, rand() * 0.5);
  const keep = (p: Vec3) => length(p) > options.exclude;

  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    const nearest = nodes
      .map((b, j) => ({ j, d: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) }))
      .filter(entry => entry.j !== i)
      .sort((x, y) => x.d - y.d)
      .slice(0, options.links);
    for (const { j, d } of nearest) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = nodes[j];
      const count = Math.max(4, Math.round((d / options.thickness) * options.density));
      for (let k = 0; k < count; k += 1) {
        const t = rand();
        const p: Vec3 = [
          a[0] + (b[0] - a[0]) * t + gaussian(rand) * options.thickness,
          a[1] + (b[1] - a[1]) * t + gaussian(rand) * options.thickness,
          a[2] + (b[2] - a[2]) * t + gaussian(rand) * options.thickness
        ];
        if (keep(p)) builder.add(p, tint(), options.alpha, options.size);
      }
    }
    for (let k = 0; k < options.nodeBlob; k += 1) {
      const s = options.thickness * 1.6;
      const p: Vec3 = [a[0] + gaussian(rand) * s, a[1] + gaussian(rand) * s, a[2] + gaussian(rand) * s];
      if (keep(p)) builder.add(p, mixColour(PALETTE.cream, PALETTE.amber, rand() * 0.4), options.alpha * 1.4, options.size * 0.8);
    }
  }
}

/**
 * Large-scale structure. The nearby web is anchored on real clusters
 * (Virgo, Coma, the Great Attractor ...); beyond that the filaments are a
 * statistical illustration, not survey data.
 */
export class CosmicWebLayer implements Layer {
  readonly group = new Group();
  readonly origin: Vec3 = [0, 0, 0];
  private near = createDustMaterial({ maxPx: 26, minPx: 1.1, falloff: 3 });
  private far = createDustMaterial({ maxPx: 26, minPx: 1.1, falloff: 3 });

  constructor() {
    const rand = mulberry32(13800);
    const clusters = NEARBY_UNIVERSE.filter(e => e.kind !== 'galaxy').map(e => galacticToScene(e.l, e.b, e.ly));
    const nearNodes: Vec3[] = [...clusters];
    for (let k = 0; k < 320; k += 1) nearNodes.push(randomInShell(rand, 2.5e7, 1.8e9));
    const near = new ParticleBuilder();
    buildWeb(near, rand, { nodes: nearNodes, links: 3, thickness: 4e6, density: 1.5, size: 1.8e6, alpha: 0.6, nodeBlob: 60, exclude: 9e6 });
    // Real clusters get a dense core.
    for (const c of clusters) {
      for (let k = 0; k < 600; k += 1) {
        const s = 2.4e6;
        near.add([c[0] + gaussian(rand) * s, c[1] + gaussian(rand) * s, c[2] + gaussian(rand) * s], mixColour(PALETTE.cream, PALETTE.amber, rand() * 0.5), 0.55, 9e5);
      }
    }
    const nearPoints = near.build(this.near);
    nearPoints.renderOrder = 6;

    const farNodes: Vec3[] = [];
    for (let k = 0; k < 2200; k += 1) farNodes.push(randomInShell(rand, 1.2e9, 4.4e10));
    const far = new ParticleBuilder();
    buildWeb(far, rand, { nodes: farNodes, links: 3, thickness: 3.2e8, density: 0.42, size: 1.6e8, alpha: 0.3, nodeBlob: 8, exclude: 1.4e9 });
    const farPoints = far.build(this.far);
    farPoints.renderOrder = 5;

    this.group.add(nearPoints, farPoints);
  }

  update(frame: FrameState): void {
    this.near.uniforms.uOpacity.value = logWindow(frame.logR, 6.7, 7.7, 10.4, 11.1);
    this.far.uniforms.uOpacity.value = logWindow(frame.logR, 9.1, 9.9, 12.6, 13.2);
    for (const material of [this.near, this.far]) {
      material.uniforms.uPixelScale.value = frame.pixelScale;
      material.uniforms.uDpr.value = frame.dpr;
    }
    this.group.visible = frame.logR > 6.5;
  }
}

/** The last-scattering surface: a mottled shell at the observable horizon. */
export class HorizonLayer implements Layer {
  readonly group = new Group();
  readonly origin: Vec3 = [0, 0, 0];
  private material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 },
        uWarm: { value: new Color('#c9785f') },
        uDeep: { value: new Color('#3a1a10') },
        uGlow: { value: new Color('#e8c08a') }
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        varying float vFacing;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          vFacing = abs(dot(n, normalize(-mv.xyz)));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec3 uWarm;
        uniform vec3 uDeep;
        uniform vec3 uGlow;
        varying vec3 vDir;
        varying float vFacing;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int k = 0; k < 5; k++) { v += a * noise(p); p *= 2.07; a *= 0.5; } return v; }
        void main() {
          float n = fbm(vDir * 7.0);
          float spots = smoothstep(0.45, 0.75, n);
          vec3 colour = mix(uDeep, uWarm, spots);
          colour = mix(colour, uGlow, smoothstep(0.72, 0.9, n) * 0.6);
          float rim = pow(1.0 - vFacing, 2.2);
          float alpha = uOpacity * (0.16 + spots * 0.3 + rim * 0.5);
          gl_FragColor = vec4(colour, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending
    });
    const mesh = new Mesh(new SphereGeometry(OBSERVABLE_RADIUS_LY, 96, 64), this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  update(frame: FrameState): void {
    this.material.uniforms.uOpacity.value = logWindow(frame.logR, 10.1, 10.8, 13, 14);
    this.group.visible = frame.logR > 10;
  }
}
