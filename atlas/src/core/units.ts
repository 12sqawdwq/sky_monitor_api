// All scene distances are in light-years.
export const AU_LY = 1.581250740982e-5;
export const PC_LY = 3.261563777;

function sig(value: number, digits = 3): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1000) return Math.round(value).toLocaleString('en-US');
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(abs)));
  return Number(value.toFixed(Math.min(decimals, 6))).toString();
}

export interface DistanceParts {
  value: string;
  unit: string;
}

export function distanceParts(ly: number): DistanceParts {
  const abs = Math.abs(ly);
  if (abs < 0.05) return { value: sig(ly / AU_LY), unit: '天文单位' };
  if (abs < 1e4) return { value: sig(ly), unit: '光年' };
  if (abs < 1e8) return { value: sig(ly / 1e4), unit: '万光年' };
  return { value: sig(ly / 1e8), unit: '亿光年' };
}

export function formatDistance(ly: number): string {
  const parts = distanceParts(ly);
  return `${parts.value} ${parts.unit}`;
}

/** Short English-style distance for mono labels, e.g. "2.54 Mly". */
export function formatDistanceShort(ly: number): string {
  const abs = Math.abs(ly);
  if (abs < 0.05) return `${sig(ly / AU_LY)} AU`;
  if (abs < 1e3) return `${sig(ly)} ly`;
  if (abs < 1e6) return `${sig(ly / 1e3)} kly`;
  if (abs < 1e9) return `${sig(ly / 1e6)} Mly`;
  return `${sig(ly / 1e9)} Gly`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Opacity window over log10(camera radius): fades in over [a,b], out over [c,d]. */
export function logWindow(logR: number, a: number, b: number, c: number, d: number): number {
  return smoothstep(a, b, logR) * (1 - smoothstep(c, d, logR));
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
