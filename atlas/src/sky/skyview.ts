import { Euler, Matrix4, Quaternion, Vector3, type WebGLRenderer } from 'three';
import { azimuthName, sceneToRaDec, type Observer } from '../core/coords';
import { formatDistance } from '../core/units';
import { constellationName } from '../data/constellations';
import { DEFAULT_OBSERVER, locate, observerLabel, saveObserver } from '../data/observer';
import { KIND_LABEL, objectDistance, type AtlasObject } from '../data/objects';
import { fetchSkyChart, type SkyChartObject } from '../data/sky-api';
import type { StarCatalog } from '../data/stars';
import { geocentricPlanets } from '../layers/solar';
import { matchesChartObject } from '../ui/archive';
import {
  equatorialToHorizontalMatrix,
  equatorialUnit,
  horizontalVector,
  moonPhase,
  moonPosition,
  riseTransitSet,
  sunPosition,
  toHorizontal,
  vectorToHorizontal,
  type RaDec
} from './astro';
import { ridgeAltitude, SkyScene, type ConstellationRecord, type LineMode } from './scene';
import { picksBucket, picksKey, PicksCache } from './picks-cache';
import {
  eclipticLongitudeAtRa,
  eclipticRaDec,
  ESSENTIAL_CONSTELLATIONS,
  mansionAt,
  mansionName,
  mansionWidth,
  SOLAR_TERMS,
  sunOnEcliptic,
  XIANG,
  ZODIAC_CONSTELLATIONS,
  ZODIAC_SIGNS,
  type Mansion
} from '../data/zodiac';
import { isEn, nameOf, setLang, subtitleOf, t } from '../core/i18n';

const DEG = Math.PI / 180;
const MIN_FOV = 12;
const MAX_FOV = 110;
const TIME_LIMIT_MIN = 7 * 24 * 60;

type ItemKind = 'sun' | 'moon' | 'planet' | 'star' | 'deep' | 'con' | 'cardinal' | 'sign' | 'term' | 'mansion' | 'xiang';

/** Labels laid along the ecliptic rather than upright. */
const ALONG_ECLIPTIC = new Set<ItemKind>(['sign', 'term', 'mansion', 'xiang']);
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

interface SkyItem {
  key: string;
  zh: string;
  en: string;
  kind: ItemKind;
  /** Fixed equatorial position; moving bodies supply `positionAt`. */
  radec?: RaDec;
  positionAt?: (date: Date) => RaDec;
  eq: Vector3;
  hor: Vector3;
  mag?: number;
  rank?: number;
  /** Constellation tier: 2 = zodiac, 1 = essential signpost, 0 = other. */
  tier?: number;
  /** Ecliptic labels: a point slightly further along the ecliptic, to orient the text. */
  along?: { eq: Vector3; hor: Vector3; screen: { x: number; y: number; visible: boolean } };
  object?: AtlasObject;
  screen: { x: number; y: number; visible: boolean };
}

const PLANET_MAG: Record<string, number> = { mercury: 0, venus: -4.2, mars: 0.9, jupiter: -2.3, saturn: 0.8, uranus: 5.7, neptune: 7.8 };
const NAKED_EYE_GALAXIES = new Set(['M31', 'M33', 'LMC', 'SMC', 'Sgr A*']);
const CARDINALS: Array<[string, number]> = [0, 45, 90, 135, 180, 225, 270, 315].map(az => [azimuthName(az), az]);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dayLabel(date: Date, reference: Date): string {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const b = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
  const diff = Math.round((a - b) / 86400000);
  const prefix = diff === 0 ? '' : diff === 1 ? t('明天 ', 'tmrw ') : diff === -1 ? t('昨天 ', 'yday ') : `${date.getMonth() + 1}/${date.getDate()} `;
  return `${prefix}${clock(date)}`;
}

function dateLabel(date: Date): string {
  return isEn
    ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : `${date.getMonth() + 1}月${date.getDate()}日 周${'日一二三四五六'[date.getDay()]}`;
}

function shortDate(date: Date): string {
  return isEn ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `${date.getMonth() + 1}月${date.getDate()}日`;
}

function lineLabel(mode: LineMode): string {
  return isEn
    ? `Figures: ${{ essential: 'main', all: 'all', off: 'off' }[mode]}`
    : `星座：${{ essential: '主要', all: '全部', off: '关' }[mode]}`;
}

/** Naked-eye magnitude class: "1 等星" / "1st magnitude". */
function magnitudeClass(mag: number): string {
  const n = mag < -0.5 ? -1 : Math.max(0, Math.round(mag));
  if (!isEn) return `${n < 0 ? '−1' : n} 等星`;
  if (n < 0) return '−1 magnitude';
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix} magnitude`;
}

function offsetLabel(minutes: number): string {
  if (Math.abs(minutes) < 1) return '';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(Math.round(minutes));
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  return `${sign}${d ? `${d}${t('天', 'd ')}` : ''}${h ? `${h}${t('小时', 'h ')}` : ''}${m && !d ? `${m}${t('分', 'm')}` : ''}`.trim();
}

function moonSvg(illumination: number, size: number): string {
  const r = 50;
  const rx = Math.abs(2 * illumination - 1) * r;
  const sweep = illumination > 0.5 ? 1 : 0;
  return `<svg viewBox="-52 -52 104 104" width="${size}" height="${size}" aria-hidden="true">
    <circle r="${r}" fill="#1b1612" stroke="rgba(231,225,213,0.25)" stroke-width="1.5"/>
    <path d="M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} A ${rx.toFixed(2)} ${r} 0 0 ${sweep} 0 ${-r} Z" fill="#efe4cc"/>
  </svg>`;
}

export interface SkyViewOptions {
  stage: HTMLElement;
  host: HTMLElement;
  getObjects: () => AtlasObject[];
  getObserver: () => Observer;
  onObserverChange: (observer: Observer) => void;
  onExplore: (object: AtlasObject) => void;
  onClose: () => void;
}

/** Star Walk-style planetarium: the real sky from the observer's location. */
export class SkyView {
  readonly sky = new SkyScene();
  active = false;
  private root: HTMLElement;
  private labels: HTMLElement;
  private card: HTMLElement;
  private picksList: HTMLElement;
  private picksStatus: HTMLElement;
  private clockDate: HTMLElement;
  private clockTime: HTMLElement;
  private clockOffset: HTMLElement;
  private scrub: HTMLInputElement;
  private playButton: HTMLButtonElement;
  private gyroButton: HTMLButtonElement;
  private whereText: HTMLElement;
  private target: HTMLElement;

  private items: SkyItem[] = [];
  private bodies = new Map<string, SkyItem>();
  private labelEls = new Map<string, HTMLElement>();
  private shownLabels = new Set<string>();
  private selected: SkyItem | null = null;
  private constellations: ConstellationRecord[] = [];
  private lineMode: LineMode = 'essential';
  private showEcliptic = true;
  private showMansions = false;
  private mansions: Mansion[] = [];
  /** Keys of the house, solar term and mansion currently occupied by the Sun / Moon. */
  private current = new Set<string>();
  private starsLoaded = false;

  private yaw = 180 * DEG; // look south by default
  private pitch = 28 * DEG;
  private fov = 64;
  private panTo: { yaw: number; pitch: number; t: number; fromYaw: number; fromPitch: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private downAt: { x: number; y: number; t: number } | null = null;

  private offsetMin = 0;
  private playing = false;
  private matrix = new Matrix4();
  private sunDir = new Vector3();
  private moonLight = 0;
  private phase = moonPhase(new Date());
  private sunLambda = 0;
  private width = 1;
  private height = 1;
  private lastCardRefresh = 0;
  private viewShift = 0;
  private picksTimer = 0;
  private picksAbort: AbortController | null = null;
  /** Backend answers by observer + absolute observation time; in-flight requests tracked apart. */
  private picks = new PicksCache<SkyChartObject[]>();
  /** One planetary computation per observation time, shared by all seven planets. */
  private planetMemo: { time: number; planets: ReturnType<typeof geocentricPlanets> } = { time: NaN, planets: [] };
  /** The card's DOM is built once per selection; refreshes only rewrite these values. */
  private cardView: { item: SkyItem; shape: string; status: HTMLElement; values: HTMLElement[] } | null = null;

  private gyro = false;
  private orientation: { alpha: number; beta: number; gamma: number } | null = null;
  private euler = new Euler();
  private q0 = new Quaternion();
  private q1 = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  private zee = new Vector3(0, 0, 1);

  constructor(private renderer: WebGLRenderer, private options: SkyViewOptions) {
    this.root = el('section', 'sky');
    this.root.setAttribute('aria-label', t('今晚星空', "Tonight's sky"));
    this.root.innerHTML = `
      <div class="sky__labels"></div>
      <div class="sky__target" aria-hidden="true"><i></i></div>
      <header class="sky__top">
        <div class="sky__where">
          <div class="sky__title">${t('今晚星空', "Tonight's Sky")}</div>
          <button type="button" class="sky__loc" data-sky="where"></button>
        </div>
        <div class="sky__time">
          <button type="button" class="sky__step" data-step="-60" aria-label="${t('早一小时', 'One hour earlier')}">−1h</button>
          <div class="sky__clock"><span class="sky__date"></span><span class="sky__hm"></span><span class="sky__offset"></span></div>
          <button type="button" class="sky__step" data-step="60" aria-label="${t('晚一小时', 'One hour later')}">+1h</button>
          <button type="button" class="sky__step sky__play" data-sky="play" aria-label="${t('时间流动', 'Run time')}">▶</button>
          <button type="button" class="chip" data-sky="now">${t('现在', 'Now')}</button>
        </div>
        <div class="sky__tools">
          <button type="button" class="chip is-on" data-sky="lines">${lineLabel('essential')}</button>
          <button type="button" class="chip is-on" data-sky="ecliptic">${t('黄道', 'Ecliptic')}</button>
          <button type="button" class="chip" data-sky="mansions">${t('二十八宿', '28 Mansions')}</button>
          <button type="button" class="chip" data-sky="grid">${t('地平网格', 'Alt-az grid')}</button>
          <button type="button" class="chip" data-sky="gyro" hidden>${t('陀螺仪', 'Gyro')}</button>
          <button type="button" class="chip lang-toggle" data-sky="lang" aria-label="${t('Switch to English', '切换到中文')}">${t('EN', '中文')}</button>
          <button type="button" class="icon-btn" data-sky="close" aria-label="${t('返回宇宙图谱', 'Back to the atlas')}">×</button>
        </div>
      </header>
      <input class="sky__scrub" type="range" min="-720" max="720" step="5" value="0" aria-label="${t('时间轴（前后 12 小时）', 'Timeline (±12 hours)')}" />
      <div class="sky__locmenu" hidden>
        <button type="button" class="chip" data-sky="locate">${t('使用我的位置', 'Use my location')}</button>
        <button type="button" class="chip" data-sky="shanghai">${t('上海', 'Shanghai')}</button>
      </div>
      <aside class="sky__card" aria-live="polite"></aside>
      <div class="sky__picks">
        <div class="sky__picks-head"><span>${t('今晚推荐', 'Tonight’s picks')}</span><span class="sky__picks-status"></span></div>
        <div class="sky__picks-list"></div>
      </div>`;
    options.host.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.labels = q('.sky__labels');
    this.card = q('.sky__card');
    this.picksList = q('.sky__picks-list');
    this.picksStatus = q('.sky__picks-status');
    this.clockDate = q('.sky__date');
    this.clockTime = q('.sky__hm');
    this.clockOffset = q('.sky__offset');
    this.scrub = q<HTMLInputElement>('.sky__scrub');
    this.playButton = q<HTMLButtonElement>('[data-sky="play"]');
    this.gyroButton = q<HTMLButtonElement>('[data-sky="gyro"]');
    this.whereText = q('[data-sky="where"]');
    this.target = q('.sky__target');

    this.root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(button =>
      button.addEventListener('click', () => this.setOffset(this.offsetMin + Number(button.dataset.step)))
    );
    this.scrub.addEventListener('input', () => {
      this.playing = false;
      this.syncPlay();
      this.setOffset(Number(this.scrub.value));
    });
    q('[data-sky="now"]').addEventListener('click', () => {
      this.playing = false;
      this.syncPlay();
      this.setOffset(0);
    });
    this.playButton.addEventListener('click', () => {
      this.playing = !this.playing;
      this.syncPlay();
    });
    q('[data-sky="lines"]').addEventListener('click', event => {
      const order: LineMode[] = ['essential', 'all', 'off'];
      this.lineMode = order[(order.indexOf(this.lineMode) + 1) % order.length];
      const button = event.currentTarget as HTMLElement;
      button.textContent = lineLabel(this.lineMode);
      button.classList.toggle('is-on', this.lineMode !== 'off');
      this.sky.lines = this.lineMode;
    });
    q('[data-sky="ecliptic"]').addEventListener('click', event => {
      this.showEcliptic = (event.currentTarget as HTMLElement).classList.toggle('is-on');
      this.sky.showEcliptic = this.showEcliptic;
    });
    q('[data-sky="mansions"]').addEventListener('click', event => {
      this.showMansions = (event.currentTarget as HTMLElement).classList.toggle('is-on');
      this.sky.showMansions = this.showMansions;
    });
    q('[data-sky="grid"]').addEventListener('click', event => {
      this.sky.showGrid = (event.currentTarget as HTMLElement).classList.toggle('is-on');
    });
    q('[data-sky="close"]').addEventListener('click', () => this.close());
    q('[data-sky="lang"]').addEventListener('click', () => setLang(isEn ? 'zh' : 'en'));
    this.whereText.addEventListener('click', () => {
      const menu = q('.sky__locmenu');
      menu.hidden = !menu.hidden;
    });
    q('[data-sky="locate"]').addEventListener('click', () => this.useLocation());
    q('[data-sky="shanghai"]').addEventListener('click', () => this.setObserver({ ...DEFAULT_OBSERVER }));
    this.gyroButton.addEventListener('click', () => void this.toggleGyro());
    if ('DeviceOrientationEvent' in window && window.matchMedia('(pointer: coarse)').matches) this.gyroButton.hidden = false;

    const stage = options.stage;
    stage.addEventListener('pointerdown', this.onDown);
    stage.addEventListener('pointermove', this.onMove);
    stage.addEventListener('pointerup', this.onUp);
    stage.addEventListener('pointercancel', this.onUp);
    stage.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', event => {
      if (!this.active || event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape') {
        if (this.selected) this.deselect();
        else this.close();
      }
    });

    this.buildBodies();
    void fetch(`${import.meta.env.BASE_URL}data/constellations.json`)
      .then(response => (response.ok ? response.json() : []))
      .then((records: ConstellationRecord[]) => {
        this.constellations = records;
        this.sky.setConstellations(records);
        this.rebuildItems();
      })
      .catch(() => undefined);
    void fetch(`${import.meta.env.BASE_URL}data/mansions.json`)
      .then(response => (response.ok ? response.json() : []))
      .then((mansions: Mansion[]) => {
        this.mansions = mansions;
        this.sky.setMansions(mansions);
        this.rebuildItems();
      })
      .catch(() => undefined);
  }

  // ------------------------------------------------------------- lifecycle

  setStars(catalog: StarCatalog): void {
    if (this.starsLoaded) return;
    this.starsLoaded = true;
    this.sky.setStars(catalog);
    this.rebuildItems();
  }

  open(object?: AtlasObject): void {
    this.active = true;
    document.body.dataset.mode = 'sky';
    this.root.classList.add('is-open');
    this.renderWhere();
    this.rebuildItems();
    this.updateSky(new Date(Date.now() + this.offsetMin * 60000));
    const item = object ? this.itemForObject(object) : null;
    if (item) {
      this.lookAt(item, true);
      this.select(item);
    } else {
      this.deselect();
    }
    this.schedulePicks(0);
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    this.playing = false;
    this.syncPlay();
    this.setGyro(false);
    this.root.classList.remove('is-open');
    delete document.body.dataset.mode;
    this.picksAbort?.abort();
    this.picks.cancel();
    this.options.onClose();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.sky.camera.aspect = width / height;
    this.sky.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    if (this.playing) this.setOffset(this.offsetMin + dt * 10, false);
    const date = new Date(Date.now() + this.offsetMin * 60000);
    this.updateSky(date);
    this.updateViewShift(dt);
    this.updateCamera(dt);
    this.sky.update({
      sunDir: this.sunDir,
      sunLambda: this.sunLambda,
      fov: this.fov,
      dpr: this.renderer.getPixelRatio(),
      moonLight: this.moonLight,
      time: performance.now() / 1000,
      twinkle: REDUCED_MOTION.matches ? 0.25 : 1
    });
    this.renderer.render(this.sky.scene, this.sky.camera);
    this.updateLabels();
    this.updateClock(date);
    this.lastCardRefresh += dt;
    if (this.selected && this.lastCardRefresh > 1) this.renderCard(this.selected, date);
  }

  // ----------------------------------------------------------------- data

  private buildBodies(): void {
    const sun: SkyItem = this.makeItem({ key: 'sun', zh: t('太阳', 'Sun'), en: t('Sun', '太阳'), kind: 'sun', positionAt: sunPosition, mag: -26.7 });
    const moon: SkyItem = this.makeItem({ key: 'moon', zh: t('月亮', 'Moon'), en: t('Moon', '月亮'), kind: 'moon', positionAt: moonPosition, mag: -12 });
    this.bodies.set('sun', sun);
    this.bodies.set('moon', moon);
    for (const planet of geocentricPlanets(new Date())) {
      if (planet.id === 'pluto') continue;
      const id = planet.id;
      this.bodies.set(id, this.makeItem({
        key: id,
        zh: nameOf(planet),
        en: subtitleOf(planet),
        kind: 'planet',
        positionAt: date => this.planetsAt(date).find(p => p.id === id)!,
        mag: PLANET_MAG[id]
      }));
    }
  }

  private planetsAt(date: Date): ReturnType<typeof geocentricPlanets> {
    const time = date.getTime();
    if (this.planetMemo.time !== time) this.planetMemo = { time, planets: geocentricPlanets(date) };
    return this.planetMemo.planets;
  }

  private makeItem(partial: Omit<SkyItem, 'eq' | 'hor' | 'screen' | 'along'>): SkyItem {
    const item: SkyItem = { ...partial, eq: new Vector3(), hor: new Vector3(), screen: { x: 0, y: 0, visible: false } };
    if (item.radec) equatorialUnit(item.radec, item.eq);
    return item;
  }

  /** A label on the ecliptic at (λ, β), oriented along it. */
  private eclipticItem(partial: Omit<SkyItem, 'eq' | 'hor' | 'screen' | 'along' | 'radec'>, lambda: number, beta: number): SkyItem {
    const item = this.makeItem({ ...partial, radec: eclipticRaDec(lambda, beta) });
    item.along = { eq: equatorialUnit(eclipticRaDec(lambda + 1, beta), new Vector3()), hor: new Vector3(), screen: { x: 0, y: 0, visible: false } };
    return item;
  }

  private rebuildItems(): void {
    const objects = this.options.getObjects();
    const byId = new Map(objects.map(o => [o.id, o]));
    for (const [id, item] of this.bodies) item.object = byId.get(id === 'sun' ? 'sun' : id);
    const items: SkyItem[] = [...this.bodies.values()];

    for (const object of objects) {
      if (object.kind === 'star' && object.ra !== undefined && object.dec !== undefined && object.mag !== undefined && object.mag <= 4.6 && !object.zh.startsWith('HIP')) {
        items.push(this.makeItem({ key: object.id, zh: nameOf(object), en: subtitleOf(object), kind: 'star', radec: { ra: object.ra, dec: object.dec }, mag: object.mag, object }));
      } else if (['nebula', 'cluster', 'globular', 'galaxy', 'core'].includes(object.kind)) {
        const naked = NAKED_EYE_GALAXIES.has(object.id);
        if (!naked && (object.mag === undefined || object.mag > 7)) continue;
        if (object.id === 'Milky Way') continue;
        const radec = object.ra !== undefined && object.dec !== undefined ? { ra: object.ra, dec: object.dec } : sceneToRaDec(object.pos);
        items.push(this.makeItem({ key: object.id, zh: nameOf(object), en: subtitleOf(object), kind: 'deep', radec, mag: object.mag ?? 4, object }));
      }
    }
    for (const c of this.constellations) {
      if (!c.label) continue;
      const tier = ZODIAC_CONSTELLATIONS.has(c.id) ? 2 : ESSENTIAL_CONSTELLATIONS.has(c.id) ? 1 : 0;
      items.push(this.makeItem({ key: `con:${c.id}`, zh: constellationName(c.id), en: c.id, kind: 'con', radec: { ra: c.label[0], dec: c.label[1] }, rank: c.rank, tier }));
    }
    // Inside the zodiac band: houses on the south half, solar terms just north of their
    // ticks, mansions further north between their boundary hour circles.
    ZODIAC_SIGNS.forEach((zh, k) => {
      items.push(this.eclipticItem({ key: `sign:${k}`, zh, en: '', kind: 'sign' }, 15 + 30 * k, -4.4));
    });
    SOLAR_TERMS.forEach((zh, k) => {
      items.push(this.eclipticItem({ key: `term:${k}`, zh, en: '', kind: 'term', rank: k }, 15 * k, 1.9));
    });
    this.mansions.forEach((mansion, k) => {
      const start = eclipticLongitudeAtRa(mansion.det[0]);
      const end = eclipticLongitudeAtRa(mansion.det[0] + mansionWidth(this.mansions, k));
      const mid = start + ((end - start + 360) % 360) / 2;
      items.push(this.eclipticItem({ key: `mansion:${k}`, zh: mansionName(mansion), en: '', kind: 'mansion', rank: k }, mid, 5.6));
    });
    if (this.mansions.length === 28) {
      XIANG.forEach((zh, x) => {
        // Centre of the symbol: middle of its fourth mansion.
        const mansion = this.mansions[x * 7 + 3];
        const lambda = eclipticLongitudeAtRa(mansion.det[0] + mansionWidth(this.mansions, x * 7 + 3) / 2);
        items.push(this.eclipticItem({ key: `xiang:${x}`, zh, en: '', kind: 'xiang', rank: x }, lambda, 11.5));
      });
    }
    for (const [zh, az] of CARDINALS) {
      const item = this.makeItem({ key: `dir:${zh}`, zh, en: '', kind: 'cardinal' });
      horizontalVector({ alt: 0.6, az }, item.hor);
      items.push(item);
    }
    this.items = items;
  }

  private itemForObject(object: AtlasObject): SkyItem | null {
    return this.items.find(item => item.object === object) ?? (object.id === 'sun' ? this.bodies.get('sun')! : null);
  }

  private updateSky(date: Date): void {
    const observer = this.options.getObserver();
    equatorialToHorizontalMatrix(observer, date, this.matrix);
    this.sky.celestial.matrix.copy(this.matrix);
    this.sky.celestial.matrixWorldNeedsUpdate = true;

    for (const item of this.bodies.values()) {
      if (item.positionAt) equatorialUnit(item.positionAt(date), item.eq);
    }
    for (const item of this.items) {
      if (item.kind !== 'cardinal') item.hor.copy(item.eq).applyMatrix4(this.matrix);
      if (item.along) item.along.hor.copy(item.along.eq).applyMatrix4(this.matrix);
    }
    this.updateCurrent(date);
    this.sunDir.copy(this.bodies.get('sun')!.hor);
    this.phase = moonPhase(date);
    const moonAlt = this.bodies.get('moon')!.hor.y;
    this.moonLight = moonAlt > 0 ? this.phase.illumination * Math.min(1, moonAlt * 4) : 0;
  }

  /** Which house and solar term hold the Sun, and which mansion holds the Moon. */
  private updateCurrent(date: Date): void {
    const lambda = sunPosition(date).lambda;
    this.sunLambda = lambda;
    const current = new Set<string>([`sign:${Math.floor(lambda / 30) % 12}`, `term:${Math.floor(lambda / 15) % 24}`]);
    const moon = mansionAt(this.mansions, moonPosition(date).ra);
    if (moon) current.add(`mansion:${moon.index}`);
    this.current = current;
  }

  // --------------------------------------------------------------- camera

  private updateCamera(dt: number): void {
    const camera = this.sky.camera;
    if (this.gyro && this.orientation) {
      const { alpha, beta, gamma } = this.orientation;
      const orient = ((screen.orientation?.angle ?? 0) * DEG);
      this.euler.set(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ');
      camera.quaternion.setFromEuler(this.euler);
      camera.quaternion.multiply(this.q1);
      camera.quaternion.multiply(this.q0.setFromAxisAngle(this.zee, -orient));
      camera.updateMatrixWorld();
      return;
    }
    if (this.panTo) {
      const p = this.panTo;
      p.t = Math.min(1, p.t + dt / 0.9);
      const e = p.t < 0.5 ? 4 * p.t ** 3 : 1 - (-2 * p.t + 2) ** 3 / 2;
      this.yaw = p.fromYaw + (p.yaw - p.fromYaw) * e;
      this.pitch = p.fromPitch + (p.pitch - p.fromPitch) * e;
      if (p.t >= 1) this.panTo = null;
    }
    camera.rotation.set(this.pitch, -this.yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
  }

  /** On narrow screens the card is a bottom sheet: keep the target above it. */
  private updateViewShift(dt: number): void {
    const target = this.selected && this.width <= 900 ? this.height * 0.24 : 0;
    this.viewShift += (target - this.viewShift) * (1 - Math.exp(-dt * 6));
    this.sky.camera.setViewOffset(this.width, this.height, 0, this.viewShift, this.width, this.height);
  }

  private lookAt(item: SkyItem, instant = false): void {
    const h = vectorToHorizontal(item.hor);
    const pitch = Math.max(-5, Math.min(80, h.alt)) * DEG;
    let yaw = h.az * DEG;
    // Shortest way round.
    while (yaw - this.yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw - this.yaw < -Math.PI) yaw += Math.PI * 2;
    if (instant) {
      this.yaw = yaw;
      this.pitch = pitch;
      this.panTo = null;
    } else {
      this.panTo = { yaw, pitch, t: 0, fromYaw: this.yaw, fromPitch: this.pitch };
    }
  }

  private onDown = (event: PointerEvent): void => {
    if (!this.active) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) this.downAt = { x: event.clientX, y: event.clientY, t: performance.now() };
    else {
      this.downAt = null;
      this.pinch = this.pinchDistance();
    }
  };

  private onMove = (event: PointerEvent): void => {
    if (!this.active) return;
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, next);
    if (this.pointers.size >= 2) {
      const distance = this.pinchDistance();
      if (this.pinch > 0 && distance > 0) this.fov = Math.min(MAX_FOV, Math.max(MIN_FOV, this.fov * (this.pinch / distance)));
      this.pinch = distance;
      return;
    }
    if (this.downAt && Math.hypot(next.x - this.downAt.x, next.y - this.downAt.y) < 4) return;
    this.downAt = null;
    if (this.gyro) return;
    this.panTo = null;
    const perPixel = (this.fov * DEG) / this.height;
    this.yaw -= (next.x - previous.x) * perPixel;
    this.pitch = Math.max(-12 * DEG, Math.min(89 * DEG, this.pitch + (next.y - previous.y) * perPixel));
  };

  private onUp = (event: PointerEvent): void => {
    if (!this.active) return;
    if (this.downAt && this.pointers.size === 1 && performance.now() - this.downAt.t < 450) this.pick(event.clientX, event.clientY);
    this.pointers.delete(event.pointerId);
    this.downAt = null;
    if (this.pointers.size < 2) this.pinch = 0;
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.active) return;
    event.preventDefault();
    this.fov = Math.min(MAX_FOV, Math.max(MIN_FOV, this.fov * Math.exp(Math.max(-200, Math.min(200, event.deltaY)) * 0.0012)));
  };

  private pinchDistance(): number {
    const p = [...this.pointers.values()];
    return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  private async toggleGyro(): Promise<void> {
    if (this.gyro) {
      this.setGyro(false);
      return;
    }
    const request = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (request) {
      try {
        if ((await request()) !== 'granted') return;
      } catch {
        return;
      }
    }
    this.setGyro(true);
  }

  private setGyro(on: boolean): void {
    if (on === this.gyro) return;
    this.gyro = on;
    this.gyroButton.classList.toggle('is-on', on);
    const absolute = 'ondeviceorientationabsolute' in window;
    const type = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
    if (on) window.addEventListener(type, this.onOrientation as EventListener);
    else {
      window.removeEventListener(type, this.onOrientation as EventListener);
      this.orientation = null;
      // Hand back to drag control facing the same way.
      const dir = new Vector3(0, 0, -1).applyQuaternion(this.sky.camera.quaternion);
      const h = vectorToHorizontal(dir);
      this.yaw = h.az * DEG;
      this.pitch = h.alt * DEG;
    }
  }

  private onOrientation = (event: DeviceOrientationEvent & { webkitCompassHeading?: number }): void => {
    if (event.beta === null || event.gamma === null) return;
    const alpha = event.webkitCompassHeading !== undefined ? 360 - event.webkitCompassHeading : event.alpha ?? 0;
    this.orientation = { alpha, beta: event.beta, gamma: event.gamma };
  };

  // ----------------------------------------------------------------- time

  private setOffset(minutes: number, refreshPicks = true): void {
    this.offsetMin = Math.max(-TIME_LIMIT_MIN, Math.min(TIME_LIMIT_MIN, minutes));
    if (this.offsetMin >= TIME_LIMIT_MIN) this.playing = false;
    this.scrub.value = String(Math.max(-720, Math.min(720, Math.round(this.offsetMin))));
    if (this.selected) this.lastCardRefresh = 2;
    if (refreshPicks) this.schedulePicks(700);
  }

  private syncPlay(): void {
    this.playButton.textContent = this.playing ? '❚❚' : '▶';
    this.playButton.classList.toggle('is-on', this.playing);
    if (!this.playing) this.schedulePicks(500);
  }

  private updateClock(date: Date): void {
    this.clockDate.textContent = dateLabel(date);
    this.clockTime.textContent = clock(date);
    this.clockOffset.textContent = offsetLabel(this.offsetMin);
  }

  // --------------------------------------------------------------- labels

  private project(v: Vector3, out: SkyItem['screen']): void {
    const camera = this.sky.camera;
    const p = v.clone().multiplyScalar(30).applyMatrix4(camera.matrixWorldInverse);
    if (p.z >= 0) {
      out.visible = false;
      return;
    }
    p.applyMatrix4(camera.projectionMatrix);
    out.x = (p.x * 0.5 + 0.5) * this.width;
    out.y = (-p.y * 0.5 + 0.5) * this.height;
    out.visible = out.x > -60 && out.x < this.width + 60 && out.y > -40 && out.y < this.height + 40;
  }

  private priority(item: SkyItem): number | null {
    const zoom = 64 / this.fov;
    switch (item.kind) {
      case 'cardinal':
        return 200;
      case 'sun':
      case 'moon':
        return 150;
      case 'planet':
        return item.mag! < 6.5 + Math.log10(zoom) * 3 ? 120 - item.mag! : null;
      case 'con': {
        if (this.lineMode === 'off') return null;
        if (this.lineMode === 'essential' && item.tier === 0) return null;
        const shown = item.tier! > 0 || item.rank! <= (zoom > 1.4 ? 3 : 2);
        return shown ? 52 + item.tier! * 6 - item.rank! * 2 : null;
      }
      case 'sign':
        return this.showEcliptic ? (this.current.has(item.key) ? 70 : 64) : null;
      case 'mansion':
        return this.showMansions ? (this.current.has(item.key) ? 68 : 58) : null;
      case 'xiang':
        return this.showMansions && zoom < 1.3 ? 46 : null;
      case 'term':
        // The four seasonal pivots always show; the rest once zoomed in.
        if (!this.showEcliptic) return null;
        if (this.current.has(item.key)) return 56;
        return item.rank! % 6 === 0 || zoom > 1.25 ? (item.rank! % 6 === 0 ? 50 : 36) : null;
      case 'star':
        return item.mag! < 1.6 + Math.log10(zoom) * 3.2 ? 90 - item.mag! * 8 : null;
      case 'deep':
        return item.mag! < 4.6 + Math.log10(zoom) * 3 ? 70 - item.mag! * 3 : null;
    }
  }

  private updateLabels(): void {
    const placed: Array<[number, number, number, number]> = [];
    const next = new Set<string>();
    const zoom = 64 / this.fov;
    const candidates: Array<{ item: SkyItem; score: number }> = [];
    for (const item of this.items) {
      this.project(item.hor, item.screen);
      if (!item.screen.visible) continue;
      if (item.along) this.project(item.along.hor, item.along.screen);
      const score = item === this.selected ? 999 : this.priority(item);
      if (score === null) continue;
      candidates.push({ item, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    const limit = Math.round(26 + zoom * 10);
    for (const { item, score } of candidates) {
      if (next.size >= limit) break;
      const isBody = item.kind === 'sun' || item.kind === 'moon' || item.kind === 'planet';
      const w = item.zh.length * 13 + 22;
      const h = 18;
      const centred = item.kind === 'con' || item.kind === 'cardinal' || ALONG_ECLIPTIC.has(item.kind);
      const rect: [number, number, number, number] = centred
        ? [item.screen.x - w / 2, item.screen.y - h / 2, item.screen.x + w / 2, item.screen.y + h / 2]
        : [item.screen.x + 6, item.screen.y - h / 2, item.screen.x + 6 + w, item.screen.y + h / 2];
      const overlaps = placed.some(r => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]);
      if (overlaps && !isBody && score < 999) continue;
      placed.push(rect);
      next.add(item.key);
      this.placeLabel(item, zoom);
    }
    for (const key of this.shownLabels) if (!next.has(key)) this.labelEls.get(key)?.classList.add('is-hidden');
    this.shownLabels = next;

    const selected = this.selected;
    if (selected && selected.screen.visible) {
      this.target.classList.add('is-active');
      this.target.style.transform = `translate3d(${selected.screen.x.toFixed(1)}px, ${selected.screen.y.toFixed(1)}px, 0)`;
    } else {
      this.target.classList.remove('is-active');
    }
  }

  private placeLabel(item: SkyItem, zoom: number): void {
    let element = this.labelEls.get(item.key);
    if (!element) {
      element = el('div', `sky-label sky-label--${item.kind}`);
      if (item.kind === 'sun' || item.kind === 'moon' || item.kind === 'planet') element.appendChild(el('span', 'sky-label__body'));
      element.appendChild(el('span', 'sky-label__text', item.zh));
      this.labels.appendChild(element);
      this.labelEls.set(item.key, element);
    }
    element.classList.remove('is-hidden');
    const below = item.kind !== 'cardinal' && vectorToHorizontal(item.hor).alt < ridgeAltitude(vectorToHorizontal(item.hor).az * DEG) / DEG;
    element.classList.toggle('is-below', below);
    element.classList.toggle('is-selected', item === this.selected);
    element.classList.toggle('is-current', this.current.has(item.key));
    let rotate = '';
    if (item.along) {
      let angle = (Math.atan2(item.along.screen.y - item.screen.y, item.along.screen.x - item.screen.x) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      rotate = ` rotate(${angle.toFixed(1)}deg)`;
    }
    element.style.transform = `translate3d(${item.screen.x.toFixed(1)}px, ${item.screen.y.toFixed(1)}px, 0)${rotate}`;
    if (item.kind === 'moon') {
      const size = Math.max(22, (0.52 / this.fov) * this.height * 1.0);
      const body = element.firstElementChild as HTMLElement;
      const key = `${Math.round(this.phase.illumination * 100)}:${Math.round(size)}`;
      if (body.dataset.key !== key) {
        body.dataset.key = key;
        body.innerHTML = moonSvg(this.phase.illumination, size);
      }
      body.style.transform = `translate(-50%, -50%) rotate(${this.moonTilt().toFixed(1)}deg)`;
    } else if (item.kind === 'sun') {
      const size = Math.max(18, (0.53 / this.fov) * this.height);
      (element.firstElementChild as HTMLElement).style.setProperty('--size', `${size}px`);
    } else if (item.kind === 'planet') {
      const size = Math.max(4, Math.min(9, 7 - item.mag! * 0.7)) * Math.min(1.4, Math.sqrt(zoom));
      (element.firstElementChild as HTMLElement).style.setProperty('--size', `${size.toFixed(1)}px`);
    }
  }

  /** Screen angle from the Moon towards the Sun, so the lit limb faces it. */
  private moonTilt(): number {
    const moon = this.bodies.get('moon')!.hor;
    const sun = this.bodies.get('sun')!.hor;
    const tangent = sun.clone().sub(moon.clone().multiplyScalar(sun.dot(moon))).normalize();
    const a: SkyItem['screen'] = { x: 0, y: 0, visible: false };
    const b: SkyItem['screen'] = { x: 0, y: 0, visible: false };
    this.project(moon, a);
    this.project(moon.clone().addScaledVector(tangent, 0.01).normalize(), b);
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  }

  // ------------------------------------------------------------ selection

  private pick(x: number, y: number): void {
    let best: { item: SkyItem; d: number } | null = null;
    for (const item of this.items) {
      if (['cardinal', 'con', 'sign', 'term', 'mansion', 'xiang'].includes(item.kind) || !item.screen.visible) continue;
      const shown = this.shownLabels.has(item.key);
      const d = Math.hypot(item.screen.x - x, item.screen.y - y) - (shown ? 8 : 0);
      if (d < 24 && (!best || d < best.d)) best = { item, d };
    }
    if (best) this.select(best.item);
    else this.deselect();
  }

  private select(item: SkyItem): void {
    this.selected = item;
    this.root.classList.add('has-card');
    this.renderCard(item, new Date(Date.now() + this.offsetMin * 60000));
  }

  private deselect(): void {
    this.selected = null;
    this.root.classList.remove('has-card');
  }

  private positionOf(item: SkyItem, date: Date): RaDec {
    return item.positionAt ? item.positionAt(date) : item.radec!;
  }

  /** Everything the card shows for `item` at `date`, as label/value pairs. */
  private cardModel(item: SkyItem, date: Date): {
    kind: string;
    status: string;
    up: boolean;
    stats: Array<[string, string]>;
    times: Array<[string, string]>;
    note: string | null;
  } {
    const observer = this.options.getObserver();
    const h = toHorizontal(this.positionOf(item, date), observer, date);
    const horizon = item.kind === 'sun' ? -0.833 : item.kind === 'moon' ? 0.125 : -0.5667;
    const events = riseTransitSet(d => this.positionOf(item, d), observer, date, horizon);

    const kind = item.kind === 'moon'
      ? t('卫星 · 月球', 'Satellite · the Moon')
      : item.kind === 'deep' && item.object ? KIND_LABEL[item.object.kind] : item.kind === 'sun' ? KIND_LABEL.sun : item.kind === 'planet' ? KIND_LABEL.planet : KIND_LABEL.star;

    const stats: Array<[string, string]> = [];
    const stat = (k: string, v: string) => stats.push([k, v]);
    stat(t('高度', 'Altitude'), `${h.alt.toFixed(1)}°`);
    stat(t('方位', 'Azimuth'), `${h.az.toFixed(0)}° ${azimuthName(h.az)}`);
    if (item.kind === 'moon') {
      const moon = moonPosition(date);
      stat(t('月相', 'Phase'), `${this.phase.name} ${Math.round(this.phase.illumination * 100)}%`);
      stat(t('距离', 'Distance'), `${Math.round(moon.distanceKm).toLocaleString('en-US')} ${t('千米', 'km')}`);
      const lodge = mansionAt(this.mansions, moon.ra);
      if (lodge) stat(t('月宿', 'Lunar mansion'), `${mansionName(lodge.mansion)} · ${XIANG[lodge.mansion.xiang]}`);
    } else if (item.kind === 'planet') {
      const planet = this.planetsAt(date).find(p => p.id === item.key);
      if (planet) stat(t('距地球', 'From Earth'), `${planet.distance.toFixed(2)} ${t('天文单位', 'AU')}`);
      if (item.mag !== undefined) stat(t('亮度', 'Magnitude'), t(`约 ${item.mag.toFixed(1)} 等`, `about ${item.mag.toFixed(1)}`));
    } else if (item.kind === 'sun') {
      const sun = sunOnEcliptic(date);
      stat(t('黄道位置', 'On the ecliptic'), `${sun.sign} · ${t('黄经', 'λ')} ${sun.lambda.toFixed(1)}°`);
      stat(t('节气', 'Solar term'), `${sun.term} → ${sun.nextTerm} ${shortDate(sun.nextTermDate)}`);
      const lodge = mansionAt(this.mansions, sunPosition(date).ra);
      if (lodge) stat(t('日躔', 'Solar mansion'), `${mansionName(lodge.mansion)} ${lodge.offset.toFixed(0)}° / ${mansionWidth(this.mansions, lodge.index).toFixed(0)}°`);
    } else if (item.object) {
      if (item.mag !== undefined) {
        const grade = item.kind === 'star' ? ` · ${magnitudeClass(item.mag)}` : '';
        stat(t('星等', 'Magnitude'), `${item.mag.toFixed(2)}${grade}`);
      }
      stat(t('距离', 'Distance'), formatDistance(objectDistance(item.object)));
    }

    const times: Array<[string, string]> = [];
    let note: string | null = null;
    const time = (k: string, d: Date | null, fallback: string) => times.push([k, d ? dayLabel(d, date) : fallback]);
    if (events.neverRises) {
      note = t('在你的纬度，它此时不会升到地平线以上。', 'At your latitude it does not rise above the horizon at this time.');
    } else if (events.circumpolar) {
      time(t('升起', 'Rise'), null, t('拱极', 'circumpolar'));
      time(t('中天', 'Transit'), events.transit, '—');
      time(t('落下', 'Set'), null, t('不落', 'never'));
    } else {
      time(t('升起', 'Rise'), events.rise, '—');
      time(t('中天', 'Transit'), events.transit, '—');
      time(t('落下', 'Set'), events.set, '—');
    }

    const status = item.kind === 'sun'
      ? t('请勿直视太阳', 'Never look directly at the Sun')
      : h.alt > 0
        ? h.alt < 10 ? t('贴近地平线，需要开阔的视野', 'Low on the horizon: you need a clear view') : t('此刻可见', 'Visible now')
        : t('此刻在地平线以下', 'Below the horizon now');
    return { kind, status, up: h.alt > 0, stats, times, note };
  }

  private renderCard(item: SkyItem, date: Date): void {
    this.lastCardRefresh = 0;
    const model = this.cardModel(item, date);
    const shape = [...model.stats.map(([k]) => k), '#', model.note ?? model.times.map(([k]) => k).join('|')].join('|');
    const values = [...model.stats.map(([, v]) => v), ...model.times.map(([, v]) => v)];

    // Same object, same rows: rewrite the numbers only, so buttons keep focus.
    const view = this.cardView;
    if (view && view.item === item && view.shape === shape) {
      view.status.textContent = model.status;
      view.status.classList.toggle('is-up', model.up);
      values.forEach((value, index) => {
        if (view.values[index].textContent !== value) view.values[index].textContent = value;
      });
      return;
    }

    const card = this.card;
    card.replaceChildren();
    const close = el('button', 'icon-btn sky__card-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', t('关闭', 'Close'));
    close.addEventListener('click', () => this.deselect());

    const head = el('div', 'sky__card-head');
    head.append(el('div', 'sky__card-kind', model.kind), el('h3', 'sky__card-title', item.zh), el('div', 'sky__card-en', item.en));

    const valueEls: HTMLElement[] = [];
    const stats = el('div', 'sky__card-stats');
    for (const [k, v] of model.stats) {
      const cell = el('div', 'sky__stat');
      const value = el('span', 'sky__stat-v', v);
      cell.append(el('span', 'sky__stat-k', k), value);
      stats.appendChild(cell);
      valueEls.push(value);
    }

    const timeline = el('div', 'sky__card-times');
    if (model.note) {
      timeline.appendChild(el('p', 'sky__card-note', model.note));
    } else {
      for (const [k, v] of model.times) {
        const cell = el('div', 'sky__time-cell');
        const value = el('span', 'sky__stat-v', v);
        cell.append(el('span', 'sky__stat-k', k), value);
        timeline.appendChild(cell);
        valueEls.push(value);
      }
    }

    const statusEl = el('div', `sky__card-status${model.up ? ' is-up' : ''}`, model.status);

    const actions = el('div', 'sky__card-actions');
    const center = el('button', 'btn btn--ghost', t('居中', 'Centre'));
    center.type = 'button';
    center.addEventListener('click', () => this.lookAt(item));
    actions.appendChild(center);
    const object = item.object;
    if (object) {
      const explore = el('button', 'btn', t('在宇宙中查看', 'Show in the atlas'));
      explore.type = 'button';
      explore.addEventListener('click', () => {
        this.close();
        this.options.onExplore(object);
      });
      actions.appendChild(explore);
    }

    card.append(close, head, statusEl, stats, timeline, actions);
    this.cardView = { item, shape, status: statusEl, values: valueEls };
  }

  // ---------------------------------------------------------------- picks

  private schedulePicks(delay: number): void {
    if (!this.active) return;
    window.clearTimeout(this.picksTimer);
    this.picksTimer = window.setTimeout(() => void this.loadPicks(), delay);
  }

  private async loadPicks(): Promise<void> {
    if (!this.active || this.playing) return;
    const observer = this.options.getObserver();
    const date = new Date(Date.now() + this.offsetMin * 60000);
    const key = picksKey(observer.lat, observer.lon, date);
    const cached = this.picks.get(key);
    if (cached) {
      this.showBackendPicks(cached);
      return;
    }
    if (this.picks.isPending(key)) return;
    this.picksAbort?.abort();
    const controller = new AbortController();
    this.picksAbort = controller;
    const token = this.picks.begin(key);
    this.picksStatus.textContent = t('正在请求星图后端…', 'Asking the sky backend…');
    try {
      const chart = await fetchSkyChart(observer, controller.signal, new Date(picksBucket(date)));
      if (controller.signal.aborted) return;
      this.picks.resolve(token, key, chart.objects);
      this.showBackendPicks(chart.objects);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.renderPicks(this.localPicks(date), t(`后端不可达（${(error as Error).message}），本地计算`, `Backend unreachable (${(error as Error).message}); computed locally`));
    } finally {
      // Cancelled (the view closed) or failed: the next visit asks again.
      this.picks.release(token);
    }
  }

  private showBackendPicks(objects: SkyChartObject[]): void {
    const rows = objects
      // The backend lists the Sun when it is up; it is never a viewing recommendation.
      .filter(entry => entry.altitude > 0 && entry.category !== 'sun')
      .map(entry => ({ entry, item: this.itemForChart(entry) }))
      .filter(row => row.item !== null) as Array<{ entry: SkyChartObject; item: SkyItem }>;
    this.renderPicks(rows.map(row => ({ item: row.item, alt: row.entry.altitude, az: row.entry.azimuth })), t(`sky.eunoia.top · ${rows.length} 个目标`, `sky.eunoia.top · ${rows.length} targets`));
  }

  private itemForChart(entry: SkyChartObject): SkyItem | null {
    if (/moon|月/i.test(`${entry.en}${entry.zh}`)) return this.bodies.get('moon')!;
    return this.items.find(item => item.object && item.kind !== 'con' && matchesChartObject(item.object, entry)) ?? null;
  }

  private localPicks(date: Date): Array<{ item: SkyItem; alt: number; az: number }> {
    const observer = this.options.getObserver();
    const rows: Array<{ item: SkyItem; alt: number; az: number; mag: number }> = [];
    for (const item of this.items) {
      if (!['moon', 'planet', 'star', 'deep'].includes(item.kind)) continue;
      const mag = item.mag ?? 9;
      if (item.kind === 'star' && mag > 1.6) continue;
      if (item.kind === 'deep' && mag > 4.5) continue;
      if (item.kind === 'planet' && mag > 6) continue;
      const h = toHorizontal(this.positionOf(item, date), observer, date);
      if (h.alt < 12) continue;
      rows.push({ item, alt: h.alt, az: h.az, mag });
    }
    return rows.sort((a, b) => a.mag - b.mag).slice(0, 16);
  }

  private renderPicks(rows: Array<{ item: SkyItem; alt: number; az: number }>, status: string): void {
    this.picksStatus.textContent = status;
    const fragment = document.createDocumentFragment();
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.item.key)) continue;
      seen.add(row.item.key);
      const chip = el('button', `sky-pick sky-pick--${row.item.kind}`);
      chip.type = 'button';
      const dir = azimuthName(row.az);
      chip.append(el('span', 'sky-pick__name', row.item.zh), el('span', 'sky-pick__pos', `${row.alt.toFixed(0)}° ${dir}`));
      chip.addEventListener('click', () => {
        this.lookAt(row.item);
        this.select(row.item);
      });
      fragment.appendChild(chip);
    }
    if (!seen.size) fragment.appendChild(el('span', 'sky__picks-empty', t('地平线以上暂时没有推荐目标', 'Nothing to recommend above the horizon right now')));
    this.picksList.replaceChildren(fragment);
  }

  // ------------------------------------------------------------- location

  private renderWhere(): void {
    const o = this.options.getObserver();
    this.whereText.textContent = `${observerLabel(o)} · ${o.lat.toFixed(2)}°, ${o.lon.toFixed(2)}°`;
  }

  /** Switch (and remember) the observer location. */
  setObserver(observer: Observer): void {
    saveObserver(observer);
    this.options.onObserverChange(observer);
    (this.root.querySelector('.sky__locmenu') as HTMLElement).hidden = true;
    this.renderWhere();
    this.schedulePicks(0);
  }

  private async useLocation(): Promise<void> {
    this.picksStatus.textContent = t('正在获取定位…', 'Getting your location…');
    try {
      this.setObserver(await locate());
    } catch (error) {
      this.picksStatus.textContent = t(`${(error as Error).message}，继续使用当前位置`, `${(error as Error).message}; keeping the current location`);
    }
  }
}
