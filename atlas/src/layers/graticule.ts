import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop } from 'three';
import { PALETTE } from '../core/materials';
import { equatorialToScene, type Vec3 } from '../core/coords';
import { AU_LY, formatDistance, smoothstep } from '../core/units';
import type { Annotation, FrameState, Layer } from './types';

const OBLIQUITY = (23.4392911 * Math.PI) / 180;

interface Ring {
  radius: number;
  line: LineLoop;
  material: LineBasicMaterial;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Distance rings centred on the Sun: ecliptic plane for AU, galactic plane beyond. */
export class GraticuleLayer implements Layer {
  readonly group = new Group();
  readonly origin: Vec3 = [0, 0, 0];
  readonly annotations: Annotation[] = [];
  private rings: Ring[] = [];

  constructor() {
    const eclipticPole = normalize(equatorialToScene(0, -Math.sin(OBLIQUITY), Math.cos(OBLIQUITY)));
    const eclipticU = normalize(equatorialToScene(1, 0, 0));
    const eclipticV = cross(eclipticPole, eclipticU);
    const galacticU: Vec3 = [1, 0, 0];
    const galacticV: Vec3 = [0, 0, -1];

    const radii = [
      ...[1, 10, 100, 1000, 10000].map(au => au * AU_LY),
      1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10
    ];
    for (const radius of radii) {
      const [u, v] = radius < 0.5 ? [eclipticU, eclipticV] : [galacticU, galacticV];
      const points: number[] = [];
      for (let k = 0; k < 256; k += 1) {
        const a = (k / 256) * Math.PI * 2;
        const c = Math.cos(a) * radius;
        const s = Math.sin(a) * radius;
        points.push(u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s);
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
      const material = new LineBasicMaterial({ color: PALETTE.line, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
      const line = new LineLoop(geometry, material);
      line.frustumCulled = false;
      line.renderOrder = 1;
      this.group.add(line);
      this.rings.push({ radius, line, material });

      const a = Math.PI * 0.25;
      const logR = Math.log10(radius);
      this.annotations.push({
        key: `ring:${radius}`,
        zh: formatDistance(radius),
        pos: [
          (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * radius,
          (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * radius,
          (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * radius
        ],
        window: [logR - 0.35, logR + 0.75],
        priority: 0.4,
        style: 'ring'
      });
    }
  }

  update(frame: FrameState): void {
    for (const ring of this.rings) {
      const x = Math.log10(ring.radius) - frame.logR;
      const opacity = smoothstep(-1.15, -0.65, x) * (1 - smoothstep(0.15, 0.6, x));
      ring.material.opacity = opacity * 0.34;
      ring.line.visible = opacity > 0.01;
    }
  }
}
