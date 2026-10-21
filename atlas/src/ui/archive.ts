import { azimuthName, horizonPosition, type Observer } from '../core/coords';
import { distanceParts } from '../core/units';
import { constellationName } from '../data/constellations';
import { KIND_LABEL, objectDistance, type AtlasObject } from '../data/objects';
import { fetchSkyChart, type SkyChartObject } from '../data/sky-api';
import { nameOf, subtitleOf, t } from '../core/i18n';
import { observerLabel } from '../data/observer';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatRa(deg: number): string {
  const h = deg / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh}ʰ ${String(mm).padStart(2, '0')}ᵐ`;
}

function formatDec(deg: number): string {
  const sign = deg < 0 ? '−' : '+';
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  return `${sign}${d}° ${String(m).padStart(2, '0')}′`;
}

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[\s·.\-_'’]/g, '');
}

export function matchesChartObject(object: AtlasObject, entry: SkyChartObject): boolean {
  const names = [object.zh, object.en, object.id, ...(object.en ?? '').split('·')].filter(Boolean).map(normaliseName);
  const candidates = [entry.zh, entry.en, entry.key].filter(Boolean).map(normaliseName);
  return candidates.some(c => c.length > 1 && names.some(n => n === c || n.startsWith(c) || c.startsWith(n)));
}

export class ArchivePanel {
  private root: HTMLElement;
  private body: HTMLElement;
  private current: AtlasObject | null = null;
  private abort: AbortController | null = null;
  onClose: () => void = () => {};
  onFly: (object: AtlasObject) => void = () => {};
  onSky: (object: AtlasObject) => void = () => {};

  constructor(root: HTMLElement, private getObserver: () => Observer) {
    this.root = root;
    this.body = root.querySelector('.archive__body') as HTMLElement;
    root.querySelector('.archive__close')?.addEventListener('click', () => this.onClose());
  }

  get object(): AtlasObject | null {
    return this.current;
  }

  hide(): void {
    this.current = null;
    this.abort?.abort();
    this.root.classList.remove('is-open');
    document.body.dataset.panel = 'closed';
  }

  show(object: AtlasObject): void {
    this.current = object;
    this.abort?.abort();
    this.root.classList.add('is-open');
    document.body.dataset.panel = 'open';
    this.render(object);
    this.body.scrollTop = 0;
  }

  refresh(): void {
    if (this.current) this.render(this.current);
  }

  private render(object: AtlasObject): void {
    const body = this.body;
    body.replaceChildren();

    const head = el('header', 'archive__head');
    head.append(
      el('div', 'archive__kind', KIND_LABEL[object.kind]),
      el('h2', 'archive__title', nameOf(object)),
      el('div', 'archive__en', subtitleOf(object))
    );
    body.appendChild(head);

    const stats = el('dl', 'archive__stats');
    const addStat = (label: string, value: string, unit?: string) => {
      const cell = el('div', 'stat');
      const dd = el('dd');
      dd.append(el('span', 'stat__value', value));
      if (unit) dd.append(el('span', 'stat__unit', unit));
      cell.append(el('dt', undefined, label), dd);
      stats.appendChild(cell);
    };
    if (object.kind !== 'sun') {
      const parts = distanceParts(objectDistance(object));
      addStat(object.kind === 'boundary' ? t('半径', 'Radius') : t('距太阳', 'From the Sun'), parts.value, parts.unit);
    }
    if (object.mag !== undefined) addStat(t('视星等', 'Apparent mag'), object.mag.toFixed(2));
    if (object.absmag !== undefined) addStat(t('绝对星等', 'Absolute mag'), object.absmag.toFixed(2));
    if (object.spect) addStat(t('光谱型', 'Spectral type'), object.spect);
    if (object.con) addStat(t('星座', 'Constellation'), constellationName(object.con));
    if (object.ra !== undefined && object.dec !== undefined && object.kind !== 'planet') {
      addStat(t('赤经 / 赤纬', 'RA / Dec'), `${formatRa(object.ra)}  ${formatDec(object.dec)}`);
    }
    if (stats.childElementCount) body.appendChild(stats);

    if (object.desc) body.appendChild(el('p', 'archive__desc', object.desc));

    if (object.facts?.length) {
      const facts = el('ul', 'archive__facts');
      for (const [k, v] of object.facts) {
        const li = el('li');
        li.append(el('span', 'fact__k', k), el('span', 'fact__v', v));
        facts.appendChild(li);
      }
      body.appendChild(facts);
    }

    if (object.ra !== undefined && object.dec !== undefined) body.appendChild(this.renderTonight(object));

    const actions = el('div', 'archive__actions');
    const fly = el('button', 'btn', t('镜头飞往', 'Fly there'));
    fly.type = 'button';
    fly.addEventListener('click', () => this.onFly(object));
    actions.appendChild(fly);
    if ((object.ra !== undefined && object.dec !== undefined) || object.kind === 'planet' || object.kind === 'sun') {
      const skyButton = el('button', 'btn btn--ghost', t('在今晚天空中查看', "See it in tonight's sky"));
      skyButton.type = 'button';
      skyButton.addEventListener('click', () => this.onSky(object));
      actions.appendChild(skyButton);
    }
    body.appendChild(actions);
  }

  private renderTonight(object: AtlasObject): HTMLElement {
    const observer = this.getObserver();
    const now = new Date();
    const h = horizonPosition(object.ra!, object.dec!, observer, now);
    const section = el('section', 'tonight-card');
    const title = el('div', 'tonight-card__title');
    title.append(el('span', undefined, t(`从${observerLabel(observer)}看`, `Seen from ${observerLabel(observer)}`)), el('span', 'tonight-card__coords', `${observer.lat.toFixed(2)}°, ${observer.lon.toFixed(2)}°`));
    section.appendChild(title);

    let status: string;
    let state: string;
    if (h.neverRises) {
      status = t('在你的纬度永远不会升起', 'Never rises at your latitude');
      state = 'never';
    } else if (h.alt > 0) {
      status = t(`此刻在地平线上 ${h.alt.toFixed(0)}° · ${azimuthName(h.az)}方`, `Up now · ${h.alt.toFixed(0)}° above the ${azimuthName(h.az)} horizon`);
      state = h.alt > 15 ? 'up' : 'low';
    } else {
      status = t(`此刻在地平线下 ${Math.abs(h.alt).toFixed(0)}°`, `Below the horizon by ${Math.abs(h.alt).toFixed(0)}°`);
      state = 'down';
    }
    const chip = el('div', `tonight-card__status is-${state}`, status);
    section.appendChild(chip);

    const lines: string[] = [];
    if (!h.neverRises) {
      lines.push(h.circumpolar ? t('拱极天体：整夜都在地平线以上', 'Circumpolar: above the horizon all night') : t(`最高可升到 ${h.maxAlt.toFixed(0)}°`, `Peaks at ${h.maxAlt.toFixed(0)}°`));
      if (h.transit) lines.push(t(`下一次过中天约在 ${formatClock(h.transit)}`, `next transit around ${formatClock(h.transit)}`));
    }
    if (object.kind === 'sun') lines.push(t('请勿直视太阳。', 'Never look directly at the Sun.'));
    if (lines.length) {
      const end = t('。', '.');
      const text = lines.join(t('，', ', '));
      section.appendChild(el('p', 'tonight-card__note', text.endsWith(end) ? text : text + end));
    }

    const verify = el('button', 'btn btn--ghost', t('用星图后端核对', 'Check with the sky backend'));
    verify.type = 'button';
    const result = el('div', 'tonight-card__backend');
    verify.addEventListener('click', () => this.verify(object, verify, result));
    section.append(verify, result);
    return section;
  }

  private async verify(object: AtlasObject, button: HTMLButtonElement, out: HTMLElement): Promise<void> {
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    button.disabled = true;
    out.textContent = t('正在请求 /sky/chart …', 'Requesting /sky/chart …');
    try {
      const chart = await fetchSkyChart(this.getObserver(), controller.signal);
      if (this.current !== object) return;
      const hit = chart.objects.find(entry => matchesChartObject(object, entry));
      out.textContent = hit
        ? t(
            `后端星图：高度 ${hit.altitude.toFixed(1)}°，方位 ${hit.azimuth.toFixed(1)}°（${azimuthName(hit.azimuth)}），已列入今晚推荐目标。`,
            `Backend chart: altitude ${hit.altitude.toFixed(1)}°, azimuth ${hit.azimuth.toFixed(1)}° (${azimuthName(hit.azimuth)}). It is on tonight's list.`
          )
        : t(
            `后端星图返回 ${chart.objects.length} 个目标，其中没有它：可能低于 15° 高度角，或不在亮度筛选范围内。`,
            `The backend returned ${chart.objects.length} targets, not including this one: it may be below 15° altitude or outside the brightness filter.`
          );
    } catch (error) {
      if (controller.signal.aborted) return;
      out.textContent = t(`后端暂不可达（${(error as Error).message}），上面的数值来自本地计算。`, `Backend unreachable (${(error as Error).message}); the values above are computed locally.`);
    } finally {
      button.disabled = false;
    }
  }
}
