import { describe, expect, it } from 'vitest';
import type { BufferGeometry, Points } from 'three';
import { buildCatalogObjects } from '../data/objects';
import { createDeepSkyModels, MODELLED_IDS } from './nebulae';

const objects = buildCatalogObjects();
const byId = new Map(objects.map(object => [object.id, object]));
const models = new Map(createDeepSkyModels(objects).map(layer => [objects.find(o => o.pos[0] === layer.origin[0] && o.pos[1] === layer.origin[1] && o.pos[2] === layer.origin[2])!.id, layer]));

const attr = (points: Points, name: string) => (points.geometry as BufferGeometry).getAttribute(name);
/** The member stars: the star points with more than one vertex (the integrated point has one). */
const members = (id: string) => models.get(id)!.group.children.filter(c => (c as Points).geometry?.getAttribute('absmag')?.count > 1) as Points[];
const totalAbsMag = (points: Points[]) => {
  let luminosity = 0;
  for (const p of points) {
    const m = attr(p, 'absmag');
    for (let i = 0; i < m.count; i += 1) luminosity += Math.pow(10, -0.4 * m.getX(i));
  }
  return -2.5 * Math.log10(luminosity);
};

describe('deep-sky models', () => {
  it('models every Milky Way cluster and nebula in the catalogue', () => {
    const expected = objects.filter(o => ['cluster', 'globular', 'nebula'].includes(o.kind)).map(o => o.id);
    expect(new Set(MODELLED_IDS)).toEqual(new Set(expected));
    expect(models.size).toBe(expected.length);
  });

  it('globular cluster members add up to the published integrated magnitude', () => {
    expect(totalAbsMag(members('M13'))).toBeCloseTo(-8.55, 2);
    expect(totalAbsMag(members('NGC 5139'))).toBeCloseTo(-10.3, 2);
    expect(totalAbsMag(members('M22'))).toBeCloseTo(-8.5, 2);
  });

  it('nearby clusters only add members fainter than the HYG completeness limit', () => {
    for (const id of ['Hyades', 'M45', 'M44', 'M7']) {
      const object = byId.get(id)!;
      const ly = Math.hypot(...object.pos);
      const limit = 8 - (5 * Math.log10(ly / 3.261563777) - 5);
      const m = attr(members(id)[0], 'absmag');
      let brightest = Infinity;
      for (let i = 0; i < m.count; i += 1) brightest = Math.min(brightest, m.getX(i));
      expect(brightest, id).toBeGreaterThanOrEqual(limit - 1e-6);
    }
  });

  it('keeps every model within its physical size', () => {
    for (const [id, layer] of models) {
      const extent = byId.get(id)!.extent;
      let farthest = 0;
      for (const child of layer.group.children) {
        const pos = (child as Points).geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i += 1) farthest = Math.max(farthest, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
      }
      // The framing radius follows the bright core; tidal radii of open clusters reach ~3x that
      // (Hyades: 10 pc = 33 ly against a 10 ly framing radius).
      expect(farthest, id).toBeLessThan(extent * 3.5);
      expect(farthest, id).toBeGreaterThan(extent * 0.3);
    }
  });
});
