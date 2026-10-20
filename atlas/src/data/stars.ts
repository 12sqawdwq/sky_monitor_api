import type { AtlasObject } from './objects';
import { constellationName } from './constellations';

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

const TEMPERATURE: Record<string, string> = {
  O: '表面超过 3 万开的极高温',
  B: '表面 1–3 万开的高温',
  A: '表面约 7500–10000 开的白色',
  F: '表面约 6000–7500 开的黄白色',
  G: '与太阳同类的黄色',
  K: '表面约 3700–5200 开的橙色',
  M: '表面低于 3700 开的红色'
};

function luminosityClass(spect: string): string {
  if (/^D/.test(spect)) return '白矮星';
  const rest = spect.replace(/^[OBAFGKM][\d.:]*/, '').trim();
  if (rest.startsWith('III')) return '巨星';
  if (rest.startsWith('II')) return '亮巨星';
  if (rest.startsWith('IV')) return '亚巨星';
  if (rest.startsWith('V')) return '主序星';
  if (rest.startsWith('I')) return '超巨星';
  return '恒星';
}

function lightYearText(ly: number): string {
  const year = new Date().getFullYear();
  if (ly < 1) return '';
  if (ly < 2500) return `此刻进入你眼睛的星光，出发于公元 ${Math.round(year - ly)} 年前后。`;
  return `此刻看到的星光，出发于约 ${Math.round(ly).toLocaleString('en-US')} 年前。`;
}

function describeStar(record: NamedStarRecord): string {
  const spect = record.sp || '';
  const letter = spect.charAt(0);
  const kind = luminosityClass(spect);
  const temperature = TEMPERATURE[letter] ?? '';
  const where = constellationName(record.con);
  const lead = `${where ? `位于${where}，` : ''}一颗${temperature}${kind}${spect ? `（光谱型 ${spect}）` : ''}。`;
  const lum = Math.pow(10, (4.83 - record.abs) / 2.5);
  const lumText = lum >= 1.5
    ? `它的发光能力约为太阳的 ${lum >= 100 ? Math.round(lum).toLocaleString('en-US') : lum.toFixed(1)} 倍。`
    : lum <= 0.6 ? `它比太阳暗弱得多，发光能力只有太阳的 ${lum < 0.01 ? lum.toExponential(1) : lum.toFixed(3)} 倍。` : '它的发光能力与太阳相近。';
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
