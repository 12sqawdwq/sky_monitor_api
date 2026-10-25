import { BufferAttribute, BufferGeometry, Color, Group, Points } from 'three';
import { createDustMaterial, createStarMaterial, PALETTE } from '../core/materials';
import type { Vec3 } from '../core/coords';
import { gaussian, logWindow, mulberry32, smoothstep } from '../core/units';
import type { AtlasObject } from '../data/objects';
import { mixColour, ParticleBuilder } from './particles';
import type { FrameState, Layer } from './types';

/*
 * Physical models of the Milky Way clusters and nebulae in the catalogue.
 *
 * Every object is its own layer with its origin at the object, so the camera can fly inside a
 * one-light-year planetary nebula without float32 jitter. Sizes are in light-years and follow
 * published core / tidal radii and nebula dimensions; star brightness uses absolute magnitudes,
 * so the shared star shader dims members with distance exactly as it does catalogue stars.
 *
 * Palette note: H-alpha is red and maps onto the warm palette (rose / ember). [O III] teal and
 * the blue of reflection nebulae are outside it and are drawn in cream instead.
 */

const PC_LY = 3.261563777;
/** HYG holds nearly every star brighter than this apparent magnitude. */
const HYG_COMPLETE_MAG = 8;

const distanceModulus = (ly: number) => 5 * Math.log10(ly / PC_LY) - 5;

/**
 * Light carried by one globular-cluster particle (luminosity of an absolute magnitude 0.75
 * star). Giving every globular the same packet makes brighter clusters denser rather than
 * sparkier, so ω Centauri, M13 and M22 read as the same kind of object.
 */
const GLOBULAR_PACKET_ABSMAG = 0.75;
const globularCount = (totalAbsMag: number) => Math.round(Math.pow(10, -0.4 * (totalAbsMag - GLOBULAR_PACKET_ABSMAG)));

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function randomDirection(rand: () => number): Vec3 {
  const z = rand() * 2 - 1;
  const phi = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(phi), s * Math.sin(phi), z];
}

/** Radius drawn from a Plummer profile with scale `a`, truncated at the tidal radius. */
function plummerRadius(rand: () => number, a: number, tidal: number): number {
  for (let k = 0; k < 50; k += 1) {
    const u = Math.max(rand(), 1e-9);
    const r = a / Math.sqrt(Math.pow(u, -2 / 3) - 1);
    if (r <= tidal) return r;
  }
  return tidal * rand();
}

/** Magnitude drawn from a luminosity function dN/dM ∝ 10^(k M) between bright and faint limits. */
function lfMagnitude(rand: () => number, bright: number, faint: number, k = 0.32): number {
  const a = Math.pow(10, k * bright);
  const b = Math.pow(10, k * faint);
  return Math.log10(a + rand() * (b - a)) / k;
}

type Population = 'young' | 'intermediate' | 'old';

/** B-V colour for a member of magnitude `t` (0 = brightest, 1 = faintest of the sample). */
function memberColour(population: Population, t: number, rand: () => number): number {
  const jitter = gaussian(rand) * 0.07;
  if (population === 'young') return -0.28 + t * 0.9 + jitter;
  if (population === 'intermediate') return 0.0 + t * 1.35 + jitter;
  // Old globular population: giants at the top, a blue horizontal branch, then the turn-off.
  const r = rand();
  if (t < 0.12) return 1.15 + rand() * 0.4;
  if (r < 0.06) return 0.05 + rand() * 0.15;
  return 0.55 + t * 0.35 + jitter;
}

class StarBuilder {
  private positions: number[] = [];
  private absmag: number[] = [];
  private ci: number[] = [];

  get count(): number {
    return this.absmag.length;
  }

  add(p: Vec3, magnitude: number, colour: number): void {
    this.positions.push(p[0], p[1], p[2]);
    this.absmag.push(magnitude);
    this.ci.push(colour);
  }

  build(material: ReturnType<typeof createStarMaterial>): Points {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('absmag', new BufferAttribute(new Float32Array(this.absmag), 1));
    geometry.setAttribute('ci', new BufferAttribute(new Float32Array(this.ci), 1));
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }
}

/** Builder context: local frame aligned with the sky (e1, e2) and the line of sight (los). */
class Context {
  readonly stars = new StarBuilder();
  readonly dust = new ParticleBuilder();
  readonly rand: () => number;
  readonly e1: Vec3;
  readonly e2: Vec3;
  readonly los: Vec3;
  readonly dm: number;

  constructor(readonly object: AtlasObject, seed: number) {
    this.rand = mulberry32(seed);
    this.los = normalize(object.pos);
    let e1 = cross(this.los, [0, 1, 0]);
    if (Math.hypot(e1[0], e1[1], e1[2]) < 1e-6) e1 = cross(this.los, [1, 0, 0]);
    this.e1 = normalize(e1);
    this.e2 = cross(this.e1, this.los);
    this.dm = distanceModulus(Math.hypot(object.pos[0], object.pos[1], object.pos[2]));
  }

  /** Local position from sky-plane offsets (u along e1, v along e2) and depth w along the line of sight. */
  sky(u: number, v: number, w = 0): Vec3 {
    return add(add(scale(this.e1, u), scale(this.e2, v)), scale(this.los, w));
  }

  /** An orthonormal frame whose axis `n` is tilted `incDeg` from the line of sight at position angle `pa`. */
  axisFrame(incDeg: number, pa: number): { a: Vec3; b: Vec3; n: Vec3 } {
    const inc = (incDeg * Math.PI) / 180;
    const tilt = add(scale(this.e1, Math.cos(pa)), scale(this.e2, Math.sin(pa)));
    const n = normalize(add(scale(this.los, Math.cos(inc)), scale(tilt, Math.sin(inc))));
    let a = cross(n, this.los);
    if (Math.hypot(a[0], a[1], a[2]) < 1e-6) a = this.e1;
    a = normalize(a);
    return { a, b: cross(n, a), n };
  }

  glow(p: Vec3, colour: Color, alpha: number, size: number): void {
    this.dust.add(p, colour, alpha, size);
  }

  /**
   * Cluster members on a Plummer profile. `core` is the Plummer scale, which equals the
   * projected half-light radius (for globulars: Harris catalogue r_h × distance). With `totalAbsMag` the sample is scaled so the members
   * add up to that integrated absolute magnitude; `hygCut` drops members bright enough to be
   * real catalogue stars already.
   */
  cluster(options: {
    centre?: Vec3;
    core: number;
    tidal: number;
    count: number;
    bright: number;
    faint: number;
    population: Population;
    totalAbsMag?: number;
    hygCut?: boolean;
    flatten?: number;
    supergiants?: number;
  }): void {
    const centre = options.centre ?? [0, 0, 0];
    const rand = this.rand;
    const bright = options.hygCut ? Math.max(options.bright, HYG_COMPLETE_MAG - this.dm) : options.bright;
    const mags = Array.from({ length: options.count }, () => lfMagnitude(rand, bright, options.faint)).sort((x, y) => x - y);
    let offset = 0;
    if (options.totalAbsMag !== undefined) {
      const sum = mags.reduce((s, m) => s + Math.pow(10, -0.4 * m), 0);
      offset = -2.5 * Math.log10(Math.pow(10, -0.4 * options.totalAbsMag) / sum);
    }
    const flatten = options.flatten ?? 1;
    mags.forEach((m, index) => {
      const r = plummerRadius(rand, options.core, options.tidal);
      const d = randomDirection(rand);
      const p = add(centre, this.sky(d[0] * r, d[1] * r, d[2] * r * flatten));
      const t = (m - bright) / Math.max(options.faint - bright, 1e-6);
      const red = options.supergiants !== undefined && index < options.supergiants;
      this.stars.add(p, m + offset, red ? 1.7 + rand() * 0.2 : memberColour(options.population, t, rand));
    });
  }

  /** Clumpy gas inside an ellipsoid (radii along e1, e2, los), skipping `exclude`d volumes. */
  cloud(options: {
    centre?: Vec3;
    radii: Vec3;
    count: number;
    clumps?: number;
    colour: (p: Vec3, r: number) => Color;
    alpha: number;
    size: number;
    exclude?: (p: Vec3) => boolean;
  }): void {
    const rand = this.rand;
    const centre = options.centre ?? [0, 0, 0];
    const [ru, rv, rw] = options.radii;
    const clumps = Array.from({ length: options.clumps ?? 14 }, () => [gaussian(rand) * 0.45, gaussian(rand) * 0.45, gaussian(rand) * 0.45, 0.18 + rand() * 0.3]);
    let made = 0;
    for (let tries = 0; made < options.count && tries < options.count * 6; tries += 1) {
      const c = clumps[Math.floor(rand() * clumps.length)];
      const x = c[0] + gaussian(rand) * c[3];
      const y = c[1] + gaussian(rand) * c[3];
      const z = c[2] + gaussian(rand) * c[3];
      const r = Math.hypot(x, y, z);
      if (r > 1) continue;
      const p = add(centre, this.sky(x * ru, y * rv, z * rw));
      if (options.exclude?.(p)) continue;
      const brightness = 0.55 + 0.45 * (1 - r);
      this.glow(p, options.colour(p, r), options.alpha * brightness, options.size * (0.7 + rand() * 0.6));
      made += 1;
    }
  }
}

const H_ALPHA = PALETTE.rose;
const H_ALPHA_DEEP = PALETTE.ember;
const HOT_CORE = mixColour(PALETTE.cream, PALETTE.amber, 0.25);

/** Distance from p to the segment a-b. */
function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

const emission = (core: number) => (_p: Vec3, r: number) => (r < core ? mixColour(HOT_CORE, H_ALPHA, r / core) : mixColour(H_ALPHA, H_ALPHA_DEEP, Math.min(1, (r - core) / (1 - core))));

/** Builders keyed by catalogue id. Integrated magnitudes are physical (extinction-corrected). */
const MODELS: Record<string, { seed: number; totalAbsMag?: number; build: (ctx: Context) => void }> = {
  // ---------------------------------------------------------------- open clusters
  Hyades: {
    seed: 11,
    // 625 Myr; core radius 2.7 pc, tidal radius 10 pc. Members brighter than ~4.6 mag are HYG stars.
    build: ctx => ctx.cluster({ core: 8.8, tidal: 33, count: 360, bright: -1, faint: 11, population: 'intermediate', hygCut: true })
  },
  M45: {
    seed: 12,
    // 100 Myr; core ~2 pc, tidal 13 pc, and the dust cloud it is drifting through (reflection nebula).
    build: ctx => {
      ctx.cluster({ core: 6.5, tidal: 43, count: 620, bright: -2.5, faint: 10, population: 'young', hygCut: true });
      ctx.cloud({ radii: [9, 7, 6], count: 520, clumps: 9, colour: () => PALETTE.cream, alpha: 0.05, size: 1.4 });
    }
  },
  M44: {
    seed: 13,
    build: ctx => ctx.cluster({ core: 11, tidal: 39, count: 560, bright: -1, faint: 10, population: 'intermediate', hygCut: true })
  },
  M7: {
    seed: 14,
    build: ctx => ctx.cluster({ core: 6, tidal: 25, count: 480, bright: -2, faint: 8.5, population: 'intermediate', hygCut: true })
  },
  M11: {
    seed: 15,
    totalAbsMag: -6.3,
    // 220 Myr, ~2900 stars inside ~20 ly: one of the densest open clusters.
    build: ctx => ctx.cluster({ core: 3.2, tidal: 24, count: 1500, bright: -3, faint: 6, population: 'intermediate', totalAbsMag: -6.3, supergiants: 8 })
  },
  'NGC 869/884': {
    seed: 16,
    totalAbsMag: -8.3,
    // h and χ Persei: two 13 Myr clusters about 60 ly apart, rich in red supergiants.
    build: ctx => {
      for (const [u, w] of [[-30, -8], [30, 8]] as const) {
        ctx.cluster({ centre: ctx.sky(u, 0, w), core: 6, tidal: 32, count: 1000, bright: -6.5, faint: 4, population: 'young', totalAbsMag: -7.55, supergiants: 6 });
      }
    }
  },
  // ---------------------------------------------------------------- globular clusters
  M22: {
    seed: 21,
    totalAbsMag: -8.5,
    build: ctx => ctx.cluster({ core: 10.4, tidal: 88, count: globularCount(-8.5), bright: -3.5, faint: 5, population: 'old', totalAbsMag: -8.5 })
  },
  'NGC 5139': {
    seed: 22,
    totalAbsMag: -10.3,
    // ω Centauri: ~10 million stars, slightly flattened; possibly the core of a captured dwarf galaxy.
    build: ctx => ctx.cluster({ core: 25, tidal: 157, count: globularCount(-10.3), bright: -3.5, faint: 5, population: 'old', totalAbsMag: -10.3, flatten: 0.85 })
  },
  M13: {
    seed: 23,
    totalAbsMag: -8.55,
    build: ctx => ctx.cluster({ core: 10.9, tidal: 85, count: globularCount(-8.55), bright: -3.5, faint: 5, population: 'old', totalAbsMag: -8.55 })
  },
  // ---------------------------------------------------------------- emission nebulae
  M42: {
    seed: 31,
    // A blister: the ionised skin of a molecular cloud, curving towards us around the Trapezium.
    build: ctx => {
      const rand = ctx.rand;
      for (let k = 0; k < 4200; k += 1) {
        const r = Math.min(11, -Math.log(1 - rand()) * 3.6);
        const theta = rand() * Math.PI * 2;
        const u = r * Math.cos(theta);
        const v = r * Math.sin(theta);
        if (Math.hypot(u + 2.6, v - 1.6) < 1.3) continue; // the dark "fish's mouth"
        const w = 2.5 - (r * r) / 20 + gaussian(rand) * 0.35;
        const colour = r < 2.2 ? mixColour(HOT_CORE, H_ALPHA, r / 2.2) : mixColour(H_ALPHA, H_ALPHA_DEEP, Math.min(1, (r - 2.2) / 8));
        ctx.glow(ctx.sky(u, v, w), colour, 0.16 * Math.exp(-r / 7), 0.9 + r * 0.12);
      }
      // M43, De Mairan's nebula, just to the north.
      ctx.cloud({ centre: ctx.sky(0.5, 5.6, 2), radii: [1.3, 1.2, 1], count: 260, clumps: 4, colour: emission(0.4), alpha: 0.12, size: 0.6 });
      // Trapezium (θ1 Ori A-D) and the young Orion Nebula Cluster.
      [[-4.3, 0], [-3.4, 0.25], [-2.6, -0.2], [-2.2, 0.15]].forEach(([m, du], k) => ctx.stars.add(ctx.sky(du, k * 0.06 - 0.1, 0.5), m, -0.3));
      ctx.cluster({ centre: ctx.sky(0, 0, 0.5), core: 1.2, tidal: 8, count: 700, bright: 0, faint: 11, population: 'young' });
    }
  },
  M8: {
    seed: 32,
    // 110 × 50 ly, with the Hourglass near Herschel 36, a dark lane and the young cluster NGC 6530.
    build: ctx => {
      const lane = (p: Vec3) => {
        const u = p[0] * ctx.e1[0] + p[1] * ctx.e1[1] + p[2] * ctx.e1[2];
        const v = p[0] * ctx.e2[0] + p[1] * ctx.e2[1] + p[2] * ctx.e2[2];
        return Math.abs(u * 0.35 + v - 2) < 2.2 && u > -6 && u < 22;
      };
      ctx.cloud({ radii: [55, 24, 20], count: 5200, clumps: 22, colour: emission(0.12), alpha: 0.12, size: 4.2, exclude: lane });
      ctx.cloud({ centre: ctx.sky(-12, 0, 0), radii: [3, 2.2, 2], count: 420, clumps: 3, colour: () => HOT_CORE, alpha: 0.2, size: 0.9 });
      ctx.stars.add(ctx.sky(-12, 0, 0), -5.4, -0.3); // Herschel 36
      ctx.cluster({ centre: ctx.sky(14, 4, 0), core: 4, tidal: 16, count: 420, bright: -4.5, faint: 6, population: 'young' });
    }
  },
  M20: {
    seed: 33,
    // Emission lobe split into three by dark dust lanes, plus a reflection lobe to the north.
    build: ctx => {
      const lanes = [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6];
      const dark = (p: Vec3) => {
        const u = p[0] * ctx.e1[0] + p[1] * ctx.e1[1] + p[2] * ctx.e1[2];
        const v = p[0] * ctx.e2[0] + p[1] * ctx.e2[1] + p[2] * ctx.e2[2];
        if (Math.hypot(u, v) < 1.2) return false;
        const angle = Math.atan2(v, u);
        return lanes.some(l => Math.abs(Math.atan2(Math.sin(angle - l), Math.cos(angle - l))) * Math.hypot(u, v) < 0.9);
      };
      ctx.cloud({ radii: [14, 14, 10], count: 3600, clumps: 12, colour: emission(0.18), alpha: 0.14, size: 1.6, exclude: dark });
      ctx.cloud({ centre: ctx.sky(0, 19, -2), radii: [11, 9, 8], count: 1300, clumps: 6, colour: () => PALETTE.cream, alpha: 0.06, size: 1.8 });
      ctx.stars.add([0, 0, 0], -4.6, -0.3); // HD 164492, the ionising O star
    }
  },
  M16: {
    seed: 34,
    // 70 × 55 ly around NGC 6611; the Pillars of Creation are dark columns with bright, evaporating rims.
    build: ctx => {
      const base = ctx.sky(5, -6, 1);
      const cluster = ctx.sky(-6, 6, 0);
      const toward = normalize([cluster[0] - base[0], cluster[1] - base[1], cluster[2] - base[2]]);
      const pillars = [[-1.2, 4.2, 0.45], [0.3, 3.0, 0.38], [1.6, 2.2, 0.34]].map(([du, length, radius]) => {
        const a = add(base, ctx.sky(du, 0, 0));
        return { a, b: add(a, scale(toward, length)), radius };
      });
      const inPillar = (p: Vec3) => pillars.some(pl => segmentDistance(p, pl.a, pl.b) < pl.radius);
      ctx.cloud({ radii: [35, 27, 20], count: 4800, clumps: 18, colour: emission(0.15), alpha: 0.12, size: 3, exclude: inPillar });
      const rand = ctx.rand;
      for (const pl of pillars) {
        for (let k = 0; k < 260; k += 1) {
          const t = rand();
          const axis = add(pl.a, scale([pl.b[0] - pl.a[0], pl.b[1] - pl.a[1], pl.b[2] - pl.a[2]], t));
          const d = randomDirection(rand);
          const rim = add(axis, scale(d, pl.radius * (1.02 + rand() * 0.12)));
          // The side facing the cluster is lit; the far side stays dark.
          const facing = d[0] * toward[0] + d[1] * toward[1] + d[2] * toward[2];
          ctx.glow(rim, HOT_CORE, 0.1 + 0.18 * Math.max(0, facing + 0.3), 0.18);
        }
      }
      ctx.cluster({ centre: cluster, core: 3, tidal: 15, count: 420, bright: -5.5, faint: 6, population: 'young' });
    }
  },
  'NGC 3372': {
    seed: 35,
    // The Carina Nebula: Eta Carinae, the Keyhole, and the clusters Trumpler 14 and 16.
    build: ctx => {
      const keyhole = ctx.sky(3, -3, 0);
      ctx.cloud({ radii: [115, 80, 60], count: 7000, clumps: 30, colour: emission(0.1), alpha: 0.1, size: 7, exclude: p => Math.hypot(p[0] - keyhole[0], p[1] - keyhole[1], p[2] - keyhole[2]) < 5 });
      const rand = ctx.rand;
      for (let k = 0; k < 500; k += 1) ctx.glow(add(keyhole, scale(randomDirection(rand), 5.3 + rand() * 0.6)), HOT_CORE, 0.1, 0.8);
      ctx.stars.add([0, 0, 0], -8.3, 0.6); // Eta Carinae
      ctx.cloud({ radii: [0.35, 0.22, 0.22], count: 140, clumps: 2, colour: () => HOT_CORE, alpha: 0.3, size: 0.08 }); // Homunculus
      ctx.cluster({ centre: ctx.sky(-12, 9, 0), core: 2.5, tidal: 12, count: 420, bright: -6, faint: 5, population: 'young' });
      ctx.cluster({ centre: ctx.sky(4, 1, 0), core: 4, tidal: 18, count: 420, bright: -6, faint: 5, population: 'young' });
    }
  },
  // ---------------------------------------------------------------- planetary nebulae
  'NGC 7293': {
    seed: 41,
    // The Helix: two nearly face-on rings, a faint inner disc, and cometary knots on the inner rim.
    build: ctx => {
      const rand = ctx.rand;
      for (const [radius, inc, pa, count] of [[0.85, 18, 0.4, 2600], [1.25, 32, 2.1, 1800]] as const) {
        const { a, b } = ctx.axisFrame(inc, pa);
        for (let k = 0; k < count; k += 1) {
          const theta = rand() * Math.PI * 2;
          const r = radius * (1 + gaussian(rand) * 0.09);
          const p = add(add(scale(a, Math.cos(theta) * r), scale(b, Math.sin(theta) * r)), scale(ctx.los, gaussian(rand) * 0.08));
          ctx.glow(p, mixColour(H_ALPHA, HOT_CORE, Math.max(0, 1 - r / radius) * 3), 0.16, 0.07);
        }
      }
      ctx.cloud({ radii: [0.6, 0.6, 0.4], count: 900, clumps: 3, colour: () => HOT_CORE, alpha: 0.05, size: 0.12 });
      const { a, b } = ctx.axisFrame(18, 0.4);
      for (let k = 0; k < 420; k += 1) {
        const theta = rand() * Math.PI * 2;
        const head = 0.62 + rand() * 0.12;
        for (let s = 0; s < 3; s += 1) {
          const r = head + s * 0.03;
          ctx.glow(add(scale(a, Math.cos(theta) * r), scale(b, Math.sin(theta) * r)), s === 0 ? HOT_CORE : H_ALPHA_DEEP, s === 0 ? 0.3 : 0.12, 0.012);
        }
      }
      ctx.stars.add([0, 0, 0], 6.5, -0.4); // white dwarf
    }
  },
  M27: {
    seed: 42,
    // The Dumbbell: a bipolar shell seen nearly edge-on, brightest in two lobes ("apple core").
    build: ctx => {
      const rand = ctx.rand;
      const { a, b, n } = ctx.axisFrame(80, 1.1);
      for (let k = 0; k < 5200; k += 1) {
        // Two filled lobes along the axis; the waist between them is pinched.
        const z = (rand() * 2 - 1) * 1.2;
        const waist = 0.32 + 0.45 * Math.min(1, Math.abs(z) / 0.9);
        const rho = waist * Math.sqrt(rand()) * (1 - Math.pow(Math.abs(z) / 1.25, 4));
        const theta = rand() * Math.PI * 2;
        const p = add(add(scale(a, Math.cos(theta) * rho), scale(b, Math.sin(theta) * rho)), scale(n, z));
        const edge = Math.min(1, rho / waist);
        ctx.glow(p, mixColour(HOT_CORE, H_ALPHA, edge * 0.8 + Math.abs(z) * 0.2), 0.1, 0.07);
      }
      ctx.cloud({ radii: [1.3, 1.3, 1.1], count: 900, clumps: 3, colour: () => H_ALPHA_DEEP, alpha: 0.035, size: 0.25 }); // faint halo
      ctx.stars.add([0, 0, 0], 5.2, -0.4);
    }
  },
  M57: {
    seed: 43,
    // The Ring: a barrel-shaped shell seen roughly along its axis; red outside, hotter inside.
    build: ctx => {
      const rand = ctx.rand;
      const { a, b, n } = ctx.axisFrame(30, 0.7);
      for (let k = 0; k < 3600; k += 1) {
        const theta = rand() * Math.PI * 2;
        const z = gaussian(rand) * 0.22;
        const r = 0.42 * (1 + gaussian(rand) * 0.08) * (1 - 0.25 * z * z);
        const outer = Math.max(0, Math.min(1, (r - 0.36) / 0.12));
        const p = add(add(scale(a, Math.cos(theta) * r), scale(b, Math.sin(theta) * r * 0.85)), scale(n, z));
        ctx.glow(p, mixColour(HOT_CORE, H_ALPHA, outer), 0.15, 0.04);
      }
      ctx.cloud({ radii: [0.3, 0.26, 0.3], count: 600, clumps: 2, colour: () => HOT_CORE, alpha: 0.04, size: 0.08 });
      ctx.cloud({ radii: [0.7, 0.62, 0.6], count: 700, clumps: 3, colour: () => H_ALPHA_DEEP, alpha: 0.025, size: 0.12 }); // halo
      ctx.stars.add([0, 0, 0], 6, -0.4);
    }
  },
  // ---------------------------------------------------------------- supernova remnant
  M1: {
    seed: 51,
    // The Crab: an 11 × 7 ly shell of red filaments around synchrotron light powered by the pulsar.
    build: ctx => {
      const rand = ctx.rand;
      const { a, b, n } = ctx.axisFrame(85, 2.3);
      const shell = (d: Vec3, r: number): Vec3 => add(add(scale(a, d[0] * r * 3.6), scale(b, d[1] * r * 3.4)), scale(n, d[2] * r * 5.5));
      for (let f = 0; f < 140; f += 1) {
        // Each filament is a wandering arc on the shell.
        let d = randomDirection(rand);
        const step = randomDirection(rand);
        for (let s = 0; s < 40; s += 1) {
          d = normalize(add(d, scale(add(step, scale(randomDirection(rand), 0.6)), 0.05)));
          ctx.glow(shell(d, 0.85 + gaussian(rand) * 0.06), s % 4 === 0 ? H_ALPHA : H_ALPHA_DEEP, 0.3, 0.22);
        }
      }
      for (let k = 0; k < 2600; k += 1) {
        const d = randomDirection(rand);
        const r = Math.pow(rand(), 0.6) * 0.8;
        ctx.glow(shell(d, r), mixColour(PALETTE.cream, PALETTE.amber, r), 0.035 * (1 - r * 0.6), 0.35);
      }
      ctx.stars.add([0, 0, 0], 5.5, -0.2); // the Crab Pulsar
    }
  }
};

/** One catalogue object's model, drawn in its own frame. */
class DeepSkyModel implements Layer {
  readonly group = new Group();
  readonly origin: Vec3;
  private starMaterial = createStarMaterial();
  private dustMaterial = createDustMaterial({ maxPx: 70, minPx: 1.1, falloff: 3.2, energy: 2 });
  /** The whole object as one point of its integrated light, for when it is unresolved. */
  private integrated: ReturnType<typeof createStarMaterial> | null = null;
  private readonly radius: number;

  constructor(object: AtlasObject, model: { seed: number; totalAbsMag?: number; build: (ctx: Context) => void }) {
    this.origin = [...object.pos];
    this.radius = object.extent;
    const ctx = new Context(object, model.seed);
    model.build(ctx);
    if (ctx.stars.count) {
      const stars = ctx.stars.build(this.starMaterial);
      stars.renderOrder = 21;
      this.group.add(stars);
    }
    if (ctx.dust.count) {
      const dust = ctx.dust.build(this.dustMaterial);
      dust.renderOrder = 12;
      this.group.add(dust);
    }
    const totalAbsMag = model.totalAbsMag ?? (object.mag !== undefined ? object.mag - ctx.dm : undefined);
    if (totalAbsMag !== undefined && (object.kind === 'cluster' || object.kind === 'globular')) {
      this.integrated = createStarMaterial();
      const point = new StarBuilder();
      point.add([0, 0, 0], totalAbsMag, object.kind === 'globular' ? 0.75 : 0.35);
      const mesh = point.build(this.integrated);
      mesh.renderOrder = 21;
      this.group.add(mesh);
    }
  }

  update(frame: FrameState): void {
    const local: Vec3 = [frame.cameraWorld[0] - this.origin[0], frame.cameraWorld[1] - this.origin[1], frame.cameraWorld[2] - this.origin[2]];
    const distance = Math.max(Math.hypot(local[0], local[1], local[2]), 1e-6);
    // Fade with the stars layer as the view widens to the whole Milky Way.
    const visible = logWindow(frame.logR, -9, -8, 4.2, 4.9);
    // Unresolved (a few pixels across): members hand over to one point of integrated light.
    const pixels = (this.radius * frame.pixelScale) / distance;
    const unresolved = 1 - smoothstep(2.5, 10, pixels);

    const s = this.starMaterial.uniforms;
    s.uCamPos.value.set(local[0], local[1], local[2]);
    s.uDpr.value = frame.dpr;
    s.uOpacity.value = visible * (this.integrated ? 1 - unresolved : 1);
    if (this.integrated) {
      const g = this.integrated.uniforms;
      g.uCamPos.value.set(local[0], local[1], local[2]);
      g.uDpr.value = frame.dpr;
      g.uOpacity.value = visible * unresolved;
    }
    const d = this.dustMaterial.uniforms;
    d.uPixelScale.value = frame.pixelScale;
    d.uDpr.value = frame.dpr;
    d.uOpacity.value = visible;
    this.group.visible = visible > 0.003;
  }
}

/** Models for every catalogue object that has one. */
export function createDeepSkyModels(objects: AtlasObject[]): Layer[] {
  return objects.filter(object => MODELS[object.id]).map(object => new DeepSkyModel(object, MODELS[object.id]));
}

/** Catalogue ids with a physical model (for tests). */
export const MODELLED_IDS = Object.keys(MODELS);
