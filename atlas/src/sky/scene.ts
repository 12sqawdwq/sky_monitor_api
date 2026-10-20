import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix3,
  Mesh,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3
} from 'three';
import { PALETTE } from '../core/materials';
import { sceneToEquatorial } from '../core/coords';
import { STAR_STRIDE, type StarCatalog } from '../data/stars';
import { equatorialUnit } from './astro';
import { eclipticLongitudeAtRa, eclipticRaDec, ESSENTIAL_CONSTELLATIONS, ZODIAC_CONSTELLATIONS, type Mansion } from '../data/zodiac';

export type LineMode = 'essential' | 'all' | 'off';

const DEG = Math.PI / 180;
const SKY_R = 50;
const STAR_R = 40;
const LINE_R = 39.5;
const GRID_R = 39;
const ECLIPTIC_R = 39.2;
const MANSION_R = 39.4;
/** Half-width of the zodiac band, degrees of ecliptic latitude. */
const BAND = 8;
const GROUND_R = 30;

export interface ConstellationRecord {
  id: string;
  rank: number;
  label: [number, number] | null;
  lines: number[][];
}

const STAR_COLOUR_GLSL = /* glsl */ `
vec3 starColour(float ci) {
  float t = clamp((ci + 0.25) / 2.1, 0.0, 1.0);
  vec3 hot = vec3(1.0, 0.972, 0.925);
  vec3 sun = vec3(1.0, 0.866, 0.66);
  vec3 cool = vec3(1.0, 0.58, 0.34);
  return t < 0.42 ? mix(hot, sun, t / 0.42) : mix(sun, cool, (t - 0.42) / 0.58);
}
`;

const NOISE_GLSL = /* glsl */ `
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int k = 0; k < 4; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

/** Altitude of the ridge line, radians, as a function of azimuth (shared with the label layer). */
export function ridgeAltitude(azRad: number): number {
  return 0.014 + 0.011 * Math.sin(azRad * 3 + 1.3) + 0.007 * Math.sin(azRad * 7 + 0.4) + 0.004 * Math.sin(azRad * 13 + 2) + 0.002 * Math.sin(azRad * 29);
}

export class SkyScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(62, 1, 0.01, 200);
  /** Equatorial content; its matrix maps equatorial -> horizontal each frame. */
  readonly celestial = new Group();
  private skyMaterial: ShaderMaterial;
  private starMaterial: ShaderMaterial | null = null;
  private lineMaterial = new LineBasicMaterial({ color: PALETTE.copper, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false });
  private zodiacLineMaterial = new LineBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false });
  private minorLineMaterial = new LineBasicMaterial({ color: PALETTE.copper, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false });
  private eclipticMaterial = new LineBasicMaterial({ color: PALETTE.brass, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });
  private bandEdgeMaterial = new LineBasicMaterial({ color: PALETTE.brass, transparent: true, opacity: 0.12, depthTest: false, depthWrite: false });
  private bandMaterial: ShaderMaterial;
  private mansionLineMaterial = new LineBasicMaterial({ color: PALETTE.cinnabar, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });
  private mansionTickMaterial = new LineBasicMaterial({ color: PALETTE.cinnabar, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false });
  private mansions = new Group();
  /** Western figures step back while the Chinese mansions are shown. */
  private westernDim = 1;
  private gridMaterial = new LineBasicMaterial({ color: PALETTE.line, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false });
  private groundMaterial: ShaderMaterial;
  private lineGroups: { zodiac?: LineSegments; essential?: LineSegments; minor?: LineSegments } = {};
  private lineMode: LineMode = 'essential';
  private ecliptic = new Group();
  private grid: LineSegments;

  constructor() {
    this.camera.rotation.order = 'YXZ';
    this.celestial.matrixAutoUpdate = false;
    this.scene.add(this.celestial);

    // Equatorial -> galactic rotation for the Milky Way band (rows = galactic axes).
    const gal = new Matrix3().set(
      -0.0548755604, -0.8734370902, -0.4838350155,
      0.4941094279, -0.44482963, 0.7469822445,
      -0.867666149, -0.1980763734, 0.4559837762
    );
    this.skyMaterial = new ShaderMaterial({
      uniforms: {
        uSunDir: { value: new Vector3(0, -1, 0) },
        uMilky: { value: 1 },
        uGal: { value: gal }
      },
      vertexShader: /* glsl */ `
        varying vec3 vEq;
        varying vec3 vHor;
        void main() {
          vEq = normalize(position);
          vHor = normalize((modelMatrix * vec4(position, 1.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform float uMilky;
        uniform mat3 uGal;
        varying vec3 vEq;
        varying vec3 vHor;
        ${NOISE_GLSL}
        void main() {
          float alt = vHor.y;
          float sunAlt = uSunDir.y;
          float day = smoothstep(-0.105, 0.2, sunAlt);
          float twilight = smoothstep(-0.31, -0.06, sunAlt) * (1.0 - smoothstep(0.05, 0.35, sunAlt));
          vec2 flatSun = normalize(uSunDir.xz + 1e-5);
          vec2 flatDir = normalize(vHor.xz + 1e-5);
          float toward = max(dot(flatDir, flatSun), 0.0);
          float horizon = exp(-max(alt, 0.0) * 5.0);

          vec3 night = vec3(0.016, 0.014, 0.012);
          vec3 dayHigh = vec3(0.16, 0.125, 0.095);
          vec3 dayLow = vec3(0.34, 0.26, 0.18);
          vec3 colour = mix(night, mix(dayLow, dayHigh, smoothstep(0.0, 0.7, alt)), day);
          colour += vec3(0.62, 0.3, 0.13) * twilight * horizon * (0.18 + 0.82 * pow(toward, 2.5)) * 0.55;
          float sd = max(dot(vHor, normalize(uSunDir)), 0.0);
          colour += vec3(1.0, 0.82, 0.55) * (pow(sd, 900.0) * 3.0 + pow(sd, 24.0) * 0.25) * smoothstep(-0.12, 0.02, sunAlt);

          // Milky Way: brightness around the galactic equator, strongest towards the centre.
          vec3 g = uGal * vEq;
          float b = asin(clamp(g.z, -1.0, 1.0));
          float l = atan(g.y, g.x);
          float width = 0.085 + 0.11 * exp(-l * l * 1.4);
          float band = exp(-(b * b) / (width * width));
          float core = 0.4 + 0.6 * exp(-l * l * 0.8);
          float n = fbm(vEq * 11.0);
          float lane = 1.0 - 0.6 * exp(-((b + 0.012) * (b + 0.012)) / 0.0005) * exp(-l * l * 0.6);
          colour += vec3(0.95, 0.82, 0.62) * band * core * mix(0.45, 1.25, n) * lane * uMilky * 0.13;

          colour += vec3(0.07, 0.055, 0.04) * exp(-abs(alt) * 16.0) * (0.35 + day);
          gl_FragColor = vec4(colour, 1.0);
        }
      `,
      side: BackSide,
      depthTest: false,
      depthWrite: false
    });
    const sky = new Mesh(new SphereGeometry(SKY_R, 96, 48), this.skyMaterial);
    sky.renderOrder = 0;
    sky.frustumCulled = false;
    this.celestial.add(sky);

    this.grid = new LineSegments(this.buildGrid(), this.gridMaterial);
    this.grid.renderOrder = 3;
    this.grid.frustumCulled = false;
    this.grid.visible = false;
    this.scene.add(this.grid);

    this.bandMaterial = new ShaderMaterial({
      uniforms: { uOpacity: { value: 1 }, uSunLambda: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec2 band;
        varying vec2 vBand;
        void main() {
          vBand = band;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform float uSunLambda;
        varying vec2 vBand;
        void main() {
          // vBand = (ecliptic longitude in degrees, latitude / band half-width).
          float s = abs(vBand.y);
          float glow = exp(-s * s * 380.0) * 0.32 + exp(-s * s * 26.0) * 0.07;
          float fill = 0.03 * (1.0 - smoothstep(0.8, 1.0, s));
          // The house the Sun is in reads a little warmer.
          float d = abs(mod(vBand.x - floor(uSunLambda / 30.0) * 30.0 + 360.0, 360.0) - 15.0);
          float current = 1.0 - smoothstep(13.0, 15.0, d);
          vec3 colour = mix(vec3(0.72, 0.66, 0.33), vec3(0.85, 0.64, 0.36), current);
          gl_FragColor = vec4(colour, (glow + fill * (1.0 + current * 1.6)) * uOpacity);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending
    });
    const band = new Mesh(this.buildBand(), this.bandMaterial);
    const [ticks, edges] = this.buildEcliptic();
    const centre = new LineSegments(ticks, this.eclipticMaterial);
    const frame = new LineSegments(edges, this.bandEdgeMaterial);
    for (const part of [band, frame, centre]) {
      part.renderOrder = 5;
      part.frustumCulled = false;
      this.ecliptic.add(part);
    }
    this.celestial.add(this.ecliptic);
    this.mansions.visible = false;
    this.celestial.add(this.mansions);

    this.groundMaterial = new ShaderMaterial({
      uniforms: { uDay: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDay;
        varying vec3 vDir;
        void main() {
          float alt = asin(clamp(vDir.y, -1.0, 1.0));
          float az = atan(vDir.x, -vDir.z);
          float ridge = 0.014 + 0.011 * sin(az * 3.0 + 1.3) + 0.007 * sin(az * 7.0 + 0.4) + 0.004 * sin(az * 13.0 + 2.0) + 0.002 * sin(az * 29.0);
          if (alt > ridge) discard;
          vec3 ground = mix(vec3(0.028, 0.022, 0.017), vec3(0.11, 0.085, 0.06), uDay);
          float rim = smoothstep(ridge - 0.006, ridge, alt);
          vec3 colour = ground + vec3(0.77, 0.54, 0.33) * rim * 0.32;
          gl_FragColor = vec4(colour, 0.9 + rim * 0.1);
        }
      `,
      side: BackSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: NormalBlending
    });
    const ground = new Mesh(new SphereGeometry(GROUND_R, 128, 64, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), this.groundMaterial);
    ground.renderOrder = 6;
    ground.frustumCulled = false;
    this.scene.add(ground);
  }

  setStars(catalog: StarCatalog, limitMag = 6.6): number {
    const positions: number[] = [];
    const mags: number[] = [];
    const cis: number[] = [];
    const seeds: number[] = [];
    for (let i = 0; i < catalog.count; i += 1) {
      const base = i * STAR_STRIDE;
      const p: [number, number, number] = [catalog.buffer[base], catalog.buffer[base + 1], catalog.buffer[base + 2]];
      const d = Math.hypot(p[0], p[1], p[2]);
      const mag = catalog.buffer[base + 3] + 5 * (Math.log10(d / 3.261563777) - 1);
      if (!(mag < limitMag)) continue;
      const eq = sceneToEquatorial(p);
      positions.push((eq[0] / d) * STAR_R, (eq[1] / d) * STAR_R, (eq[2] / d) * STAR_R);
      mags.push(mag);
      cis.push(catalog.buffer[base + 4]);
      seeds.push(Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1));
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('mag', new BufferAttribute(new Float32Array(mags), 1));
    geometry.setAttribute('ci', new BufferAttribute(new Float32Array(cis), 1));
    geometry.setAttribute('seed', new BufferAttribute(new Float32Array(seeds), 1));
    this.starMaterial = new ShaderMaterial({
      uniforms: { uLimit: { value: 6 }, uScale: { value: 1 }, uDpr: { value: 1 }, uFade: { value: 1 }, uTime: { value: 0 }, uTwinkle: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float mag;
        attribute float ci;
        attribute float seed;
        uniform float uLimit;
        uniform float uScale;
        uniform float uDpr;
        uniform float uFade;
        uniform float uTime;
        uniform float uTwinkle;
        varying vec3 vColour;
        varying float vAlpha;
        varying float vGlare;
        ${STAR_COLOUR_GLSL}
        void main() {
          vec3 hor = normalize((modelMatrix * vec4(position, 1.0)).xyz);
          // Atmospheric extinction near the horizon.
          float airmass = 1.0 / max(hor.y + 0.025, 0.03);
          float m = mag + 0.12 * (airmass - 1.0);
          float b = clamp((uLimit - m) / 5.4, 0.0, 1.5);

          // Scintillation: a few incommensurate flickers per star, much stronger through
          // the thick air near the horizon.
          float low = clamp((airmass - 1.0) / 6.0, 0.0, 1.0);
          float t = uTime + seed * 97.0;
          float s = sin(t * (6.3 + seed * 4.0)) * 0.5 + sin(t * (11.7 + seed * 7.0) + 1.7) * 0.3 + sin(t * (19.1 + seed * 3.0) + 4.1) * 0.2;
          float flicker = 1.0 + uTwinkle * (0.07 + 0.4 * low) * s;

          // Colour: only bright stars wake the eye's cones; faint ones read as grey-white.
          vec3 base = starColour(ci);
          float saturation = 0.18 + 0.82 * smoothstep(4.6, 0.6, m);
          vColour = mix(vec3(0.93, 0.92, 0.9), base, saturation);
          // Bright stars low down flash colours as the air splits their light (Sirius in winter).
          float chroma = uTwinkle * low * smoothstep(2.2, -0.6, m);
          float a = t * (9.0 + seed * 5.0);
          vColour *= 1.0 + chroma * 0.55 * vec3(sin(a), sin(a + 2.1), sin(a + 4.2));

          // Glare: the brightest stars bloom and grow spikes.
          vGlare = smoothstep(1.8, -1.4, m);
          vAlpha = smoothstep(0.0, 0.12, b) * uFade * flicker;
          gl_PointSize = min(96.0, (2.0 + b * b * 10.0) * (1.0 + vGlare * 2.2) * (0.85 + 0.15 * flicker) * uScale * uDpr);
          if (vAlpha < 0.004) gl_PointSize = 0.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColour;
        varying float vAlpha;
        varying float vGlare;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r2 = dot(c, c) * 4.0;
          if (r2 > 1.0) discard;
          // Keep the core the same apparent size as the sprite grows for glare.
          float k = 1.0 + vGlare * 2.2;
          float core = exp(-r2 * 9.0 * k * k);
          float halo = exp(-r2 * 2.6 * k) * 0.32 + exp(-r2 * 3.2) * vGlare * 0.16;
          float spikes = (exp(-abs(c.x) * 70.0) + exp(-abs(c.y) * 70.0)) * pow(1.0 - sqrt(r2), 2.0) * vGlare * 0.55;
          vec3 colour = mix(vColour, vec3(1.0, 0.98, 0.95), core * 0.6);
          gl_FragColor = vec4(colour, (core + halo + spikes) * vAlpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending
    });
    const points = new Points(geometry, this.starMaterial);
    points.renderOrder = 2;
    points.frustumCulled = false;
    this.celestial.add(points);
    return mags.length;
  }

  /** Stick figures in three tiers: zodiac (highlighted), essential signposts, the rest. */
  setConstellations(records: ConstellationRecord[]): void {
    const buckets = { zodiac: [] as number[], essential: [] as number[], minor: [] as number[] };
    const v = new Vector3();
    const w = new Vector3();
    for (const record of records) {
      const bucket = ZODIAC_CONSTELLATIONS.has(record.id) ? buckets.zodiac : ESSENTIAL_CONSTELLATIONS.has(record.id) ? buckets.essential : buckets.minor;
      for (const polyline of record.lines) {
        for (let k = 0; k + 3 < polyline.length; k += 2) {
          equatorialUnit({ ra: polyline[k], dec: polyline[k + 1] }, v).multiplyScalar(LINE_R);
          equatorialUnit({ ra: polyline[k + 2], dec: polyline[k + 3] }, w).multiplyScalar(LINE_R);
          bucket.push(v.x, v.y, v.z, w.x, w.y, w.z);
        }
      }
    }
    const materials = { zodiac: this.zodiacLineMaterial, essential: this.lineMaterial, minor: this.minorLineMaterial };
    for (const key of ['minor', 'essential', 'zodiac'] as const) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(buckets[key], 3));
      const lines = new LineSegments(geometry, materials[key]);
      lines.renderOrder = 4;
      lines.frustumCulled = false;
      this.celestial.add(lines);
      this.lineGroups[key] = lines;
    }
    this.lines = this.lineMode;
  }

  /**
   * Ecliptic great circle with ticks (short every 15° for the solar terms, long every 30°
   * for the houses), plus the dashed edges and house dividers of the ±8° zodiac band.
   */
  private buildEcliptic(): [BufferGeometry, BufferGeometry] {
    const v = new Vector3();
    const pusher = (out: number[]) => (lambda: number, beta: number) => {
      equatorialUnit(eclipticRaDec(lambda, beta), v).multiplyScalar(ECLIPTIC_R);
      out.push(v.x, v.y, v.z);
    };
    const centre: number[] = [];
    const push = pusher(centre);
    for (let lambda = 0; lambda < 360; lambda += 1) {
      push(lambda, 0);
      push(lambda + 1, 0);
    }
    for (let lambda = 0; lambda < 360; lambda += 15) {
      const half = lambda % 30 === 0 ? 1.8 : 0.7;
      push(lambda, -half);
      push(lambda, half);
    }
    const edges: number[] = [];
    const edge = pusher(edges);
    for (let lambda = 0; lambda < 360; lambda += 2) {
      for (const beta of [-BAND, BAND]) {
        edge(lambda, beta);
        edge(lambda + 1, beta);
      }
    }
    for (let lambda = 0; lambda < 360; lambda += 30) {
      for (let beta = -BAND; beta < BAND; beta += 1) {
        if (Math.abs(beta + 0.5) < 5) continue; // short tabs at the band edges only
        edge(lambda, beta);
        edge(lambda, beta + 1);
      }
    }
    const [a, b] = [centre, edges].map(positions => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      return geometry;
    });
    return [a, b];
  }

  /** Ribbon along the ecliptic carrying (longitude, latitude / band) for the glow shader. */
  private buildBand(): BufferGeometry {
    const positions: number[] = [];
    const band: number[] = [];
    const index: number[] = [];
    const rows = [-1, -0.6, -0.3, -0.12, -0.04, 0, 0.04, 0.12, 0.3, 0.6, 1];
    const v = new Vector3();
    for (let lambda = 0; lambda <= 360; lambda += 2) {
      for (const s of rows) {
        equatorialUnit(eclipticRaDec(lambda, s * BAND), v).multiplyScalar(ECLIPTIC_R + 0.05);
        positions.push(v.x, v.y, v.z);
        band.push(lambda, s);
      }
    }
    const n = rows.length;
    for (let i = 0; i < 180; i += 1) {
      for (let j = 0; j + 1 < n; j += 1) {
        const a = i * n + j;
        const b = a + n;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('band', new Float32BufferAttribute(band, 2));
    geometry.setIndex(index);
    return geometry;
  }

  /** The 28 lunar mansions: asterism figures and the hour circles through their 距星. */
  setMansions(mansions: Mansion[]): void {
    const figure: number[] = [];
    const ticks: number[] = [];
    const v = new Vector3();
    const push = (out: number[], ra: number, dec: number, r: number) => {
      equatorialUnit({ ra, dec }, v).multiplyScalar(r);
      out.push(v.x, v.y, v.z);
    };
    for (const mansion of mansions) {
      for (const polyline of mansion.lines) {
        for (let k = 0; k + 3 < polyline.length; k += 2) {
          push(figure, polyline[k], polyline[k + 1], MANSION_R);
          push(figure, polyline[k + 2], polyline[k + 3], MANSION_R);
        }
      }
      // Boundary: a short stretch of the determinative star's hour circle across the ecliptic.
      const ra = mansion.det[0];
      const dec = eclipticRaDec(eclipticLongitudeAtRa(ra), 0).dec;
      for (let d = -2.5; d < 2.5; d += 1) {
        push(ticks, ra, dec + d, ECLIPTIC_R);
        push(ticks, ra, dec + d + 1, ECLIPTIC_R);
      }
    }
    for (const [positions, material] of [[figure, this.mansionLineMaterial], [ticks, this.mansionTickMaterial]] as const) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const lines = new LineSegments(geometry, material);
      lines.renderOrder = 4;
      lines.frustumCulled = false;
      this.mansions.add(lines);
    }
  }

  private buildGrid(): BufferGeometry {
    const positions: number[] = [];
    const point = (alt: number, az: number): [number, number, number] => [
      Math.cos(alt * DEG) * Math.sin(az * DEG) * GRID_R,
      Math.sin(alt * DEG) * GRID_R,
      -Math.cos(alt * DEG) * Math.cos(az * DEG) * GRID_R
    ];
    for (let alt = 0; alt < 90; alt += 15) {
      for (let az = 0; az < 360; az += 3) positions.push(...point(alt, az), ...point(alt, az + 3));
    }
    for (let az = 0; az < 360; az += 30) {
      for (let alt = 0; alt < 87; alt += 3) positions.push(...point(alt, az), ...point(alt + 3, az));
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return geometry;
  }

  set lines(mode: LineMode) {
    this.lineMode = mode;
    const { zodiac, essential, minor } = this.lineGroups;
    if (zodiac) zodiac.visible = mode !== 'off';
    if (essential) essential.visible = mode !== 'off';
    if (minor) minor.visible = mode === 'all';
  }

  set showEcliptic(value: boolean) {
    this.ecliptic.visible = value;
  }

  set showMansions(value: boolean) {
    this.mansions.visible = value;
    this.westernDim = value ? 0.5 : 1;
  }

  set showGrid(value: boolean) {
    this.grid.visible = value;
  }

  /** Per-frame state: `sunDir` is the Sun's horizontal unit vector. */
  update(options: { sunDir: Vector3; sunLambda: number; fov: number; dpr: number; moonLight: number; time: number; twinkle: number }): void {
    const sunAlt = options.sunDir.y;
    const day = Math.min(1, Math.max(0, (sunAlt + 0.105) / 0.305));
    this.skyMaterial.uniforms.uSunDir.value.copy(options.sunDir);
    this.skyMaterial.uniforms.uMilky.value = (1 - day) * (1 - options.moonLight * 0.55);
    this.groundMaterial.uniforms.uDay.value = day;
    this.lineMaterial.opacity = 0.32 * (1 - day * 0.6) * this.westernDim;
    this.zodiacLineMaterial.opacity = 0.5 * (1 - day * 0.5) * this.westernDim;
    this.minorLineMaterial.opacity = 0.17 * (1 - day * 0.6) * this.westernDim;
    this.eclipticMaterial.opacity = 0.55 * (1 - day * 0.3);
    this.bandEdgeMaterial.opacity = 0.1 * (1 - day * 0.5);
    this.bandMaterial.uniforms.uOpacity.value = 1 - day * 0.4;
    this.bandMaterial.uniforms.uSunLambda.value = options.sunLambda;
    this.mansionLineMaterial.opacity = 0.55 * (1 - day * 0.5);
    this.mansionTickMaterial.opacity = 0.5 * (1 - day * 0.4);
    if (this.starMaterial) {
      const u = this.starMaterial.uniforms;
      const zoom = 62 / options.fov;
      u.uLimit.value = 6.3 + 2.4 * Math.log10(zoom) - day * 6.5 - options.moonLight * 0.6;
      u.uScale.value = Math.min(1.7, Math.max(0.85, Math.sqrt(zoom)));
      u.uDpr.value = options.dpr;
      u.uFade.value = 1 - day * 0.92;
      u.uTime.value = options.time;
      u.uTwinkle.value = options.twinkle * (1 - day);
    }
    this.camera.fov = options.fov;
    this.camera.updateProjectionMatrix();
  }
}
