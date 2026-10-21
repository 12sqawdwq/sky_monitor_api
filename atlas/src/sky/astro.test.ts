import { describe, expect, it } from 'vitest';
import type { Observer } from '../core/coords';
import { geocentricPlanets } from '../layers/solar';
import { moonPosition, riseTransitSet, sunPosition, type RaDec, type RiseSet } from './astro';

const at = (lat: number, lon = 20): Observer => ({ lat, lon, label: 'test', source: 'manual' });
const SUN_HORIZON = -0.833;

function expectConsistent(result: RiseSet, date: Date): void {
  const valid = (d: Date | null) => d === null || Number.isFinite(d.getTime());
  expect(valid(result.rise) && valid(result.transit) && valid(result.set)).toBe(true);
  if (result.neverRises) {
    expect(result).toMatchObject({ rise: null, transit: null, set: null, circumpolar: false });
  } else if (result.circumpolar) {
    expect(result.rise).toBeNull();
    expect(result.set).toBeNull();
    expect(result.transit!.getTime()).toBeGreaterThanOrEqual(date.getTime() - 60000);
  } else {
    expect(result.transit).not.toBeNull();
    expect(result.set).not.toBeNull();
    // The pass reported is the current or the next one.
    expect(result.set!.getTime()).toBeGreaterThanOrEqual(date.getTime() - 60000);
    if (result.rise) expect(result.rise.getTime()).toBeLessThan(result.set!.getTime());
  }
}

describe('riseTransitSet', () => {
  it('reports polar night instead of throwing (70°N, winter solstice)', () => {
    const date = new Date('2026-12-21T12:00:00Z');
    const result = riseTransitSet(sunPosition, at(70), date, SUN_HORIZON);
    expect(result.neverRises).toBe(true);
    expectConsistent(result, date);
  });

  it('reports the midnight sun as circumpolar (70°N, summer solstice)', () => {
    const date = new Date('2026-06-21T12:00:00Z');
    const result = riseTransitSet(sunPosition, at(70), date, SUN_HORIZON);
    expect(result.circumpolar).toBe(true);
    expectConsistent(result, date);
  });

  it('gives an ordered rise, transit and set at mid latitudes', () => {
    const date = new Date('2026-10-21T00:00:00Z');
    const result = riseTransitSet(sunPosition, { lat: 31.23, lon: 121.47, label: 'Shanghai', source: 'manual' }, date, SUN_HORIZON);
    expect(result.neverRises || result.circumpolar).toBe(false);
    expect(result.rise!.getTime()).toBeLessThan(result.transit!.getTime());
    expect(result.transit!.getTime()).toBeLessThan(result.set!.getTime());
  });

  it('never throws for moving bodies at high latitudes across a year', () => {
    const bodies: Array<[string, (d: Date) => RaDec, number]> = [
      ['sun', sunPosition, SUN_HORIZON],
      ['moon', moonPosition, 0.125],
      ['mars', d => geocentricPlanets(d).find(p => p.id === 'mars')!, -0.5667],
      ['jupiter', d => geocentricPlanets(d).find(p => p.id === 'jupiter')!, -0.5667]
    ];
    const start = Date.UTC(2026, 0, 1);
    for (const lat of [-80, -70, 64, 66.5, 68, 70, 75, 85]) {
      for (let day = 0; day < 366; day += 3) {
        for (const hour of [0, 9, 17]) {
          const date = new Date(start + (day * 24 + hour) * 3600000);
          for (const [name, positionAt, horizon] of bodies) {
            let result: RiseSet | undefined;
            expect(() => {
              result = riseTransitSet(positionAt, at(lat), date, horizon);
            }, `${name} at ${lat}° on ${date.toISOString()}`).not.toThrow();
            expectConsistent(result!, date);
          }
        }
      }
    }
  });
});
