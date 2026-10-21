import { Matrix4, Vector3 } from 'three';
import { daysSinceJ2000, eclipticToEquatorial, equatorialToRaDec, type Observer } from '../core/coords';
import { t } from '../core/i18n';

const DEG = Math.PI / 180;
const SIDEREAL_RATE = 15.0410686; // degrees of hour angle per hour
const SIDEREAL_DAY_H = 23.9344696;

export interface RaDec {
  ra: number;
  dec: number;
}

export interface Horizontal {
  alt: number;
  /** Degrees east of north. */
  az: number;
}

export function lstDeg(date: Date, lon: number): number {
  const d = daysSinceJ2000(date);
  return (((280.46061837 + 360.98564736629 * d + lon) % 360) + 360) % 360;
}

export function toHorizontal(pos: RaDec, observer: Observer, date: Date): Horizontal {
  const H = (lstDeg(date, observer.lon) - pos.ra) * DEG;
  const phi = observer.lat * DEG;
  const dec = pos.dec * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
  const az = (Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(H)) / DEG + 360) % 360;
  return { alt, az };
}

/** Horizontal frame used by the sky view: x = east, y = up, -z = north. */
export function horizontalVector(h: Horizontal, out = new Vector3()): Vector3 {
  const alt = h.alt * DEG;
  const az = h.az * DEG;
  return out.set(Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az));
}

export function vectorToHorizontal(v: Vector3): Horizontal {
  const n = v.clone().normalize();
  return { alt: Math.asin(Math.max(-1, Math.min(1, n.y))) / DEG, az: (Math.atan2(n.x, -n.z) / DEG + 360) % 360 };
}

export function equatorialUnit(pos: RaDec, out = new Vector3()): Vector3 {
  const ra = pos.ra * DEG;
  const dec = pos.dec * DEG;
  return out.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
}

/** Rotation taking equatorial unit vectors to the horizontal frame at a moment. */
export function equatorialToHorizontalMatrix(observer: Observer, date: Date, out = new Matrix4()): Matrix4 {
  const lst = lstDeg(date, observer.lon) * DEG;
  const phi = observer.lat * DEG;
  // Hour-angle frame: rotate by -LST about the pole, then tilt the pole to the
  // observer's latitude. Columns are images of the equatorial basis vectors.
  const column = (x: number, y: number, z: number) => {
    // Rotate about z by -lst (RA -> hour angle, with the y axis flipped westward).
    const cx = x * Math.cos(lst) + y * Math.sin(lst);
    const cy = x * Math.sin(lst) - y * Math.cos(lst);
    // (cx, cy, z) is (towards meridian on the equator, towards west, pole).
    const south = cx * Math.sin(phi) - z * Math.cos(phi);
    const up = cx * Math.cos(phi) + z * Math.sin(phi);
    const west = cy;
    return new Vector3(-west, up, south);
  };
  const ex = column(1, 0, 0);
  const ey = column(0, 1, 0);
  const ez = column(0, 0, 1);
  return out.set(ex.x, ey.x, ez.x, 0, ex.y, ey.y, ez.y, 0, ex.z, ey.z, ez.z, 0, 0, 0, 0, 1);
}

// --------------------------------------------------------------- Sun & Moon

export function sunPosition(date: Date): RaDec & { lambda: number } {
  const d = daysSinceJ2000(date);
  const g = (357.529 + 0.98560028 * d) * DEG;
  const L = 280.459 + 0.98564736 * d;
  const lambda = (((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360) + 360) % 360;
  const l = lambda * DEG;
  const radec = equatorialToRaDec(eclipticToEquatorial(Math.cos(l), Math.sin(l), 0));
  return { ...radec, lambda };
}

export function moonPosition(date: Date): RaDec & { lambda: number; distanceKm: number } {
  const d = daysSinceJ2000(date);
  const L = 218.316 + 13.176396 * d;
  const M = (134.963 + 13.064993 * d) * DEG;
  const F = (93.272 + 13.22935 * d) * DEG;
  const D = (297.85 + 12.190749 * d) * DEG;
  const lambda = (((L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D)) % 360) + 360) % 360;
  const beta = 5.128 * Math.sin(F);
  const l = lambda * DEG;
  const b = beta * DEG;
  const radec = equatorialToRaDec(eclipticToEquatorial(Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)));
  return { ...radec, lambda, distanceKm: 385001 - 20905 * Math.cos(M) };
}

export interface MoonPhase {
  illumination: number;
  waxing: boolean;
  name: string;
}

export function moonPhase(date: Date): MoonPhase {
  const elongation = (((moonPosition(date).lambda - sunPosition(date).lambda) % 360) + 360) % 360;
  const illumination = (1 - Math.cos(elongation * DEG)) / 2;
  const waxing = elongation < 180;
  // Name by illuminated fraction: the quarters are the ~50% moments.
  let name: string;
  if (illumination < 0.03) name = t('新月', 'New Moon');
  else if (illumination > 0.97) name = t('满月', 'Full Moon');
  else if (illumination < 0.4) name = waxing ? t('蛾眉月', 'Waxing Crescent') : t('残月', 'Waning Crescent');
  else if (illumination <= 0.6) name = waxing ? t('上弦月', 'First Quarter') : t('下弦月', 'Last Quarter');
  else name = waxing ? t('盈凸月', 'Waxing Gibbous') : t('亏凸月', 'Waning Gibbous');
  return { illumination, waxing, name };
}

// ------------------------------------------------------------- rise / set

export interface RiseSet {
  rise: Date | null;
  transit: Date | null;
  set: Date | null;
  circumpolar: boolean;
  neverRises: boolean;
}

/**
 * Rise, culmination and set of the pass that is current or next at `date`.
 * `positionAt` lets moving bodies (Sun, Moon) refine their coordinates.
 */
export function riseTransitSet(positionAt: (date: Date) => RaDec, observer: Observer, date: Date, horizonDeg = -0.5667): RiseSet {
  const phi = observer.lat * DEG;
  const solve = (when: Date, offsetSign: -1 | 0 | 1): { time: Date | null; circumpolar: boolean; neverRises: boolean } => {
    let time = when;
    let result = { time: null as Date | null, circumpolar: false, neverRises: false };
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const pos = positionAt(time);
      const dec = pos.dec * DEG;
      const cosH0 = (Math.sin(horizonDeg * DEG) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
      if (cosH0 > 1) return { time: null, circumpolar: false, neverRises: true };
      if (cosH0 < -1 && offsetSign !== 0) return { time: null, circumpolar: true, neverRises: false };
      const H0 = offsetSign === 0 ? 0 : Math.acos(Math.max(-1, Math.min(1, cosH0))) / DEG;
      // Hours from `when` until the hour angle equals offsetSign * H0, within ±12 sidereal hours.
      const ha = ((lstDeg(when, observer.lon) - pos.ra) % 360 + 540) % 360 - 180;
      let delta = (offsetSign * H0 - ha) / SIDEREAL_RATE;
      if (delta > SIDEREAL_DAY_H / 2) delta -= SIDEREAL_DAY_H;
      if (delta < -SIDEREAL_DAY_H / 2) delta += SIDEREAL_DAY_H;
      time = new Date(when.getTime() + delta * 3600000);
      result = { time, circumpolar: false, neverRises: false };
    }
    return result;
  };

  const never: RiseSet = { rise: null, transit: null, set: null, circumpolar: false, neverRises: true };
  const circumpolar = (transit: Date): RiseSet => ({
    rise: null,
    transit: transit.getTime() < date.getTime() ? new Date(transit.getTime() + SIDEREAL_DAY_H * 3600000) : transit,
    set: null,
    circumpolar: true,
    neverRises: false
  });

  // Anchor on the nearest culmination, then step a day if that pass has already set. Moving
  // bodies (the Sun near the polar night, the Moon) can change between never-rising, rising
  // and circumpolar from one day to the next, so every solve is checked before it is used.
  const first = solve(date, 0);
  if (first.neverRises || !first.time) return never;
  let transit = first.time;
  let set = solve(transit, 1);
  if (set.neverRises) return never;
  if (set.circumpolar) return circumpolar(transit);
  if (set.time && set.time.getTime() < date.getTime()) {
    const next = solve(new Date(transit.getTime() + SIDEREAL_DAY_H * 3600000), 0);
    if (next.neverRises || !next.time) return never;
    transit = next.time;
    set = solve(transit, 1);
    if (set.neverRises) return never;
    if (set.circumpolar) return circumpolar(transit);
  }
  const rise = solve(transit, -1);
  if (rise.neverRises) return never;
  return { rise: rise.time, transit, set: set.time, circumpolar: false, neverRises: false };
}
