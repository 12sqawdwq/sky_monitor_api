import { AdditiveBlending, CanvasTexture, Group, NormalBlending, Sprite, SpriteMaterial } from 'three';
import { createDustMaterial, PALETTE } from '../core/materials';
import { GALACTIC_CENTRE_LY, type Vec3 } from '../core/coords';
import { gaussian, logWindow, mulberry32, smoothstep } from '../core/units';
import { mixColour, ParticleBuilder } from './particles';
import type { Annotation, FrameState, Layer } from './types';

// Procedural Milky Way in galactocentric coordinates. The Sun sits at
// (-R0, 0) in the galactic x/y plane; the disc rotates clockwise seen from the
// North Galactic Pole, so trailing arms wind outwards counter-clockwise.
const R0 = GALACTIC_CENTRE_LY;
const PITCH = Math.tan((13 * Math.PI) / 180);
const BAR_ANGLE = Math.PI - (27 * Math.PI) / 180;

interface Arm {
  key: string;
  zh: string;
  en: string;
  /** Radius where the arm crosses the Sun–anticentre direction (theta = pi). */
  rAtSun: number;
  weight: number;
  labelR: number;
}

const ARMS: Arm[] = [
  { key: 'perseus', zh: '英仙臂', en: 'Perseus Arm', rAtSun: 32800, weight: 1.0, labelR: 39000 },
  { key: 'sagittarius', zh: '人马–船底臂', en: 'Sagittarius–Carina Arm', rAtSun: 23500, weight: 0.62, labelR: 31000 },
  { key: 'scutum', zh: '盾牌–半人马臂', en: 'Scutum–Centaurus Arm', rAtSun: 16800, weight: 1.0, labelR: 24000 },
  { key: 'norma', zh: '矩尺臂 · 外臂', en: 'Norma–Outer Arm', rAtSun: 12050, weight: 0.55, labelR: 47000 }
];

function armTheta(arm: Arm, r: number): number {
  return Math.PI + Math.log(r / arm.rAtSun) / PITCH;
}

/** Galactocentric (gx, gy, gz) -> layer-local scene axes. */
function local(gx: number, gy: number, gz: number): Vec3 {
  return [gx, gz, -gy];
}

function exponentialRadius(rand: () => number, scale: number, min: number, max: number): number {
  for (;;) {
    const r = -Math.log(1 - rand()) * scale + min * 0.6;
    if (r >= min && r <= max) return r;
  }
}

function coreTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,236,200,0.95)');
  g.addColorStop(0.18, 'rgba(232,186,120,0.45)');
  g.addColorStop(0.5, 'rgba(197,138,85,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new CanvasTexture(canvas);
}

export class GalaxyLayer implements Layer {
  readonly group = new Group();
  readonly origin: Vec3 = [R0, 0, 0];
  readonly annotations: Annotation[] = [];
  private stars = createDustMaterial({ maxPx: 70, minPx: 1.2, falloff: 3.6, energy: 2 });
  private dust = createDustMaterial({ maxPx: 80, minPx: 1.5, falloff: 2.4, energy: 2 });
  private halo = createDustMaterial({ fixedPx: 2.2, minPx: 1, maxPx: 4, falloff: 2 });
  private core: Sprite;

  constructor() {
    const rand = mulberry32(20260620);
    const bright = new ParticleBuilder();
    const dark = new ParticleBuilder();
    const sunLocal: Vec3 = local(-R0, 0, 0);
    const nearSun = (p: Vec3, limit: number) =>
      Math.hypot(p[0] - sunLocal[0], p[1] - sunLocal[1], p[2] - sunLocal[2]) < limit;

    const addBright = (p: Vec3, colour = PALETTE.cream, alpha = 0.1, size = 230) => {
      if (!nearSun(p, 650)) bright.add(p, colour, alpha, size);
    };

    // Bulge and bar.
    const barCos = Math.cos(BAR_ANGLE);
    const barSin = Math.sin(BAR_ANGLE);
    for (let k = 0; k < 34000; k += 1) {
      const isBar = rand() < 0.62;
      const x = gaussian(rand) * (isBar ? 6200 : 3200);
      const y = gaussian(rand) * (isBar ? 2000 : 3000);
      const z = gaussian(rand) * (isBar ? 1100 : 2400);
      const gx = x * barCos - y * barSin;
      const gy = x * barSin + y * barCos;
      const t = Math.min(1, Math.hypot(x, y) / 9000);
      addBright(local(gx, gy, z), mixColour(PALETTE.cream, PALETTE.amber, 0.35 + t * 0.4), 0.13, 260);
    }

    // Spiral arms.
    const totalWeight = ARMS.reduce((sum, arm) => sum + arm.weight, 0);
    for (let k = 0; k < 120000; k += 1) {
      let pick = rand() * totalWeight;
      const arm = ARMS.find(a => (pick -= a.weight) <= 0) ?? ARMS[0];
      const r = exponentialRadius(rand, 13000, 6200, 56000);
      const theta = armTheta(arm, r) + gaussian(rand) * 0.03;
      const spread = 800 + r * 0.045;
      const across = gaussian(rand) * spread;
      const along = gaussian(rand) * spread * 0.4;
      const cx = r * Math.cos(theta);
      const cy = r * Math.sin(theta);
      const nx = Math.cos(theta);
      const ny = Math.sin(theta);
      const gx = cx + nx * across - ny * along;
      const gy = cy + ny * across + nx * along;
      const gz = gaussian(rand) * (260 + r * 0.008);
      const knot = rand() < 0.055;
      if (knot) {
        addBright(local(gx, gy, gz), rand() < 0.5 ? PALETTE.rose : PALETTE.ember, 0.34, 120);
      } else {
        addBright(local(gx, gy, gz), mixColour(PALETTE.cream, PALETTE.amber, rand() * 0.45), 0.095, 240);
      }
      // Dust lanes trace the inner edge of the arms.
      if (rand() < 0.22 && r < 46000) {
        const lane = -spread * 0.9 + gaussian(rand) * spread * 0.35;
        const p = local(cx + nx * lane, cy + ny * lane, gaussian(rand) * 150);
        if (!nearSun(p, 1800)) dark.add(p, PALETTE.ember.clone().multiplyScalar(0.05), 0.2, 420);
      }
    }

    // Orion Spur: the short local arm the Sun lives on.
    for (let k = 0; k < 9000; k += 1) {
      const theta = Math.PI - 0.5 + rand() * 0.85;
      const r = R0 + 450 + (theta - Math.PI) * 2600 + gaussian(rand) * 650;
      const gz = gaussian(rand) * 280;
      addBright(local(r * Math.cos(theta), r * Math.sin(theta), gz), mixColour(PALETTE.cream, PALETTE.amber, rand() * 0.3), 0.08, 200);
    }

    // Diffuse disc between the arms.
    for (let k = 0; k < 48000; k += 1) {
      const r = exponentialRadius(rand, 12000, 4000, 60000);
      const theta = rand() * Math.PI * 2;
      const gz = gaussian(rand) * (500 + r * 0.01);
      addBright(local(r * Math.cos(theta), r * Math.sin(theta), gz), mixColour(PALETTE.amber, PALETTE.copper, rand() * 0.6), 0.045, 320);
    }

    const halo = new ParticleBuilder();
    for (let k = 0; k < 160; k += 1) {
      const r = 3000 + Math.pow(rand(), 2.2) * 70000;
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      halo.add(local(r * s * Math.cos(phi), r * s * Math.sin(phi), r * u), PALETTE.cream, 0.7, 1);
    }

    const brightPoints = bright.build(this.stars);
    brightPoints.renderOrder = 10;
    const darkPoints = dark.build(this.dust);
    darkPoints.renderOrder = 11;
    this.dust.blending = NormalBlending;
    const haloPoints = halo.build(this.halo);
    haloPoints.renderOrder = 12;
    this.group.add(brightPoints, darkPoints, haloPoints);

    this.core = new Sprite(new SpriteMaterial({ map: coreTexture(), blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
    this.core.scale.set(26000, 26000, 1);
    this.core.renderOrder = 9;
    this.group.add(this.core);

    for (const arm of ARMS) {
      const theta = armTheta(arm, arm.labelR);
      const p = local(arm.labelR * Math.cos(theta), arm.labelR * Math.sin(theta), 0);
      this.annotations.push({ key: `arm:${arm.key}`, zh: arm.zh, en: arm.en, pos: [p[0] + R0, p[1], p[2]], window: [3.9, 6.1], priority: 2, style: 'region' });
    }
    const spur = local((R0 + 800) * Math.cos(Math.PI + 0.22), (R0 + 800) * Math.sin(Math.PI + 0.22), 0);
    this.annotations.push({ key: 'arm:orion', zh: '猎户臂 · 本地臂', en: 'Orion Spur', pos: [spur[0] + R0, spur[1], spur[2]], window: [3.4, 5.4], priority: 2.4, style: 'region' });
    const barEnd = local(Math.cos(BAR_ANGLE + Math.PI) * 11000, Math.sin(BAR_ANGLE + Math.PI) * 11000, 0);
    this.annotations.push({ key: 'bar', zh: '中央棒', en: 'Galactic Bar', pos: [barEnd[0] + R0, barEnd[1], barEnd[2]], window: [4.3, 5.9], priority: 1.6, style: 'region' });
  }

  update(frame: FrameState): void {
    // Seen from inside, the disc reads as the Milky Way band across the sky.
    const opacity = (0.32 + 0.68 * smoothstep(2.6, 4.1, frame.logR)) * (1 - smoothstep(8.1, 9.2, frame.logR));
    this.stars.uniforms.uOpacity.value = opacity;
    this.dust.uniforms.uOpacity.value = opacity * smoothstep(3.4, 4.4, frame.logR);
    this.halo.uniforms.uOpacity.value = logWindow(frame.logR, 3.9, 4.6, 6.2, 7.0);
    for (const material of [this.stars, this.dust, this.halo]) {
      material.uniforms.uPixelScale.value = frame.pixelScale;
      material.uniforms.uDpr.value = frame.dpr;
    }
    this.core.material.opacity = logWindow(frame.logR, 2.8, 4.0, 7.6, 8.6) * 0.9;
    this.group.visible = opacity > 0.003;
  }
}
