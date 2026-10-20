import { BufferAttribute, BufferGeometry, Color, Points, type ShaderMaterial } from 'three';
import type { Vec3 } from '../core/coords';

/** Growable particle buffer feeding the dust material (position, tint, size). */
export class ParticleBuilder {
  private positions: number[] = [];
  private tints: number[] = [];
  private sizes: number[] = [];

  get count(): number {
    return this.sizes.length;
  }

  add(p: Vec3, colour: Color, alpha: number, size: number): void {
    this.positions.push(p[0], p[1], p[2]);
    this.tints.push(colour.r, colour.g, colour.b, alpha);
    this.sizes.push(size);
  }

  build(material: ShaderMaterial): Points {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('tint', new BufferAttribute(new Float32Array(this.tints), 4));
    geometry.setAttribute('size', new BufferAttribute(new Float32Array(this.sizes), 1));
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }
}

export function mixColour(a: Color, b: Color, t: number): Color {
  return a.clone().lerp(b, t);
}
