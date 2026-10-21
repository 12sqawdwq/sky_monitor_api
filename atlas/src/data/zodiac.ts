import { eclipticToEquatorial, equatorialToRaDec } from '../core/coords';
import { sunPosition } from '../sky/astro';
import { isEn } from '../core/i18n';

/** The twelve zodiac constellations (Ophiuchus also crosses the ecliptic). */
export const ZODIAC_CONSTELLATIONS = new Set(['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Sgr', 'Cap', 'Aqr', 'Psc']);

/** Constellations whose stick figures are worth drawing by default. */
const SIGNPOSTS = ['And', 'Aql', 'Aur', 'Boo', 'CMa', 'Car', 'Cas', 'Cen', 'Cet', 'Cyg', 'Eri', 'Ori', 'Peg', 'Per', 'UMa', 'Lyr', 'UMi', 'Cru', 'CMi', 'Oph'];
export const ESSENTIAL_CONSTELLATIONS = new Set([...ZODIAC_CONSTELLATIONS, ...SIGNPOSTS]);

/** Twelve 30° houses of the ecliptic, starting at the March equinox (traditional Chinese names). */
export const ZODIAC_SIGNS = isEn
  ? ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces']
  : ['白羊宫', '金牛宫', '双子宫', '巨蟹宫', '狮子宫', '室女宫', '天秤宫', '天蝎宫', '人马宫', '摩羯宫', '宝瓶宫', '双鱼宫'];

/** The 24 solar terms; term k begins when the Sun's ecliptic longitude reaches 15k°. */
export const SOLAR_TERMS = isEn
  ? [
      'Spring Equinox', 'Clear and Bright', 'Grain Rain', 'Start of Summer', 'Grain Buds', 'Grain in Ear',
      'Summer Solstice', 'Minor Heat', 'Major Heat', 'Start of Autumn', 'End of Heat', 'White Dew',
      'Autumn Equinox', 'Cold Dew', 'Frost Descent', 'Start of Winter', 'Minor Snow', 'Major Snow',
      'Winter Solstice', 'Minor Cold', 'Major Cold', 'Start of Spring', 'Rain Water', 'Awakening of Insects'
    ]
  : [
      '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露',
      '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至', '小寒', '大寒', '立春', '雨水', '惊蛰'
    ];

export function eclipticRaDec(lambdaDeg: number, betaDeg = 0): { ra: number; dec: number } {
  const l = (lambdaDeg * Math.PI) / 180;
  const b = (betaDeg * Math.PI) / 180;
  return equatorialToRaDec(eclipticToEquatorial(Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)));
}

export interface SunOnEcliptic {
  lambda: number;
  sign: string;
  term: string;
  nextTerm: string;
  nextTermDate: Date;
}

/** Where the Sun stands on the ecliptic, and when the next solar term begins. */
export function sunOnEcliptic(date: Date): SunOnEcliptic {
  const lambda = sunPosition(date).lambda;
  const index = Math.floor(lambda / 15) % 24;
  const target = ((index + 1) % 24) * 15;
  const remaining = (target - lambda + 360) % 360;
  // The Sun moves ~0.9856°/day; refine the estimate by bisection.
  let lo = date.getTime();
  let hi = lo + (remaining / 0.9856 + 3) * 86400000;
  for (let k = 0; k < 40; k += 1) {
    const mid = (lo + hi) / 2;
    const travelled = (sunPosition(new Date(mid)).lambda - lambda + 360) % 360;
    if (travelled < remaining) lo = mid;
    else hi = mid;
  }
  return {
    lambda,
    sign: ZODIAC_SIGNS[Math.floor(lambda / 30) % 12],
    term: SOLAR_TERMS[index],
    nextTerm: SOLAR_TERMS[(index + 1) % 24],
    nextTermDate: new Date(hi)
  };
}

/** The four symbols (四象), seven mansions each, in order from 角. */
export const XIANG = isEn
  ? ['Azure Dragon of the East', 'Black Tortoise of the North', 'White Tiger of the West', 'Vermilion Bird of the South']
  : ['东方苍龙', '北方玄武', '西方白虎', '南方朱雀'];

/** English names of the mansions. */
const MANSION_EN: Record<string, string> = {
  角: 'Horn', 亢: 'Neck', 氐: 'Root', 房: 'Room', 心: 'Heart', 尾: 'Tail', 箕: 'Winnowing Basket',
  斗: 'Dipper', 牛: 'Ox', 女: 'Girl', 虚: 'Emptiness', 危: 'Rooftop', 室: 'Encampment', 壁: 'Wall',
  奎: 'Legs', 娄: 'Bond', 胃: 'Stomach', 昴: 'Hairy Head', 毕: 'Net', 觜: 'Turtle Beak', 参: 'Three Stars',
  井: 'Well', 鬼: 'Ghost', 柳: 'Willow', 星: 'Star', 张: 'Extended Net', 翼: 'Wings', 轸: 'Chariot'
};

/** Mansion name in the current language, e.g. 角宿 / Horn. */
export function mansionName(mansion: { id: string }): string {
  return isEn ? MANSION_EN[mansion.id] ?? mansion.id : `${mansion.id}宿`;
}

export interface Mansion {
  id: string;
  xiang: number;
  label: [number, number];
  /** Determinative star (距星), J2000 RA/Dec; the mansion runs east from here to the next one. */
  det: [number, number];
  lines: number[][];
}

const OBLIQUITY = 23.4392911 * (Math.PI / 180);

/** Ecliptic longitude of the point on the ecliptic with the given right ascension. */
export function eclipticLongitudeAtRa(raDeg: number): number {
  const a = (raDeg * Math.PI) / 180;
  const lambda = (Math.atan2(Math.sin(a), Math.cos(a) * Math.cos(OBLIQUITY)) * 180) / Math.PI;
  return (lambda + 360) % 360;
}

/** Width of mansion k in right ascension (宿度, degrees). */
export function mansionWidth(mansions: Mansion[], k: number): number {
  return (mansions[(k + 1) % mansions.length].det[0] - mansions[k].det[0] + 360) % 360;
}

/** The mansion containing a right ascension (boundaries are hour circles through the 距星). */
export function mansionAt(mansions: Mansion[], raDeg: number): { mansion: Mansion; index: number; offset: number } | null {
  for (let k = 0; k < mansions.length; k += 1) {
    const offset = (raDeg - mansions[k].det[0] + 360) % 360;
    if (offset < mansionWidth(mansions, k)) return { mansion: mansions[k], index: k, offset };
  }
  return null;
}
