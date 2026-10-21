import { isEn } from './i18n';
// Coordinate conventions
//
// Scene frame: galactic Cartesian, Sun at the origin, light-years, mapped to
// three.js axes as (gx, gz, -gy). +x points at the Galactic Centre and +y at
// the North Galactic Pole, so the Milky Way disc lies in the x/z plane.

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

// IAU J2000 equatorial -> galactic rotation.
const EQ_TO_GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762]
];

const OBLIQUITY = 23.4392911 * DEG;

export const GALACTIC_CENTRE_LY = 26670;

function galToScene(gx: number, gy: number, gz: number): Vec3 {
  return [gx, gz, -gy];
}

export function equatorialToScene(x: number, y: number, z: number): Vec3 {
  const m = EQ_TO_GAL;
  return galToScene(
    m[0][0] * x + m[0][1] * y + m[0][2] * z,
    m[1][0] * x + m[1][1] * y + m[1][2] * z,
    m[2][0] * x + m[2][1] * y + m[2][2] * z
  );
}

/** Scene vector -> equatorial unit-free Cartesian (inverse rotation). */
export function sceneToEquatorial(p: Vec3): Vec3 {
  const gx = p[0];
  const gy = -p[2];
  const gz = p[1];
  const m = EQ_TO_GAL;
  return [
    m[0][0] * gx + m[1][0] * gy + m[2][0] * gz,
    m[0][1] * gx + m[1][1] * gy + m[2][1] * gz,
    m[0][2] * gx + m[1][2] * gy + m[2][2] * gz
  ];
}

export function raDecToScene(raDeg: number, decDeg: number, distance: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return equatorialToScene(
    distance * Math.cos(dec) * Math.cos(ra),
    distance * Math.cos(dec) * Math.sin(ra),
    distance * Math.sin(dec)
  );
}

export function galacticToScene(lDeg: number, bDeg: number, distance: number): Vec3 {
  const l = lDeg * DEG;
  const b = bDeg * DEG;
  return galToScene(
    distance * Math.cos(b) * Math.cos(l),
    distance * Math.cos(b) * Math.sin(l),
    distance * Math.sin(b)
  );
}

export function eclipticToScene(x: number, y: number, z: number): Vec3 {
  const c = Math.cos(OBLIQUITY);
  const s = Math.sin(OBLIQUITY);
  return equatorialToScene(x, y * c - z * s, y * s + z * c);
}

export function eclipticToEquatorial(x: number, y: number, z: number): Vec3 {
  const c = Math.cos(OBLIQUITY);
  const s = Math.sin(OBLIQUITY);
  return [x, y * c - z * s, y * s + z * c];
}

export function equatorialToRaDec(v: Vec3): { ra: number; dec: number } {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  const ra = ((Math.atan2(v[1], v[0]) / DEG) % 360 + 360) % 360;
  const dec = Math.asin(v[2] / r) / DEG;
  return { ra, dec };
}

export function sceneToRaDec(p: Vec3): { ra: number; dec: number } {
  return equatorialToRaDec(sceneToEquatorial(p));
}

export function length(p: Vec3): number {
  return Math.hypot(p[0], p[1], p[2]);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------------------------------------------------------------------------
// Observer sky

export interface Observer {
  lat: number;
  lon: number;
  label: string;
  source: 'default' | 'geolocation' | 'manual';
}

export function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

export function daysSinceJ2000(date: Date): number {
  return julianDate(date) - 2451545.0;
}

function gmstDeg(date: Date): number {
  const d = daysSinceJ2000(date);
  return ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360;
}

export interface HorizonPosition {
  alt: number;
  az: number;
  maxAlt: number;
  /** Next upper culmination, or null for objects that never rise. */
  transit: Date | null;
  circumpolar: boolean;
  neverRises: boolean;
}

export function horizonPosition(raDeg: number, decDeg: number, observer: Observer, date: Date): HorizonPosition {
  const lst = gmstDeg(date) + observer.lon;
  const ha = ((lst - raDeg) % 360 + 360) % 360;
  const H = ha * DEG;
  const phi = observer.lat * DEG;
  const dec = decDeg * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
  const az = ((Math.atan2(
    -Math.cos(dec) * Math.sin(H),
    Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(H)
  ) / DEG) % 360 + 360) % 360;
  const maxAlt = 90 - Math.abs(observer.lat - decDeg);
  const minAlt = -90 + Math.abs(observer.lat + decDeg);
  const neverRises = maxAlt <= 0;
  // Hours until the hour angle wraps back to zero (sidereal rate).
  const hoursToTransit = ((360 - ha) % 360) / 15.0410686;
  return {
    alt,
    az,
    maxAlt,
    transit: neverRises ? null : new Date(date.getTime() + hoursToTransit * 3600000),
    circumpolar: minAlt > 0,
    neverRises
  };
}

const DIRECTIONS = isEn ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] : ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

export function azimuthName(az: number): string {
  return DIRECTIONS[Math.round(az / 45) % 8];
}
