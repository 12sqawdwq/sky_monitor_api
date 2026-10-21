import type { Group, PerspectiveCamera } from 'three';
import type { Vec3 } from '../core/coords';
import type { AtlasObject } from '../data/objects';

export interface FrameState {
  camera: PerspectiveCamera;
  logR: number;
  radius: number;
  focus: Vec3;
  cameraWorld: Vec3;
  /** Pixels per unit size at unit distance: viewportHeight / (2 tan(fov/2)). */
  pixelScale: number;
  dpr: number;
  time: number;
}

export interface Layer {
  group: Group;
  /** Scene position of the layer's local origin (float64). */
  origin: Vec3;
  update(frame: FrameState): void;
}

/** Label-only map annotation (arm names, distance rings, ...). */
export interface Annotation {
  key: string;
  zh: string;
  en?: string;
  nameEn?: string;
  subEn?: string;
  pos: Vec3;
  window: [number, number];
  priority: number;
  style: 'region' | 'ring' | 'here' | 'con';
  object?: AtlasObject;
}
