import { Vector3 } from 'three';
import type { Vec3 } from '../core/coords';
import type { AtlasObject } from '../data/objects';
import type { Annotation, FrameState } from '../layers/types';
import { nameOf, subtitleOf } from '../core/i18n';
import { solarFocusWeight } from '../layers/constellations';

export interface LabelItem {
  key: string;
  /** Primary text, in the current language. */
  zh: string;
  /** Secondary line: the other language. */
  en?: string;
  pos: Vec3;
  window: [number, number];
  priority: number;
  style: string;
  object?: AtlasObject;
}

interface Placed {
  item: LabelItem;
  x: number;
  y: number;
  score: number;
}

const MAX_LABELS = 38;
const STAR_LABEL_LIMIT_MAG = 3.4;

export function itemFromObject(object: AtlasObject): LabelItem {
  return { key: object.id, zh: nameOf(object), en: subtitleOf(object), pos: object.pos, window: object.label, priority: object.priority, style: object.kind, object };
}

export function itemFromAnnotation(annotation: Annotation): LabelItem {
  return { ...annotation, zh: nameOf(annotation), en: subtitleOf(annotation), style: annotation.style };
}

function apparentMagnitude(object: AtlasObject, camera: Vec3): number {
  const d = Math.max(Math.hypot(object.pos[0] - camera[0], object.pos[1] - camera[1], object.pos[2] - camera[2]), 1e-7);
  return (object.absmag ?? 0) + 5 * (Math.log10(d / 3.261563777) - 1);
}

function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += /[一-鿿]/.test(ch) ? 13 : 7;
  return width;
}

export class LabelLayer {
  private elements = new Map<string, HTMLDivElement>();
  private items: LabelItem[] = [];
  private projected = new Vector3();
  private up = new Vector3();
  private reticle: HTMLDivElement;
  private visible = new Set<string>();
  onSelect: (object: AtlasObject) => void = () => {};

  constructor(private container: HTMLElement) {
    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    this.reticle.innerHTML = '<i></i><i></i><i></i><i></i>';
    container.appendChild(this.reticle);
  }

  setItems(items: LabelItem[]): void {
    this.items = items;
  }

  /** Screen position (CSS px) of a scene point, or null when behind the camera. */
  project(pos: Vec3, frame: FrameState, width: number, height: number): { x: number; y: number } | null {
    const v = this.projected.set(pos[0] - frame.focus[0], pos[1] - frame.focus[1], pos[2] - frame.focus[2]);
    v.applyMatrix4(frame.camera.matrixWorldInverse);
    if (v.z >= 0) return null;
    v.applyMatrix4(frame.camera.projectionMatrix);
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
  }

  private score(item: LabelItem, frame: FrameState): number | null {
    const object = item.object;
    if (object && object.kind === 'sun' && frame.logR > object.label[1]) return null;
    if (object && (object.kind === 'star' || (object.kind === 'sun' && frame.logR > -1))) {
      const m = apparentMagnitude(object, frame.cameraWorld);
      const limit = STAR_LABEL_LIMIT_MAG + Math.max(0, 2.2 - frame.logR) * 0.15;
      if (object.kind === 'star' && (m > limit || frame.logR > object.label[1])) return null;
      return object.kind === 'sun' ? item.priority : 3.6 - m * 0.55;
    }
    if (frame.logR < item.window[0] || frame.logR > item.window[1]) return null;
    // Constellation names go with their figures: only around a Solar System centre.
    if (item.style === 'con' && solarFocusWeight(frame) < 0.5) return null;
    return item.priority;
  }

  /** Screen rectangles (CSS px) covered by UI chrome; labels avoid them. */
  reserved: Array<[number, number, number, number]> = [];

  update(frame: FrameState, width: number, height: number, selected: AtlasObject | null): void {
    const candidates: Placed[] = [];
    for (const item of this.items) {
      const isSelected = selected !== null && item.object === selected;
      const score = isSelected ? 100 : this.score(item, frame);
      if (score === null) continue;
      const screen = this.project(this.anchor(item, frame), frame, width, height);
      if (!screen || screen.x < -40 || screen.y < -20 || screen.x > width + 40 || screen.y > height + 20) continue;
      candidates.push({ item, x: screen.x, y: screen.y, score });
    }
    candidates.sort((a, b) => b.score - a.score);

    const rects: Array<[number, number, number, number]> = [...this.reserved];
    const next = new Set<string>();
    for (const c of candidates) {
      if (next.size >= MAX_LABELS) break;
      const w = Math.max(textWidth(c.item.zh), c.item.en ? textWidth(c.item.en) * 0.82 : 0) + 18;
      const h = c.item.en ? 30 : 18;
      const rect: [number, number, number, number] = [c.x + 6, c.y - h / 2, c.x + 6 + w, c.y + h / 2];
      const overlaps = rects.some(r => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]);
      if (overlaps && c.score < 100) continue;
      rects.push(rect);
      next.add(c.item.key);
      const element = this.element(c.item);
      element.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0)`;
      element.classList.toggle('is-selected', selected !== null && c.item.object === selected);
    }

    for (const key of this.visible) {
      if (!next.has(key)) this.elements.get(key)?.classList.add('is-hidden');
    }
    for (const key of next) this.elements.get(key)?.classList.remove('is-hidden');
    this.visible = next;

    this.updateReticle(frame, width, height, selected);
  }

  private updateReticle(frame: FrameState, width: number, height: number, selected: AtlasObject | null): void {
    const screen = selected ? this.project(selected.pos, frame, width, height) : null;
    if (!selected || !screen) {
      this.reticle.classList.remove('is-active');
      return;
    }
    const d = Math.hypot(selected.pos[0] - frame.cameraWorld[0], selected.pos[1] - frame.cameraWorld[1], selected.pos[2] - frame.cameraWorld[2]);
    const px = (selected.extent / Math.max(d, 1e-12)) * frame.pixelScale;
    const pointLike = selected.kind === 'star' || selected.kind === 'planet' || selected.kind === 'probe';
    const size = pointLike ? 30 : Math.min(Math.max(px * 1.1, 26), Math.min(width, height) * 0.7);
    this.reticle.classList.add('is-active');
    this.reticle.style.transform = `translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0)`;
    this.reticle.style.setProperty('--size', `${size.toFixed(1)}px`);
  }

  /** The horizon label rides the top edge of the sphere rather than its centre. */
  private anchor(item: LabelItem, frame: FrameState): Vec3 {
    const object = item.object;
    if (object?.kind !== 'boundary') return item.pos;
    const up = this.up.setFromMatrixColumn(frame.camera.matrixWorld, 1);
    return [item.pos[0] + up.x * object.extent * 1.02, item.pos[1] + up.y * object.extent * 1.02, item.pos[2] + up.z * object.extent * 1.02];
  }

  pick(x: number, y: number, frame: FrameState, width: number, height: number): AtlasObject | null {
    let best: { object: AtlasObject; d: number } | null = null;
    for (const item of this.items) {
      const object = item.object;
      if (!object) continue;
      const shown = this.visible.has(item.key);
      if (!shown && this.score(item, frame) === null) continue;
      const screen = this.project(this.anchor(item, frame), frame, width, height);
      if (!screen) continue;
      const d = Math.hypot(screen.x - x, screen.y - y) - (shown ? 6 : 0);
      if (d < 22 && (!best || d < best.d)) best = { object, d };
    }
    return best?.object ?? null;
  }

  private element(item: LabelItem): HTMLDivElement {
    let element = this.elements.get(item.key);
    if (element) return element;
    element = document.createElement('div');
    element.className = `label label--${item.style} is-hidden`;
    const mark = document.createElement('span');
    mark.className = 'label__mark';
    const text = document.createElement('span');
    text.className = 'label__text';
    const zh = document.createElement('span');
    zh.className = 'label__zh';
    zh.textContent = item.zh;
    text.appendChild(zh);
    if (item.en && item.en !== item.zh) {
      const en = document.createElement('span');
      en.className = 'label__en';
      en.textContent = item.en;
      text.appendChild(en);
    }
    element.append(mark, text);
    const object = item.object;
    if (object) {
      element.classList.add('is-selectable');
      element.addEventListener('click', event => {
        event.stopPropagation();
        this.onSelect(object);
      });
    }
    this.container.appendChild(element);
    this.elements.set(item.key, element);
    return element;
  }
}
