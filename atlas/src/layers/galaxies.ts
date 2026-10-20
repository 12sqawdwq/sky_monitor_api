import { Color, Group } from 'three';
import { createDustMaterial, PALETTE } from '../core/materials';
import { galacticToScene, GALACTIC_CENTRE_LY, type Vec3 } from '../core/coords';
import { gaussian, logWindow, mulberry32, smoothstep } from '../core/units';
import { LOCAL_GROUP, NEARBY_UNIVERSE } from '../data/objects';
import { mixColour, ParticleBuilder } from './particles';
import type { FrameState, Layer } from './types';

type Morphology = 'spiral' | 'irregular' | 'elliptical' | 'dwarf' | 'sombrero';

interface Shape {
  morphology: Morphology;
  /** Inclination of the disc to the line of sight, degrees (0 = face-on). */
  inc: number;
  count: number;
}

const SHAPES: Record<string, Shape> = {
  M31: { morphology: 'spiral', inc: 77, count: 20000 },
  M33: { morphology: 'spiral', inc: 55, count: 4500 },
  M81: { morphology: 'spiral', inc: 59, count: 4200 },
  M101: { morphology: 'spiral', inc: 18, count: 4800 },
  M51: { morphology: 'spiral', inc: 22, count: 4000 },
  'NGC 253': { morphology: 'spiral', inc: 78, count: 3000 },
  M104: { morphology: 'sombrero', inc: 84, count: 3600 },
  LMC: { morphology: 'irregular', inc: 35, count: 4200 },
  SMC: { morphology: 'irregular', inc: 64, count: 2400 },
  'NGC 6822': { morphology: 'irregular', inc: 50, count: 900 },
  'IC 1613': { morphology: 'irregular', inc: 38, count: 800 },
  'IC 10': { morphology: 'irregular', inc: 30, count: 700 },
  WLM: { morphology: 'irregular', inc: 70, count: 700 },
  'Leo A': { morphology: 'irregular', inc: 50, count: 500 },
  M87: { morphology: 'elliptical', inc: 0, count: 4500 },
  'Cen A': { morphology: 'elliptical', inc: 0, count: 3200 },
  M32: { morphology: 'elliptical', inc: 0, count: 900 },
  M110: { morphology: 'elliptical', inc: 0, count: 1200 },
  'NGC 185': { morphology: 'elliptical', inc: 0, count: 700 },
  'NGC 147': { morphology: 'elliptical', inc: 0, count: 700 }
};

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function basis(los: Vec3, incDeg: number, pa: number): { e1: Vec3; e2: Vec3; n: Vec3 } {
  let a = cross(los, [0, 1, 0]);
  if (Math.hypot(a[0], a[1], a[2]) < 1e-6) a = cross(los, [1, 0, 0]);
  a = normalize(a);
  const b = cross(a, los);
  const inc = (incDeg * Math.PI) / 180;
  const tilt: Vec3 = [
    b[0] * Math.cos(pa) + a[0] * Math.sin(pa),
    b[1] * Math.cos(pa) + a[1] * Math.sin(pa),
    b[2] * Math.cos(pa) + a[2] * Math.sin(pa)
  ];
  const n = normalize([
    -los[0] * Math.cos(inc) + tilt[0] * Math.sin(inc),
    -los[1] * Math.cos(inc) + tilt[1] * Math.sin(inc),
    -los[2] * Math.cos(inc) + tilt[2] * Math.sin(inc)
  ]);
  let e1 = cross(n, los);
  if (Math.hypot(e1[0], e1[1], e1[2]) < 1e-6) e1 = a;
  e1 = normalize(e1);
  return { e1, e2: cross(n, e1), n };
}

/** Particle models of the Local Group members and the brighter nearby galaxies. */
export class GalaxiesLayer implements Layer {
  readonly group = new Group();
  readonly origin: Vec3 = [0, 0, 0];
  private material = createDustMaterial({ maxPx: 60, minPx: 1.2, falloff: 3.4, energy: 2 });
  // One soft glow per galaxy so they stay findable once their discs are sub-pixel.
  private glow = createDustMaterial({ maxPx: 18, minPx: 4, falloff: 4.5 });

  constructor() {
    const builder = new ParticleBuilder();
    const rand = mulberry32(31);
    const entries = [...LOCAL_GROUP, ...NEARBY_UNIVERSE].filter(entry => entry.kind === 'galaxy');

    for (const entry of entries) {
      const centre = galacticToScene(entry.l, entry.b, entry.ly);
      const R = entry.diameter / 2;
      const shape = SHAPES[entry.id] ?? { morphology: 'dwarf', inc: 0, count: Math.round(220 + Math.min(500, R / 6)) };
      const { e1, e2, n } = basis(normalize(centre), shape.inc, rand() * Math.PI * 2);
      const put = (u: number, v: number, w: number, colour: Color, alpha: number, size: number) => {
        builder.add(
          [
            centre[0] + e1[0] * u + e2[0] * v + n[0] * w,
            centre[1] + e1[1] * u + e2[1] * v + n[1] * w,
            centre[2] + e1[2] * u + e2[2] * v + n[2] * w
          ],
          colour,
          alpha,
          size
        );
      };

      switch (shape.morphology) {
        case 'spiral':
        case 'sombrero': {
          const sombrero = shape.morphology === 'sombrero';
          const bulge = Math.round(shape.count * (sombrero ? 0.55 : 0.25));
          for (let k = 0; k < bulge; k += 1) {
            const s = R * (sombrero ? 0.32 : 0.14);
            put(gaussian(rand) * s, gaussian(rand) * s, gaussian(rand) * s * (sombrero ? 0.7 : 0.6), mixColour(PALETTE.cream, PALETTE.amber, 0.5), 0.07, R * 0.04);
          }
          const pitch = Math.tan((sombrero ? 6 : 16) * Math.PI / 180);
          for (let k = bulge; k < shape.count; k += 1) {
            const r = R * Math.min(1, 0.08 + -Math.log(1 - rand()) * 0.28);
            const arm = rand() < 0.5 ? 0 : Math.PI;
            const theta = arm + Math.log(r / (R * 0.1)) / pitch + gaussian(rand) * (sombrero ? 1.4 : 0.32);
            const knot = !sombrero && rand() < 0.06;
            put(r * Math.cos(theta), r * Math.sin(theta), gaussian(rand) * R * 0.012,
              knot ? PALETTE.rose : mixColour(PALETTE.cream, PALETTE.amber, rand() * 0.4), knot ? 0.4 : 0.1, R * (knot ? 0.016 : 0.032));
          }
          if (sombrero) {
            for (let k = 0; k < shape.count * 0.15; k += 1) {
              const theta = rand() * Math.PI * 2;
              const r = R * (0.62 + gaussian(rand) * 0.04);
              put(r * Math.cos(theta), r * Math.sin(theta), 0, PALETTE.copper, 0.16, R * 0.03);
            }
          }
          break;
        }
        case 'irregular': {
          const clumps = Array.from({ length: 5 }, () => [gaussian(rand) * R * 0.35, gaussian(rand) * R * 0.25]);
          for (let k = 0; k < shape.count; k += 1) {
            const isBar = rand() < 0.3;
            const c = clumps[Math.floor(rand() * clumps.length)];
            const u = isBar ? gaussian(rand) * R * 0.38 : c[0] + gaussian(rand) * R * 0.28;
            const v = isBar ? gaussian(rand) * R * 0.1 : c[1] + gaussian(rand) * R * 0.24;
            const knot = rand() < 0.07;
            put(u, v, gaussian(rand) * R * 0.08, knot ? PALETTE.rose : mixColour(PALETTE.cream, PALETTE.amber, rand() * 0.3), knot ? 0.42 : 0.15, R * (knot ? 0.03 : 0.07));
          }
          break;
        }
        default: {
          const flat = shape.morphology === 'elliptical' ? 0.75 : 0.85;
          for (let k = 0; k < shape.count; k += 1) {
            const s = R * 0.3;
            put(gaussian(rand) * s, gaussian(rand) * s * flat, gaussian(rand) * s * flat,
              mixColour(PALETTE.amber, PALETTE.cream, rand() * 0.5), shape.morphology === 'dwarf' ? 0.12 : 0.17, R * 0.07);
          }
        }
      }
    }

    const points = builder.build(this.material);
    points.renderOrder = 13;

    const glows = new ParticleBuilder();
    glows.add([GALACTIC_CENTRE_LY, 0, 0], PALETTE.amber, 0.5, 90000);
    for (const entry of entries) {
      glows.add(galacticToScene(entry.l, entry.b, entry.ly), mixColour(PALETTE.amber, PALETTE.cream, 0.4), entry.diameter > 15000 ? 0.38 : 0.2, entry.diameter * 0.6);
    }
    const glowPoints = glows.build(this.glow);
    glowPoints.renderOrder = 14;
    this.group.add(points, glowPoints);
  }

  update(frame: FrameState): void {
    const u = this.material.uniforms;
    // Seen from inside the Milky Way these are faint smudges, not showpieces.
    u.uOpacity.value = (0.14 + 0.86 * smoothstep(2.8, 5.0, frame.logR)) * logWindow(frame.logR, -9, -8, 9.3, 10.1);
    u.uPixelScale.value = frame.pixelScale;
    u.uDpr.value = frame.dpr;
    const g = this.glow.uniforms;
    g.uOpacity.value = logWindow(frame.logR, 5.4, 6.3, 9.2, 10);
    g.uPixelScale.value = frame.pixelScale;
    g.uDpr.value = frame.dpr;
    this.group.visible = u.uOpacity.value > 0.003;
  }
}
