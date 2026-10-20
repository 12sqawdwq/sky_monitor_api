import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  Sprite,
  SpriteMaterial
} from 'three';
import { createDustMaterial, PALETTE } from '../core/materials';
import { daysSinceJ2000, eclipticToEquatorial, eclipticToScene, equatorialToRaDec, raDecToScene, type Vec3 } from '../core/coords';
import { AU_LY, gaussian, logWindow, mulberry32 } from '../core/units';
import type { AtlasObject } from '../data/objects';
import { ParticleBuilder } from './particles';
import type { FrameState, Layer } from './types';

const DEG = Math.PI / 180;

interface PlanetElements {
  id: string;
  zh: string;
  en: string;
  a: number;
  e: number;
  i: number;
  L: number;
  varpi: number;
  node: number;
  period: number;
  desc: string;
  facts: Array<[string, string]>;
}

// Mean J2000 elements (JPL approximate positions of the major planets).
const PLANETS: PlanetElements[] = [
  { id: 'mercury', zh: '水星', en: 'Mercury', a: 0.38710, e: 0.20563, i: 7.005, L: 252.25084, varpi: 77.45645, node: 48.33167, period: 87.969,
    desc: '离太阳最近、最小的行星，没有大气保温，昼夜温差超过 600 摄氏度。', facts: [['公转周期', '88 天']] },
  { id: 'venus', zh: '金星', en: 'Venus', a: 0.72333, e: 0.00677, i: 3.39471, L: 181.97973, varpi: 131.53298, node: 76.68069, period: 224.701,
    desc: '夜空中仅次于月亮的亮天体，古称“太白”。浓厚的二氧化碳大气使它成为太阳系最热的行星。', facts: [['公转周期', '225 天'], ['表面温度', '约 465 °C']] },
  { id: 'earth', zh: '地球', en: 'Earth', a: 1.00000, e: 0.01671, i: 0.00005, L: 100.46435, varpi: 102.94719, node: -11.26064, period: 365.256,
    desc: '你所在的地方。从这张图的任何尺度回望，都只能看到这一个点。', facts: [['日地距离', '1 天文单位 ≈ 8.3 光分']] },
  { id: 'mars', zh: '火星', en: 'Mars', a: 1.52368, e: 0.09340, i: 1.85061, L: 355.45332, varpi: 336.04084, node: 49.57854, period: 686.98,
    desc: '古称“荧惑”。表面的氧化铁让它呈现橙红色，奥林帕斯山是太阳系最高的火山。', facts: [['公转周期', '687 天']] },
  { id: 'jupiter', zh: '木星', en: 'Jupiter', a: 5.20260, e: 0.04849, i: 1.30530, L: 34.40438, varpi: 14.75385, node: 100.55615, period: 4332.59,
    desc: '太阳系最大的行星，质量是其余行星总和的 2.5 倍。双筒望远镜就能看到它的四颗伽利略卫星。', facts: [['公转周期', '11.9 年'], ['已知卫星', '90+']] },
  { id: 'saturn', zh: '土星', en: 'Saturn', a: 9.55491, e: 0.05551, i: 2.48446, L: 49.94432, varpi: 92.43194, node: 113.71504, period: 10759.22,
    desc: '拥有最壮观光环的气态巨行星，环宽约 28 万千米，厚度大多只有十几米。', facts: [['公转周期', '29.5 年']] },
  { id: 'uranus', zh: '天王星', en: 'Uranus', a: 19.21845, e: 0.04630, i: 0.76986, L: 313.23218, varpi: 170.96424, node: 74.22988, period: 30685.4,
    desc: '1781 年发现的第一颗“望远镜行星”，自转轴几乎躺倒在轨道面上。', facts: [['公转周期', '84 年']] },
  { id: 'neptune', zh: '海王星', en: 'Neptune', a: 30.11039, e: 0.00899, i: 1.76917, L: 304.88003, varpi: 44.97135, node: 131.72169, period: 60189,
    desc: '先由数学计算预言、后被望远镜找到的行星（1846 年）。风速可达每秒 2000 千米。', facts: [['公转周期', '165 年']] },
  { id: 'pluto', zh: '冥王星', en: 'Pluto', a: 39.48, e: 0.2488, i: 17.14, L: 238.93, varpi: 224.07, node: 110.30, period: 90560,
    desc: '柯伊伯带中最著名的矮行星。2015 年新视野号飞掠，看到了一颗心形的冰原。', facts: [['公转周期', '248 年'], ['分类', '矮行星']] }
];

const PROBES: Array<{ id: string; zh: string; en: string; ra: number; dec: number; au: number; desc: string; facts: Array<[string, string]> }> = [
  { id: 'voyager1', zh: '旅行者 1 号', en: 'Voyager 1', ra: 257.6, dec: 12.1, au: 169,
    desc: '1977 年发射，2012 年越过日球层顶，是离地球最远的人造物体，仍在以每秒约 17 千米的速度飞离太阳。', facts: [['发射', '1977 年 9 月'], ['速度', '约 17 km/s']] },
  { id: 'voyager2', zh: '旅行者 2 号', en: 'Voyager 2', ra: 300.4, dec: -59.6, au: 142,
    desc: '唯一造访过天王星和海王星的探测器，2018 年进入星际空间。', facts: [['发射', '1977 年 8 月']] },
  { id: 'newhorizons', zh: '新视野号', en: 'New Horizons', ra: 290.0, dec: -20.4, au: 62,
    desc: '2015 年飞掠冥王星、2019 年飞掠柯伊伯带天体“天涯海角”，正在柯伊伯带中继续远行。', facts: [['发射', '2006 年 1 月']] }
];

function solveKepler(M: number, e: number): number {
  let E = M;
  for (let k = 0; k < 8; k += 1) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

function orbitalPoint(p: PlanetElements, E: number): Vec3 {
  const omega = (p.varpi - p.node) * DEG;
  const node = p.node * DEG;
  const inc = p.i * DEG;
  const xv = p.a * (Math.cos(E) - p.e);
  const yv = p.a * Math.sqrt(1 - p.e * p.e) * Math.sin(E);
  const cosO = Math.cos(node);
  const sinO = Math.sin(node);
  const cosw = Math.cos(omega);
  const sinw = Math.sin(omega);
  const cosi = Math.cos(inc);
  return [
    xv * (cosO * cosw - sinO * sinw * cosi) - yv * (cosO * sinw + sinO * cosw * cosi),
    xv * (sinO * cosw + cosO * sinw * cosi) - yv * (sinO * sinw - cosO * cosw * cosi),
    xv * sinw * Math.sin(inc) + yv * cosw * Math.sin(inc)
  ];
}

function eclipticAt(p: PlanetElements, days: number): Vec3 {
  const M = ((p.L - p.varpi + (360 / p.period) * days) % 360) * DEG;
  return orbitalPoint(p, solveKepler(M, p.e));
}

function toSceneLy(v: Vec3): Vec3 {
  return eclipticToScene(v[0] * AU_LY, v[1] * AU_LY, v[2] * AU_LY);
}

function glowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,246,228,1)');
  g.addColorStop(0.12, 'rgba(255,214,150,0.65)');
  g.addColorStop(0.4, 'rgba(217,163,91,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

export class SolarLayer implements Layer {
  readonly group = new Group();
  readonly origin: Vec3 = [0, 0, 0];
  readonly objects: AtlasObject[] = [];
  private orbitMaterial = new LineBasicMaterial({ color: PALETTE.line, transparent: true, depthTest: false, depthWrite: false });
  private earthOrbitMaterial = new LineBasicMaterial({ color: PALETTE.copper, transparent: true, depthTest: false, depthWrite: false });
  private planetDots = createDustMaterial({ fixedPx: 5, minPx: 1, maxPx: 8, falloff: 2.2 });
  private kuiper = createDustMaterial({ maxPx: 6, minPx: 1.2 });
  private oort = createDustMaterial({ maxPx: 26, minPx: 1.1 });
  private sun: Sprite;

  constructor(date = new Date()) {
    const days = daysSinceJ2000(date);
    const earth = eclipticAt(PLANETS[2], days);
    const dots = new ParticleBuilder();

    for (const planet of PLANETS) {
      const points: number[] = [];
      for (let k = 0; k <= 360; k += 1) {
        const p = toSceneLy(orbitalPoint(planet, (k / 360) * Math.PI * 2));
        points.push(p[0], p[1], p[2]);
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
      const line = new LineLoop(geometry, planet.id === 'earth' ? this.earthOrbitMaterial : this.orbitMaterial);
      line.frustumCulled = false;
      this.group.add(line);

      const helio = eclipticAt(planet, days);
      const pos = toSceneLy(helio);
      dots.add(pos, planet.id === 'earth' ? PALETTE.copper : PALETTE.cream, 0.95, 1e-9);

      const geo: Vec3 = [helio[0] - earth[0], helio[1] - earth[1], helio[2] - earth[2]];
      const radec = planet.id === 'earth' ? undefined : equatorialToRaDec(eclipticToEquatorial(geo[0], geo[1], geo[2]));
      this.objects.push({
        id: planet.id,
        zh: planet.zh,
        en: planet.en,
        kind: 'planet',
        pos,
        extent: Math.max(0.18, planet.a * 0.12) * AU_LY,
        ra: radec?.ra,
        dec: radec?.dec,
        desc: planet.desc,
        facts: [['轨道半长轴', `${planet.a.toFixed(2)} 天文单位`], ...planet.facts],
        label: [-6, -1.9],
        priority: planet.id === 'earth' ? 3.5 : 2.6 - planet.a * 0.01
      });
    }

    for (const probe of PROBES) {
      const pos = raDecToScene(probe.ra, probe.dec, probe.au * AU_LY);
      dots.add(pos, PALETTE.copper, 0.85, 1e-9);
      this.objects.push({
        id: probe.id,
        zh: probe.zh,
        en: probe.en,
        kind: 'probe',
        pos,
        extent: 4 * AU_LY,
        desc: probe.desc,
        facts: [['距太阳', `约 ${probe.au} 天文单位`], ...probe.facts],
        label: [-3.9, -1.6],
        priority: 1.6
      });
    }

    this.objects.push({
      id: 'sun',
      zh: '太阳',
      en: 'The Sun · Sol',
      kind: 'sun',
      pos: [0, 0, 0],
      extent: 16 * AU_LY,
      absmag: 4.83,
      spect: 'G2V',
      desc: '一颗普通的 G2 型主序星，已经稳定燃烧约 46 亿年，还将持续约 50 亿年。太阳系 99.86% 的质量都集中在它身上。在这张图上，它就是“你在这里”。',
      facts: [['年龄', '约 46 亿年'], ['表面温度', '5772 K'], ['距银心', '约 2.67 万光年']],
      label: [-6, 4.2],
      priority: 6,
      distance: 0
    });

    const planetPoints = dots.build(this.planetDots);
    planetPoints.renderOrder = 30;
    this.group.add(planetPoints);

    const rand = mulberry32(7);
    const belt = new ParticleBuilder();
    for (let k = 0; k < 9000; k += 1) {
      const a = 30 + rand() * 20 + (rand() < 0.3 ? gaussian(rand) * 2 : 0);
      const theta = rand() * Math.PI * 2;
      const z = gaussian(rand) * a * 0.06;
      belt.add(toSceneLy([a * Math.cos(theta), a * Math.sin(theta), z]), PALETTE.brass, 0.26, 0.35 * AU_LY);
    }
    this.group.add(belt.build(this.kuiper));

    const cloud = new ParticleBuilder();
    for (let k = 0; k < 26000; k += 1) {
      const inner = rand() < 0.35;
      const r = inner ? 2000 + rand() * 18000 : Math.pow(10, 4.2 + rand() * 0.8);
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const flatten = inner ? 0.35 : 1;
      const s = Math.sqrt(1 - u * u);
      cloud.add(toSceneLy([r * s * Math.cos(phi), r * s * Math.sin(phi), r * u * flatten]), PALETTE.inkDim, 0.16, 420 * AU_LY);
    }
    this.group.add(cloud.build(this.oort));

    this.sun = new Sprite(new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, color: new Color(1, 1, 1) }));
    this.sun.material.sizeAttenuation = false;
    this.sun.renderOrder = 25;
    this.group.add(this.sun);
  }

  update(frame: FrameState): void {
    const orbit = logWindow(frame.logR, -6, -5.6, -2.6, -1.8);
    this.orbitMaterial.opacity = orbit * 0.42;
    this.earthOrbitMaterial.opacity = orbit * 0.75;
    this.planetDots.uniforms.uOpacity.value = logWindow(frame.logR, -6, -5.6, -2.2, -1.5);
    this.kuiper.uniforms.uOpacity.value = logWindow(frame.logR, -4.6, -3.7, -2.0, -1.3);
    this.oort.uniforms.uOpacity.value = logWindow(frame.logR, -2.6, -1.6, 0.9, 1.7);
    for (const material of [this.planetDots, this.kuiper, this.oort]) {
      material.uniforms.uPixelScale.value = frame.pixelScale;
      material.uniforms.uDpr.value = frame.dpr;
    }
    const near = logWindow(frame.logR, -7, -6, -2.4, -1.2);
    this.sun.material.opacity = near;
    this.sun.scale.setScalar(0.05 + 0.1 * Math.max(0, Math.min(1, (-2.4 - frame.logR) / 2.6)));
    this.group.visible = frame.logR < 2;
  }
}

export interface GeocentricBody {
  id: string;
  zh: string;
  en: string;
  ra: number;
  dec: number;
  /** Distance from Earth, AU. */
  distance: number;
}

/** Geocentric RA/Dec of the planets (excluding Earth) at a given moment. */
export function geocentricPlanets(date: Date): GeocentricBody[] {
  const days = daysSinceJ2000(date);
  const earth = eclipticAt(PLANETS[2], days);
  return PLANETS.filter(p => p.id !== 'earth').map(planet => {
    const helio = eclipticAt(planet, days);
    const geo: Vec3 = [helio[0] - earth[0], helio[1] - earth[1], helio[2] - earth[2]];
    const radec = equatorialToRaDec(eclipticToEquatorial(geo[0], geo[1], geo[2]));
    return { id: planet.id, zh: planet.zh, en: planet.en, ra: radec.ra, dec: radec.dec, distance: Math.hypot(...geo) };
  });
}
