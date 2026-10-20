import { BufferAttribute, BufferGeometry, Group, Points } from 'three';
import { createStarMaterial } from '../core/materials';
import { smoothstep } from '../core/units';
import { STAR_STRIDE, type StarCatalog } from '../data/stars';
import type { FrameState, Layer } from './types';

const SUN_ABSMAG = 4.83;
const SUN_CI = 0.656;

/** HYG stars at their true 3D positions, plus the Sun at the origin. */
export class StarLayer implements Layer {
  readonly group = new Group();
  readonly origin: [number, number, number] = [0, 0, 0];
  private material = createStarMaterial();

  constructor(catalog: StarCatalog) {
    const count = catalog.count + 1;
    const position = new Float32Array(count * 3);
    const absmag = new Float32Array(count);
    const ci = new Float32Array(count);
    for (let i = 0; i < catalog.count; i += 1) {
      const base = i * STAR_STRIDE;
      position[i * 3] = catalog.buffer[base];
      position[i * 3 + 1] = catalog.buffer[base + 1];
      position[i * 3 + 2] = catalog.buffer[base + 2];
      absmag[i] = catalog.buffer[base + 3];
      ci[i] = catalog.buffer[base + 4];
    }
    absmag[count - 1] = SUN_ABSMAG;
    ci[count - 1] = SUN_CI;

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('absmag', new BufferAttribute(absmag, 1));
    geometry.setAttribute('ci', new BufferAttribute(ci, 1));
    const points = new Points(geometry, this.material);
    points.frustumCulled = false;
    points.renderOrder = 20;
    this.group.add(points);
  }

  update(frame: FrameState): void {
    const u = this.material.uniforms;
    u.uCamPos.value.set(frame.cameraWorld[0], frame.cameraWorld[1], frame.cameraWorld[2]);
    u.uDpr.value = frame.dpr;
    // Once the camera leaves the neighbourhood, keep every catalogued star as
    // a faint dot so the shape of the surveyed bubble stays readable.
    u.uFloor.value = smoothstep(1.4, 2.8, frame.logR) * 0.16;
    u.uOpacity.value = 1 - smoothstep(4.3, 5.1, frame.logR);
    u.uSizeScale.value = 1 - smoothstep(2.5, 4.2, frame.logR) * 0.35;
    this.group.visible = u.uOpacity.value > 0.003;
  }
}
