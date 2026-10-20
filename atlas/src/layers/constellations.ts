import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments } from 'three';
import { PALETTE } from '../core/materials';
import { sceneToEquatorial, type Vec3 } from '../core/coords';
import { logWindow } from '../core/units';
import { constellationName } from '../data/constellations';
import { STAR_STRIDE, type StarCatalog } from '../data/stars';
import { ESSENTIAL_CONSTELLATIONS, ZODIAC_CONSTELLATIONS } from '../data/zodiac';
import type { ConstellationRecord } from '../sky/scene';
import type { Annotation, FrameState, Layer } from './types';

const DEG = Math.PI / 180;
const MATCH_COS = Math.cos(0.6 * DEG);
const CANDIDATE_MAG = 5.3;

/**
 * Stick figures of the essential constellations drawn between the stars' true
 * 3D positions: familiar from the Sun, visibly pulled apart once you leave.
 */
export class ConstellationLayer implements Layer {
  readonly group = new Group();
  readonly origin: Vec3 = [0, 0, 0];
  readonly annotations: Annotation[] = [];
  private zodiac = new LineBasicMaterial({ color: PALETTE.amber, transparent: true, depthTest: false, depthWrite: false });
  private essential = new LineBasicMaterial({ color: PALETTE.copper, transparent: true, depthTest: false, depthWrite: false });

  constructor(catalog: StarCatalog, records: ConstellationRecord[]) {
    // Directions (unit, equatorial) and positions of naked-eye stars as seen from the Sun.
    const dirs: number[] = [];
    const positions: Vec3[] = [];
    for (let i = 0; i < catalog.count; i += 1) {
      const base = i * STAR_STRIDE;
      const p: Vec3 = [catalog.buffer[base], catalog.buffer[base + 1], catalog.buffer[base + 2]];
      const d = Math.hypot(p[0], p[1], p[2]);
      const mag = catalog.buffer[base + 3] + 5 * (Math.log10(d / 3.261563777) - 1);
      if (!(mag <= CANDIDATE_MAG)) continue;
      const eq = sceneToEquatorial(p);
      dirs.push(eq[0] / d, eq[1] / d, eq[2] / d);
      positions.push(p);
    }

    const match = (ra: number, dec: number): Vec3 | null => {
      const x = Math.cos(dec * DEG) * Math.cos(ra * DEG);
      const y = Math.cos(dec * DEG) * Math.sin(ra * DEG);
      const z = Math.sin(dec * DEG);
      let best = MATCH_COS;
      let hit = -1;
      for (let k = 0; k < positions.length; k += 1) {
        const dot = dirs[k * 3] * x + dirs[k * 3 + 1] * y + dirs[k * 3 + 2] * z;
        if (dot > best) {
          best = dot;
          hit = k;
        }
      }
      return hit >= 0 ? positions[hit] : null;
    };

    const buckets = { zodiac: [] as number[], essential: [] as number[] };
    for (const record of records) {
      if (!ESSENTIAL_CONSTELLATIONS.has(record.id)) continue;
      const bucket = ZODIAC_CONSTELLATIONS.has(record.id) ? buckets.zodiac : buckets.essential;
      const used: Vec3[] = [];
      for (const polyline of record.lines) {
        let previous: Vec3 | null = null;
        for (let k = 0; k + 1 < polyline.length; k += 2) {
          const star = match(polyline[k], polyline[k + 1]);
          if (star && previous && star !== previous) bucket.push(...previous, ...star);
          if (star) used.push(star);
          previous = star;
        }
      }
      if (used.length) {
        const centre: Vec3 = [0, 0, 0];
        for (const p of used) for (let a = 0; a < 3; a += 1) centre[a] += p[a] / used.length;
        this.annotations.push({ key: `con3d:${record.id}`, zh: constellationName(record.id), pos: centre, window: [-4.6, 1.1], priority: 0.9, style: 'con' });
      }
    }

    for (const [key, material] of [['essential', this.essential], ['zodiac', this.zodiac]] as const) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(buckets[key], 3));
      const lines = new LineSegments(geometry, material);
      lines.frustumCulled = false;
      lines.renderOrder = 15;
      this.group.add(lines);
    }
  }

  update(frame: FrameState): void {
    // Figures only read as figures near the Sun; fade out as the camera leaves.
    const opacity = logWindow(frame.logR, -6, -5, 0.8, 1.45);
    this.zodiac.opacity = opacity * 0.42;
    this.essential.opacity = opacity * 0.28;
    this.group.visible = opacity > 0.003;
  }
}
