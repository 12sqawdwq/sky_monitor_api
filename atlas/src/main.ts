import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/noto-serif-sc/400.css';
import '@fontsource/noto-serif-sc/600.css';
import './styles/atlas.css';
import './styles/sky.css';

import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { AtlasControls } from './core/controls';
import type { Vec3 } from './core/coords';
import { formatDistance } from './core/units';
import { buildCatalogObjects, frameLogR, type AtlasObject } from './data/objects';
import { loadObserver } from './data/observer';
import { EASTER_EGGS } from './data/easter-eggs';
import { loadStarCatalog } from './data/stars';
import { ConstellationLayer } from './layers/constellations';
import { CosmicWebLayer, HorizonLayer } from './layers/cosmic';
import { GalaxiesLayer } from './layers/galaxies';
import { GalaxyLayer } from './layers/galaxy';
import { GraticuleLayer } from './layers/graticule';
import { createDeepSkyModels } from './layers/nebulae';
import { SolarLayer } from './layers/solar';
import { StarLayer } from './layers/stars';
import type { Annotation, FrameState, Layer } from './layers/types';
import { ArchivePanel } from './ui/archive';
import { itemFromAnnotation, itemFromObject, LabelLayer } from './ui/labels';
import { regimeFor, ScaleLadder, scaleBar, STOPS, type ScaleStop } from './ui/scale';
import { SearchBox } from './ui/search';
import { applyStaticTranslations, isEn, nameOf, setLang, t } from './core/i18n';
import { SkyView } from './sky/skyview';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const stage = $('#stage');
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x050505, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(50, 1, 1e-6, 1e6);
const controls = new AtlasControls(camera, stage);
controls.setView([0, 0, 0], -2.2);

let width = 1;
let height = 1;
function resize(): void {
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  skyView?.resize(width, height);
}
window.addEventListener('resize', resize);
let skyView: SkyView | null = null;
resize();

let observer = loadObserver();
let objects: AtlasObject[] = [];
let selected: AtlasObject | null = null;
const byId = new Map<string, AtlasObject>();
const layers: Layer[] = [];

const labels = new LabelLayer($('#labels'));
const archive = new ArchivePanel($('#archive'), () => observer);
const ladder = new ScaleLadder($('#ladder'));
// Easter eggs (optional, from a git-ignored local file) are search entries that stand in for a
// catalogue object, e.g. the Earth, with their own title and text.
function eggObjects(): AtlasObject[] {
  return EASTER_EGGS.flatMap(egg => {
    const target = byId.get(egg.target);
    if (!target) return [];
    return [{ ...target, id: egg.id, zh: egg.zh, en: egg.en ?? egg.zh, nameEn: egg.en ?? egg.zh, subEn: undefined, des: egg.des, priority: 100 }];
  });
}
const search = new SearchBox($('#search'), () => (EASTER_EGGS.length ? [...objects, ...eggObjects()] : objects));
skyView = new SkyView(renderer, {
  stage,
  host: $('.atlas'),
  getObjects: () => objects,
  getObserver: () => observer,
  onObserverChange: next => {
    observer = next;
    archive.refresh();
  },
  onExplore: object => select(object),
  onClose: () => {
    controls.enabled = true;
    setRoute('');
  }
});
skyView.resize(width, height);
const sky = skyView;

/** Sub-features live at sky.eunoia.top/<route>. */
function setRoute(route: string): void {
  const path = `${import.meta.env.BASE_URL}${route}`;
  if (window.location.pathname !== path) history.replaceState(null, '', `${path}${window.location.search}`);
}

function openSky(object?: AtlasObject): void {
  stopTour();
  deselect();
  ui.intro.classList.add('is-hidden');
  controls.enabled = false;
  sky.open(object);
  setRoute('tonight');
}

applyStaticTranslations();

const ui = {
  regimeZh: $('#regime-zh'),
  regimeEn: $('#regime-en'),
  focus: $('#focus-name'),
  distance: $('#view-distance'),
  bar: $('#scalebar'),
  barLabel: $('#scalebar-label'),
  caption: $('#caption'),
  captionStep: $('#caption-step'),
  captionText: $('#caption-text'),
  intro: $('#intro'),
  enter: $<HTMLButtonElement>('#intro-enter'),
  introTour: $<HTMLButtonElement>('#intro-tour')
};

let focusName = t('太阳', 'Sun');

function select(object: AtlasObject, fly = true): void {
  stopTour();
  selected = object;
  focusName = nameOf(object);
  archive.show(object);
  if (fly) void controls.flyTo(object.pos, frameLogR(object));
}

function deselect(): void {
  selected = null;
  archive.hide();
}

archive.onClose = deselect;
archive.onFly = object => void controls.flyTo(object.pos, frameLogR(object));
archive.onSky = object => openSky(object);
labels.onSelect = object => select(object);
search.onSelect = object => {
  const egg = EASTER_EGGS.find(entry => entry.id === object.id);
  const target = egg && byId.get(egg.target);
  if (!egg || !target) {
    select(object);
    return;
  }
  if (egg.observer) skyView.setObserver({ ...egg.observer, source: 'manual' });
  select({
    ...target,
    zh: egg.title.zh,
    en: egg.title.en,
    nameEn: egg.title.en,
    subEn: undefined,
    desc: egg.desc ? t(egg.desc.zh, egg.desc.en) : target.desc
  });
};

controls.onClick = (x, y) => {
  const hit = labels.pick(x, y, frame, width, height);
  if (hit) select(hit);
};

// ------------------------------------------------------------------- tour

let touring = false;
let tourToken = 0;

function stopTour(): void {
  if (!touring) return;
  touring = false;
  tourToken += 1;
  // Stop the camera where it is; the tour loop sees the new token and exits.
  controls.cancelFlight();
  ui.caption.classList.remove('is-active');
}

function showCaption(stop: ScaleStop, index: number): void {
  ui.captionStep.textContent = `${String(index + 1).padStart(2, '0')} / ${String(STOPS.length).padStart(2, '0')} · ${isEn ? stop.zh : stop.en}`;
  ui.captionText.textContent = isEn ? `${stop.en}: ${stop.caption}` : `${stop.zh}：${stop.caption}`;
  ui.caption.classList.add('is-active');
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTour(): Promise<void> {
  stopTour();
  deselect();
  touring = true;
  const token = ++tourToken;
  controls.setView([0, 0, 0], -4.3);
  for (let i = 0; i < STOPS.length; i += 1) {
    const stop = STOPS[i];
    const target = byId.get(stop.focus);
    if (!target) continue;
    focusName = nameOf(target);
    showCaption(stop, i);
    await controls.flyTo(target.pos, stop.logR, i === 0 ? 3.2 : undefined);
    if (token !== tourToken) return;
    await wait(4200);
    if (token !== tourToken) return;
  }
  touring = false;
  ui.caption.classList.remove('is-active');
}

$('#caption-stop').addEventListener('click', stopTour);
controls.onInteract = () => {
  if (touring && !controls.flying) stopTour();
};

function jump(stop: ScaleStop): void {
  stopTour();
  const target = byId.get(stop.focus);
  if (!target) return;
  focusName = nameOf(target);
  deselect();
  void controls.flyTo(target.pos, stop.logR);
}
ladder.onJump = jump;

document.querySelector('[data-action="tonight"]')?.addEventListener('click', () => openSky());
document.querySelector('[data-action="tour"]')?.addEventListener('click', () => void runTour());
document.querySelector('[data-action="lang"]')?.addEventListener('click', () => setLang(isEn ? 'zh' : 'en'));

// Services menu (<details>): close on outside click or Escape.
const services = $<HTMLDetailsElement>('#services');
document.addEventListener('pointerdown', event => {
  if (services.open && !services.contains(event.target as Node)) services.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && services.open) {
    services.open = false;
    services.querySelector('summary')?.focus();
  }
});

window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || sky.active) return;
  if (event.key === 'Escape') {
    stopTour();
    deselect();
  }
});

// -------------------------------------------------------------- frame loop

const frame: FrameState = {
  camera,
  logR: controls.logR,
  radius: controls.radius,
  focus: controls.focus,
  cameraWorld: [0, 0, 0],
  pixelScale: 1,
  dpr: 1,
  time: 0
};

function updateFrame(time: number): void {
  frame.logR = controls.logR;
  frame.radius = controls.radius;
  frame.focus = controls.focus;
  frame.cameraWorld = controls.cameraWorld;
  frame.pixelScale = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  frame.dpr = renderer.getPixelRatio();
  frame.time = time;
}

function placeLayer(layer: Layer, focus: Vec3): void {
  layer.group.position.set(layer.origin[0] - focus[0], layer.origin[1] - focus[1], layer.origin[2] - focus[2]);
}

// Keep the focus centred in whatever part of the screen a side panel leaves free.
let viewShiftX = 0;
let viewShiftY = 0;
function updateViewOffset(dt: number): void {
  const panelOpen = archive.object !== null;
  const narrow = width <= 900;
  const panelWidth = Math.min(400, width * 0.34) + 20;
  const targetX = panelOpen && !narrow ? panelWidth / 2 : 0;
  const targetY = panelOpen && narrow ? height * 0.29 : 0;
  const k = 1 - Math.exp(-dt * 6);
  viewShiftX += (targetX - viewShiftX) * k;
  viewShiftY += (targetY - viewShiftY) * k;
  camera.setViewOffset(width, height, viewShiftX, viewShiftY, width, height);
}

const chrome = ['.brand', '.search', '.actions', '.ladder', '.readout', '.archive.is-open', '.caption.is-active'];
function updateReserved(): void {
  const rects: Array<[number, number, number, number]> = [];
  for (const selector of chrome) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const r = element.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // The ladder's stop names overflow its box.
    const right = selector === '.ladder' && width > 900 ? r.left + 130 : r.right;
    rects.push([r.left - 6, r.top - 6, right + 6, r.bottom + 6]);
  }
  labels.reserved = rects;
}

let last = performance.now();
let hudTick = 0;
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (sky.active) {
    sky.render(dt);
    requestAnimationFrame(loop);
    return;
  }
  updateViewOffset(dt);
  controls.update(dt);
  updateFrame(now / 1000);
  for (const layer of layers) {
    placeLayer(layer, frame.focus);
    layer.update(frame);
  }
  renderer.render(scene, camera);
  labels.update(frame, width, height, selected);

  hudTick += dt;
  if (hudTick > 0.08) {
    hudTick = 0;
    const regime = regimeFor(frame.logR, Math.hypot(...frame.focus), focusName);
    ui.regimeZh.textContent = isEn ? regime.en : regime.zh;
    ui.regimeEn.textContent = isEn ? regime.zh : regime.en;
    ui.focus.textContent = focusName;
    ui.distance.textContent = formatDistance(frame.radius);
    const bar = scaleBar(frame.radius, frame.pixelScale);
    ui.bar.style.width = `${bar.width.toFixed(1)}px`;
    ui.barLabel.textContent = bar.label;
    ladder.update(frame.logR);
    updateReserved();
  }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ boot

async function boot(): Promise<void> {
  const solar = new SolarLayer();
  const graticule = new GraticuleLayer();
  const galaxy = new GalaxyLayer();
  const galaxies = new GalaxiesLayer();
  const cosmic = new CosmicWebLayer();
  const horizon = new HorizonLayer();
  const catalogObjects = buildCatalogObjects();
  layers.push(horizon, cosmic, galaxy, galaxies, graticule, solar, ...createDeepSkyModels(catalogObjects));
  for (const layer of layers) scene.add(layer.group);
  requestAnimationFrame(loop);

  let starObjects: AtlasObject[] = [];
  let constellationNames: Annotation[] = [];
  try {
    const catalog = await loadStarCatalog();
    const stars = new StarLayer(catalog);
    layers.push(stars);
    scene.add(stars.group);
    starObjects = catalog.objects;
    sky.setStars(catalog);
    try {
      const records = await fetch(`${import.meta.env.BASE_URL}data/constellations.json`).then(response => response.json());
      const figures = new ConstellationLayer(catalog, records);
      layers.push(figures);
      scene.add(figures.group);
      constellationNames = figures.annotations;
    } catch (error) {
      console.warn('constellation figures unavailable', error);
    }
    ui.enter.textContent = t('开始探索', 'Start exploring');
  } catch (error) {
    console.error(error);
    ui.enter.textContent = t('星表载入失败，仍可探索', 'Star catalogue failed to load; explore anyway');
  }

  objects = [...solar.objects, ...catalogObjects, ...starObjects];
  for (const object of objects) byId.set(object.id, object);
  labels.setItems([
    ...objects.map(itemFromObject),
    ...galaxy.annotations.map(itemFromAnnotation),
    ...graticule.annotations.map(itemFromAnnotation),
    ...constellationNames.map(itemFromAnnotation)
  ]);

  ui.enter.disabled = false;
  ui.introTour.disabled = false;
  const dismiss = () => ui.intro.classList.add('is-hidden');

  // Sub-feature deep links: sky.eunoia.top/tonight, sky.eunoia.top/tour.
  const route = window.location.pathname.slice(import.meta.env.BASE_URL.length).replace(/\/$/, '');
  if (route === 'tonight') {
    dismiss();
    controls.setView([0, 0, 0], 1.55);
    openSky();
  } else if (route === 'tour') {
    dismiss();
    void runTour();
  }
  ui.enter.addEventListener('click', () => {
    dismiss();
    void controls.flyTo([0, 0, 0], 1.55, 4.2);
  });
  ui.introTour.addEventListener('click', () => {
    dismiss();
    void runTour();
  });
}

void boot();
