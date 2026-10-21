import type { AtlasObject } from './objects';
import { constellationName } from './constellations';
import { isEn, t } from '../core/i18n';

export const STAR_STRIDE = 5; // x, y, z, absmag, ci

interface NamedStarRecord {
  i: number;
  en: string;
  zh: string;
  des: string;
  con: string;
  sp: string;
  mag: number;
  abs: number;
  ly: number;
  ra: number;
  dec: number;
  hip?: number;
}

export interface StarCatalog {
  buffer: Float32Array;
  count: number;
  objects: AtlasObject[];
}

const TEMPERATURE: Record<string, [string, string]> = {
  O: ['表面超过 3 万开的极高温', 'very hot (over 30,000 K)'],
  B: ['表面 1–3 万开的高温', 'hot (10,000–30,000 K)'],
  A: ['表面约 7500–10000 开的白色', 'white (7,500–10,000 K)'],
  F: ['表面约 6000–7500 开的黄白色', 'yellow-white (6,000–7,500 K)'],
  G: ['与太阳同类的黄色', 'Sun-like yellow'],
  K: ['表面约 3700–5200 开的橙色', 'orange (3,700–5,200 K)'],
  M: ['表面低于 3700 开的红色', 'red (below 3,700 K)']
};

function luminosityClass(spect: string): string {
  if (/^D/.test(spect)) return t('白矮星', 'white dwarf');
  const rest = spect.replace(/^[OBAFGKM][\d.:]*/, '').trim();
  if (rest.startsWith('III')) return t('巨星', 'giant');
  if (rest.startsWith('II')) return t('亮巨星', 'bright giant');
  if (rest.startsWith('IV')) return t('亚巨星', 'subgiant');
  if (rest.startsWith('V')) return t('主序星', 'main-sequence star');
  if (rest.startsWith('I')) return t('超巨星', 'supergiant');
  return t('恒星', 'star');
}

function lightYearText(ly: number): string {
  const year = new Date().getFullYear();
  if (ly < 1) return '';
  if (ly < 2500) {
    const start = Math.round(year - ly);
    return t(`此刻进入你眼睛的星光，出发于公元 ${start} 年前后。`, ` The light reaching your eyes tonight set out around ${start} AD.`);
  }
  const ago = Math.round(ly).toLocaleString('en-US');
  return t(`此刻看到的星光，出发于约 ${ago} 年前。`, ` The light you see tonight set out about ${ago} years ago.`);
}

function describeStar(record: NamedStarRecord): string {
  const spect = record.sp || '';
  const letter = spect.charAt(0);
  const kind = luminosityClass(spect);
  const temperature = TEMPERATURE[letter];
  const where = constellationName(record.con);
  const lum = Math.pow(10, (4.83 - record.abs) / 2.5);
  const times = lum >= 100 ? Math.round(lum).toLocaleString('en-US') : lum.toFixed(1);
  const fraction = lum < 0.01 ? lum.toExponential(1) : lum.toFixed(3);
  if (isEn) {
    const adjective = temperature ? `${temperature[1]} ` : '';
    const article = /^[aeiou]/i.test(adjective || kind) ? 'An' : 'A';
    const lead = `${article} ${adjective}${kind}${spect ? ` (spectral type ${spect})` : ''}${where ? ` in ${where}` : ''}.`;
    const lumText = lum >= 1.5
      ? ` It shines about ${times} times as brightly as the Sun.`
      : lum <= 0.6 ? ` It is much fainter than the Sun, at ${fraction} of its luminosity.` : " Its luminosity is close to the Sun's.";
    return `${lead}${lumText}${lightYearText(record.ly)}`;
  }
  const lead = `${where ? `位于${where}，` : ''}一颗${temperature?.[0] ?? ''}${kind}${spect ? `（光谱型 ${spect}）` : ''}。`;
  const lumText = lum >= 1.5
    ? `它的发光能力约为太阳的 ${times} 倍。`
    : lum <= 0.6 ? `它比太阳暗弱得多，发光能力只有太阳的 ${fraction} 倍。` : '它的发光能力与太阳相近。';
  return `${lead}${lumText}${lightYearText(record.ly)}`;
}

export async function loadStarCatalog(): Promise<StarCatalog> {
  const [binary, named] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}data/stars.bin`).then(response => {
      if (!response.ok) throw new Error(`stars.bin ${response.status}`);
      return response.arrayBuffer();
    }),
    fetch(`${import.meta.env.BASE_URL}data/named.json`).then(response => {
      if (!response.ok) throw new Error(`named.json ${response.status}`);
      return response.json() as Promise<NamedStarRecord[]>;
    })
  ]);
  const buffer = new Float32Array(binary);
  const objects: AtlasObject[] = named.map(record => {
    const base = record.i * STAR_STRIDE;
    const title = record.zh || record.en || record.des || `HIP ${record.hip ?? record.i}`;
    return {
      id: `star:${record.hip ?? record.i}`,
      zh: title,
      nameEn: record.en || record.des || `HIP ${record.hip ?? record.i}`,
      subEn: [record.en ? record.des : '', record.zh].filter(Boolean).join(' · '),
      // Without a Chinese name the English proper name is the title, so the
      // subtitle only needs the designation.
      en: record.zh ? [record.en, record.des].filter(Boolean).join(' · ') : record.en ? record.des : '',
      kind: 'star',
      pos: [buffer[base], buffer[base + 1], buffer[base + 2]],
      extent: 0.004,
      mag: record.mag,
      absmag: record.abs,
      spect: record.sp,
      con: record.con,
      des: record.des,
      ra: record.ra,
      dec: record.dec,
      desc: describeStar(record),
      label: [-6, Math.max(2.3, Math.log10(Math.max(record.ly, 1)) + 1.2)],
      priority: 1,
      distance: record.ly
    };
  });
  return { buffer, count: buffer.length / STAR_STRIDE, objects };
}
