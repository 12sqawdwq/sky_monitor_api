import { PerspectiveCamera } from 'three';
import { clamp } from './units';
import { lerp3, length, sub, type Vec3 } from './coords';

export const MIN_LOG_R = -5.2; // ~0.4 AU
export const MAX_LOG_R = 11.6; // ~4x the observable universe radius

interface Flight {
  from: Vec3;
  to: Vec3;
  fromLogR: number;
  toLogR: number;
  bump: number;
  t: number;
  duration: number;
  resolve: () => void;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Orbit camera over a float64 focus point. The camera itself always orbits the
 * scene origin; layers are shifted by -focus each frame (floating origin), so
 * the scene stays precise from planetary to cosmological distances.
 */
export class AtlasControls {
  readonly camera: PerspectiveCamera;
  focus: Vec3 = [0, 0, 0];
  logR = 1.6;
  yaw = 0.6;
  pitch = 0.35;
  private targetLogR = this.logR;
  private targetYaw = this.yaw;
  private targetPitch = this.pitch;
  private flight: Flight | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private downAt: { x: number; y: number; time: number } | null = null;
  private idleSeconds = 0;
  /** Off while another view (the sky view) owns the pointer. */
  enabled = true;
  onClick: (x: number, y: number) => void = () => {};
  onInteract: () => void = () => {};

  constructor(camera: PerspectiveCamera, element: HTMLElement) {
    this.camera = camera;
    element.addEventListener('pointerdown', this.handleDown);
    element.addEventListener('pointermove', this.handleMove);
    element.addEventListener('pointerup', this.handleUp);
    element.addEventListener('pointercancel', this.handleUp);
    element.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  get radius(): number {
    return Math.pow(10, this.logR);
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  /** Camera position in scene coordinates (float64). */
  get cameraWorld(): Vec3 {
    const p = this.camera.position;
    return [this.focus[0] + p.x, this.focus[1] + p.y, this.focus[2] + p.z];
  }

  setView(focus: Vec3, logR: number): void {
    this.flight = null;
    this.focus = [...focus];
    this.logR = this.targetLogR = clamp(logR, MIN_LOG_R, MAX_LOG_R);
  }

  zoomTo(logR: number): void {
    this.flight = null;
    this.targetLogR = clamp(logR, MIN_LOG_R, MAX_LOG_R);
  }

  flyTo(focus: Vec3, logR: number, duration?: number): Promise<void> {
    if (this.flight) this.flight.resolve();
    const toLogR = clamp(logR, MIN_LOG_R, MAX_LOG_R);
    const travel = length(sub(focus, this.focus));
    // Pull the camera back far enough to keep both ends of a long hop in view.
    const peak = travel > 0 ? Math.log10(travel * 1.6) : -Infinity;
    const bump = Math.max(0, peak - Math.max(this.logR, toLogR));
    const span = Math.abs(toLogR - this.logR) + bump * 2;
    return new Promise(resolve => {
      this.flight = {
        from: [...this.focus],
        to: [...focus],
        fromLogR: this.logR,
        toLogR,
        bump,
        t: 0,
        duration: duration ?? clamp(1.4 + span * 0.32, 1.4, 5.5),
        resolve
      };
    });
  }

  cancelFlight(): void {
    if (!this.flight) return;
    this.flight.resolve();
    this.targetLogR = this.logR;
    this.flight = null;
  }

  update(dt: number): void {
    const flight = this.flight;
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / flight.duration);
      const e = easeInOut(flight.t);
      // Translate mostly while the camera is pulled back.
      const s = easeInOut(clamp((flight.t - 0.12) / 0.76, 0, 1));
      this.focus = lerp3(flight.from, flight.to, flight.bump > 0 ? s : e);
      this.logR = flight.fromLogR + (flight.toLogR - flight.fromLogR) * e + flight.bump * Math.sin(Math.PI * e);
      this.targetLogR = this.logR;
      if (flight.t >= 1) {
        this.flight = null;
        flight.resolve();
      }
    } else {
      const k = 1 - Math.exp(-dt * 7);
      this.logR += (this.targetLogR - this.logR) * k;
    }

    const k = 1 - Math.exp(-dt * 9);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;

    this.idleSeconds += dt;
    if (this.idleSeconds > 6 && this.pointers.size === 0) {
      this.targetYaw += dt * 0.018;
    }

    const r = this.radius;
    const cp = Math.cos(this.pitch);
    this.camera.position.set(r * cp * Math.sin(this.yaw), r * Math.sin(this.pitch), r * cp * Math.cos(this.yaw));
    this.camera.near = r * 1e-4;
    this.camera.far = Math.max(r * 1e7, 1e3);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  private interact(): void {
    this.idleSeconds = 0;
    this.onInteract();
  }

  private handleDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.downAt = { x: event.clientX, y: event.clientY, time: performance.now() };
    } else {
      this.downAt = null;
      this.pinchDistance = this.currentPinch();
    }
  };

  private handleMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, next);

    if (this.pointers.size >= 2) {
      const distance = this.currentPinch();
      if (this.pinchDistance > 0 && distance > 0) {
        this.cancelFlight();
        this.targetLogR = clamp(this.targetLogR - Math.log10(distance / this.pinchDistance) * 1.6, MIN_LOG_R, MAX_LOG_R);
        this.interact();
      }
      this.pinchDistance = distance;
      return;
    }

    if (this.downAt && Math.hypot(next.x - this.downAt.x, next.y - this.downAt.y) < 4) return;
    this.downAt = null;
    this.targetYaw -= (next.x - previous.x) * 0.0052;
    this.targetPitch = clamp(this.targetPitch + (next.y - previous.y) * 0.0042, -1.45, 1.45);
    this.interact();
  };

  private handleUp = (event: PointerEvent): void => {
    if (this.downAt && this.pointers.size === 1 && performance.now() - this.downAt.time < 450) {
      this.onClick(event.clientX, event.clientY);
    }
    this.pointers.delete(event.pointerId);
    this.downAt = null;
    if (this.pointers.size < 2) this.pinchDistance = 0;
  };

  private handleWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.cancelFlight();
    const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
    this.targetLogR = clamp(this.targetLogR + clamp(delta, -240, 240) * 0.0016, MIN_LOG_R, MAX_LOG_R);
    this.interact();
  };

  private currentPinch(): number {
    const points = [...this.pointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }
}
