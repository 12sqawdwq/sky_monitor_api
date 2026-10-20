// Bakes the HYG v3 catalog into compact files for the atlas.
//
//   node scripts/build-stars.mjs [path/to/hygdata_v3.csv]
//
// Outputs (public/data):
//   stars.bin   Float32 records [x, y, z, absmag, ci] in light-years, scene frame
//   named.json  metadata for stars worth labelling / searching
//
// Scene frame = galactic Cartesian with the Sun at the origin, mapped to
// three.js axes as (gx, gz, -gy): +x towards the Galactic Centre, +y towards
// the North Galactic Pole.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
// Default: the backend's download (`python scripts/download_hyg.py`), either next to this
// folder (sky_monitor_api layout) or in a sibling lingzhuback checkout.
const csvCandidates = ['../data/raw/hygdata_v3.csv', '../../lingzhuback/data/raw/hygdata_v3.csv'].map(p => path.join(root, p));
const csvPath = path.resolve(process.argv[2] || csvCandidates.find(p => fs.existsSync(p)) || csvCandidates[0]);
const zhSource = path.join(root, '../pages/index/index.js');
const outDir = path.join(root, 'public/data');

const PC_TO_LY = 3.261563777;
const NAMED_MAG_LIMIT = 3.6;

// IAU J2000 equatorial -> galactic rotation.
const EQ_TO_GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762]
];

function toScene(x, y, z) {
  const gx = EQ_TO_GAL[0][0] * x + EQ_TO_GAL[0][1] * y + EQ_TO_GAL[0][2] * z;
  const gy = EQ_TO_GAL[1][0] * x + EQ_TO_GAL[1][1] * y + EQ_TO_GAL[1][2] * z;
  const gz = EQ_TO_GAL[2][0] * x + EQ_TO_GAL[2][1] * y + EQ_TO_GAL[2][2] * z;
  return [gx * PC_TO_LY, gz * PC_TO_LY, -gy * PC_TO_LY];
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

// Traditional Chinese star names for well-known stars not covered by the
// glasses-side catalog. Keys are HYG proper names, or designations for
// unnamed nearby stars.
const ZH_EXTRA = {
  'Sirius': '天狼星', 'Canopus': '老人星', 'Arcturus': '大角星', 'Rigil Kentaurus': '南门二',
  'Vega': '织女星', 'Capella': '五车二', 'Rigel': '参宿七', 'Procyon': '南河三',
  'Achernar': '水委一', 'Betelgeuse': '参宿四', 'Hadar': '马腹一', 'Altair': '河鼓二（牛郎星）',
  'Acrux': '十字架二', 'Aldebaran': '毕宿五', 'Antares': '心宿二', 'Spica': '角宿一',
  'Pollux': '北河三', 'Fomalhaut': '北落师门', 'Deneb': '天津四', 'Mimosa': '十字架三',
  'Regulus': '轩辕十四', 'Adhara': '弧矢七', 'Castor': '北河二', 'Gacrux': '十字架一',
  'Shaula': '尾宿八', 'Bellatrix': '参宿五', 'Elnath': '五车五', 'Miaplacidus': '南船五',
  'Alnilam': '参宿二', 'Alnair': '鹤一', 'Alnitak': '参宿一', 'Mintaka': '参宿三',
  'Saiph': '参宿六', 'Alioth': '玉衡', 'Dubhe': '天枢', 'Merak': '天璇', 'Phecda': '天玑',
  'Megrez': '天权', 'Mizar': '开阳', 'Alkaid': '摇光', 'Kaus Australis': '箕宿三',
  'Mirfak': '天船三', 'Wezen': '弧矢一', 'Avior': '海石一', 'Sargas': '尾宿五',
  'Menkalinan': '五车三', 'Atria': '三角形三', 'Alhena': '井宿三', 'Peacock': '孔雀十一',
  'Polaris': '北极星（勾陈一）', 'Mirzam': '军市一', 'Alphard': '星宿一', 'Hamal': '娄宿三',
  'Diphda': '土司空', 'Nunki': '斗宿四', 'Menkent': '库楼三', 'Alpheratz': '壁宿二',
  'Mirach': '奎宿九', 'Kochab': '北极二', 'Rasalhague': '候', 'Algol': '大陵五',
  'Almach': '天大将军一', 'Denebola': '五帝座一', 'Alphecca': '贯索四', 'Sadr': '天津一',
  'Schedar': '王良四', 'Eltanin': '天棓四', 'Caph': '王良一', 'Algieba': '轩辕十二',
  'Enif': '危宿三', 'Scheat': '室宿二', 'Markab': '室宿一', 'Algenib': '壁宿一',
  'Zubeneschamali': '氐宿四', 'Zubenelgenubi': '氐宿一', 'Unukalhai': '天市右垣七',
  'Ankaa': '火鸟六', 'Tarazed': '河鼓三', 'Alshain': '河鼓一', 'Sheratan': '娄宿一',
  'Thuban': '右枢', 'Izar': '梗河一', 'Muphrid': '右摄提一', 'Alcyone': '昴宿六',
  'Mira': '蒭藁增二', 'Albireo': '辇道增七', 'Sabik': '宋', 'Alderamin': '天钩五',
  'Menkar': '天囷一', 'Arneb': '厕一', 'Aludra': '弧矢二', 'Dschubba': '房宿三',
  'Lesath': '尾宿九', 'Kaus Media': '箕宿二', 'Kaus Borealis': '斗宿二', 'Ascella': '斗宿六',
  'Proxima Centauri': '比邻星', "Barnard's Star": '巴纳德星', 'Wolf 359': '沃尔夫 359',
  'τ Cet': '天仓五', 'ε Eri': '天苑四', '61 Cyg': '天鹅座 61', 'ε Ind': '印第安座 ε'
};

function loadChineseNames() {
  const names = new Map(Object.entries(ZH_EXTRA).map(([k, v]) => [k.toLowerCase(), v]));
  if (!fs.existsSync(zhSource)) return names;
  const source = fs.readFileSync(zhSource, 'utf8');
  const pattern = /\["([^"]+)",\s*"([^"]+)",\s*[-\d.]+,\s*[-\d.]+,\s*[-\d.]+,\s*"[^"]*"\]/g;
  let match;
  while ((match = pattern.exec(source))) {
    const key = match[1].toLowerCase();
    if (/[一-鿿]/.test(match[2]) && !names.has(key)) names.set(key, match[2]);
  }
  return names;
}

const GREEK = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ',
  Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π',
  Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω'
};

function designation(bayer, flam, con) {
  if (!con) return '';
  if (bayer) {
    const m = bayer.match(/^([A-Za-z]+)(-?\d*)$/);
    if (m && GREEK[m[1]]) return `${GREEK[m[1]]}${m[2] ? m[2].replace('-', '') : ''} ${con}`;
  }
  if (flam) return `${flam} ${con}`;
  return '';
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    console.error(`HYG catalog not found: ${csvPath}`);
    process.exit(1);
  }
  const zhNames = loadChineseNames();
  const reader = readline.createInterface({ input: fs.createReadStream(csvPath), crlfDelay: Infinity });
  let header = null;
  const records = [];
  const named = [];

  for await (const line of reader) {
    if (!header) {
      header = Object.fromEntries(parseCsvLine(line).map((name, i) => [name, i]));
      continue;
    }
    const f = parseCsvLine(line);
    const id = Number(f[header.id]);
    const distPc = Number(f[header.dist]);
    // id 0 is the Sun; 100000 pc marks an unknown distance in HYG.
    if (id === 0 || !(distPc > 0) || distPc >= 99999) continue;

    const [x, y, z] = toScene(Number(f[header.x]), Number(f[header.y]), Number(f[header.z]));
    const absmag = Number(f[header.absmag]);
    const ciRaw = f[header.ci];
    const ci = ciRaw === '' ? 0.65 : Number(ciRaw);
    const index = records.length;
    records.push([x, y, z, absmag, ci]);

    const proper = f[header.proper];
    const mag = Number(f[header.mag]);
    const con = f[header.con];
    const des = designation(f[header.bayer], f[header.flam], con);
    const zh = (proper && zhNames.get(proper.toLowerCase())) || (des && zhNames.get(des.toLowerCase()));
    const distLy = distPc * PC_TO_LY;
    if (proper || zh || mag <= NAMED_MAG_LIMIT || distLy <= 16.5) {
      named.push({
        i: index,
        en: proper || '',
        zh: zh || '',
        des,
        con,
        sp: f[header.spect],
        mag: Math.round(mag * 100) / 100,
        abs: Math.round(absmag * 100) / 100,
        ly: Math.round(distLy * 100) / 100,
        ra: Math.round(Number(f[header.ra]) * 15 * 1e5) / 1e5,
        dec: Math.round(Number(f[header.dec]) * 1e5) / 1e5,
        hip: f[header.hip] ? Number(f[header.hip]) : undefined
      });
    }
  }

  const buffer = new Float32Array(records.length * 5);
  records.forEach((r, i) => buffer.set(r, i * 5));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'stars.bin'), Buffer.from(buffer.buffer));
  fs.writeFileSync(path.join(outDir, 'named.json'), JSON.stringify(named));

  const zhCount = named.filter(s => s.zh).length;
  console.log(`stars.bin: ${records.length} stars, ${(buffer.byteLength / 1048576).toFixed(2)} MB`);
  console.log(`named.json: ${named.length} entries (${zhCount} with Chinese names)`);
}

main();
