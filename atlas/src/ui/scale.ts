import { MAX_LOG_R, MIN_LOG_R } from '../core/controls';
import { clamp, distanceParts } from '../core/units';
import { isEn, t } from '../core/i18n';

export interface ScaleStop {
  key: string;
  zh: string;
  en: string;
  /** Object id to focus on. */
  focus: string;
  logR: number;
  caption: string;
}

export const STOPS: ScaleStop[] = [
  { key: 'solar', zh: '太阳系', en: 'Solar System', focus: 'sun', logR: -3.05,
    caption: t('八大行星沿着几乎同一个平面绕太阳运行。海王星之外是冰冷的柯伊伯带，旅行者 1 号正从这里飞向星际空间。', 'The eight planets circle the Sun in almost the same plane. Beyond Neptune lies the icy Kuiper belt, where Voyager 1 is heading out into interstellar space.') },
  { key: 'oort', zh: '奥尔特云', en: 'Oort Cloud', focus: 'sun', logR: 0.55,
    caption: t('太阳引力的最外层疆域：上万亿颗冰质天体组成的球壳，长周期彗星的故乡，延伸到约 1.5 光年之外。', 'The outermost reach of the Sun’s gravity: a shell of trillions of icy bodies, home of the long-period comets, stretching out to about 1.5 ly.') },
  { key: 'neighbourhood', zh: '恒星邻域', en: 'Stellar Neighbourhood', focus: 'sun', logR: 1.7,
    caption: t('以太阳为中心几十光年。比邻星在 4.24 光年外；天狼星、织女星、牛郎星都是我们的近邻。星点的亮度按你所在的视点实时计算。', 'A few dozen light-years around the Sun. Proxima Centauri is 4.24 ly away; Sirius, Vega and Altair are all neighbours. Star brightness is computed live from your viewpoint.') },
  { key: 'spur', zh: '猎户臂', en: 'Orion Spur', focus: 'sun', logR: 3.55,
    caption: t('依巴谷卫星测过距离的恒星构成了这个“已测绘的气泡”，大约几千光年，只是银河系很小的一角。', 'Stars with distances measured by the Hipparcos satellite form this “mapped bubble” a few thousand light-years across: a tiny corner of the Milky Way.') },
  { key: 'milkyway', zh: '银河系', en: 'Milky Way', focus: 'Milky Way', logR: 5.12,
    caption: t('一个直径约 10 万光年的棒旋星系。太阳在猎户臂上，距银心 2.67 万光年，绕银心转一圈需要约 2.3 亿年。', 'A barred spiral about 100,000 ly across. The Sun sits on the Orion Spur, 26,700 ly from the centre, and takes about 230 million years to go around once.') },
  { key: 'localgroup', zh: '本星系群', en: 'Local Group', focus: 'Local Group', logR: 6.72,
    caption: t('银河系和仙女座星系是本星系群的两个主角，周围环绕着几十个矮星系。两个大星系正在相互靠近。', 'The Milky Way and Andromeda dominate the Local Group, surrounded by dozens of dwarf galaxies. The two big galaxies are approaching each other.') },
  { key: 'laniakea', zh: '拉尼亚凯亚', en: 'Laniakea', focus: 'Laniakea', logR: 9.0,
    caption: t('星系沿着纤维状结构汇聚成团。本星系群只是拉尼亚凯亚超星系团边缘的一粒尘埃，整片区域都在流向巨引源。', 'Galaxies gather into clusters along filaments. The Local Group is a speck on the edge of the Laniakea Supercluster, and the whole region is flowing towards the Great Attractor.') },
  { key: 'universe', zh: '可观测宇宙', en: 'Observable Universe', focus: 'Observable Universe', logR: 11.12,
    caption: t('宇宙网一直延伸到光所能抵达的边界。最外层是 138 亿年前留下的宇宙微波背景，它如今距离我们约 465 亿光年。', 'The cosmic web stretches out to the limit of what light can reach. The outermost layer is the cosmic microwave background from 13.8 billion years ago, now about 46.5 billion ly away.') }
];

const REGIMES: Array<[number, string, string]> = [
  [-3.6, '内太阳系', 'Inner Solar System'],
  [-2.2, '太阳系', 'Solar System'],
  [0.4, '奥尔特云', 'Oort Cloud'],
  [2.4, '恒星邻域', 'Stellar Neighbourhood'],
  [3.9, '猎户臂', 'Orion Spur'],
  [5.8, '银河系', 'Milky Way'],
  [7.5, '本星系群', 'Local Group'],
  [8.5, '室女座超星系团', 'Virgo Supercluster'],
  [9.6, '拉尼亚凯亚', 'Laniakea'],
  [10.5, '宇宙网', 'Cosmic Web'],
  [Infinity, '可观测宇宙', 'Observable Universe']
];

export function regimeFor(logR: number, focusDistance = 0, focusName = ''): { zh: string; en: string } {
  // Sun-centred regime names stop making sense once the focus is elsewhere.
  if (logR < 3.9 && focusDistance > Math.pow(10, logR + 0.4)) {
    return { zh: `${focusName}近旁`, en: `Near ${focusName}` };
  }
  const entry = REGIMES.find(([limit]) => logR < limit) ?? REGIMES[REGIMES.length - 1];
  return { zh: entry[1], en: entry[2] };
}

/** Vertical log-scale rail with a live marker and clickable stops. */
export class ScaleLadder {
  private marker: HTMLElement;
  private stops = new Map<string, HTMLElement>();
  onJump: (stop: ScaleStop) => void = () => {};

  constructor(root: HTMLElement) {
    const track = document.createElement('div');
    track.className = 'ladder__track';
    for (let p = Math.ceil(MIN_LOG_R); p <= Math.floor(MAX_LOG_R); p += 1) {
      const tick = document.createElement('span');
      tick.className = `ladder__tick${p % 2 === 0 ? ' is-major' : ''}`;
      tick.style.top = `${this.position(p) * 100}%`;
      track.appendChild(tick);
    }
    for (const stop of STOPS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ladder__stop';
      button.style.top = `${this.position(stop.logR) * 100}%`;
      button.innerHTML = '<span class="ladder__dot"></span><span class="ladder__name"></span>';
      (button.lastElementChild as HTMLElement).textContent = isEn ? stop.en : stop.zh;
      button.title = isEn ? stop.zh : stop.en;
      button.addEventListener('click', () => this.onJump(stop));
      track.appendChild(button);
      this.stops.set(stop.key, button);
    }
    this.marker = document.createElement('div');
    this.marker.className = 'ladder__marker';
    track.appendChild(this.marker);
    root.appendChild(track);
  }

  /** 0 at the top (largest scale) to 1 at the bottom (smallest). */
  private position(logR: number): number {
    return clamp((MAX_LOG_R - logR) / (MAX_LOG_R - MIN_LOG_R), 0, 1);
  }

  update(logR: number): void {
    this.marker.style.top = `${this.position(logR) * 100}%`;
    let nearest: string | null = null;
    let best = 0.6;
    for (const stop of STOPS) {
      const d = Math.abs(stop.logR - logR);
      if (d < best) {
        best = d;
        nearest = stop.key;
      }
    }
    for (const [key, element] of this.stops) element.classList.toggle('is-current', key === nearest);
  }
}

/** Width in CSS px and label for a round-number scale bar. */
export function scaleBar(radius: number, pixelScale: number): { width: number; label: string } {
  // World length that spans one CSS pixel at the focus distance.
  const perPixel = radius / pixelScale;
  const target = perPixel * 120;
  const unitLy = (() => {
    const parts = distanceParts(target);
    const value = parseFloat(parts.value.replace(/,/g, ''));
    return target / value;
  })();
  const raw = target / unitLy;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 5, 10].map(n => n * pow).filter(n => n <= raw).pop() ?? pow;
  const length = nice * unitLy;
  const parts = distanceParts(length);
  return { width: length / perPixel, label: `${parts.value} ${parts.unit}` };
}
