// Extracts the 28 lunar mansions (二十八宿) from d3-celestial's Chinese
// asterism data (BSD-3-Clause, Olaf Frohn) into public/data/mansions.json.
//
//   node scripts/build-mansions.mjs <constellations.lines.cn.json> <constellations.cn.json>
//
// Source: https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/
// Output: [{ id, xiang, label: [ra, dec], det: [ra, dec], lines: [[ra, dec, ...], ...] }]
// `det` is the determinative star (距星); mansion k spans from det[k] to det[k+1] in RA.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [linesPath, namesPath] = process.argv.slice(2);
if (!linesPath || !namesPath) {
  console.error('usage: node scripts/build-mansions.mjs <constellations.lines.cn.json> <constellations.cn.json>');
  process.exit(1);
}

// Mansion, approximate J2000 RA/Dec of its determinative star (snapped to the line data below).
const MANSIONS = [
  ['角', 201.298, -11.161], ['亢', 213.224, -10.274], ['氐', 222.72, -16.042], ['房', 239.713, -26.114],
  ['心', 245.297, -25.593], ['尾', 252.968, -38.048], ['箕', 271.452, -30.424],
  ['斗', 281.414, -26.991], ['牛', 305.253, -14.781], ['女', 311.919, -9.496], ['虚', 322.89, -5.571],
  ['危', 331.446, -0.32], ['室', 346.19, 15.205], ['壁', 3.309, 15.184],
  ['奎', 14.302, 23.418], ['娄', 28.66, 20.808], ['胃', 40.863, 27.707], ['昴', 56.219, 24.113],
  ['毕', 67.154, 19.18], ['觜', 83.784, 9.934], ['参', 85.19, -1.943],
  ['井', 95.74, 22.514], ['鬼', 127.898, 18.094], ['柳', 129.414, 5.704], ['星', 141.897, -8.659],
  ['张', 147.87, -14.847], ['翼', 164.944, -18.299], ['轸', 183.952, -17.542]
];

const ra = lon => Math.round(((lon % 360) + 360) % 360 * 1000) / 1000;
const dec = lat => Math.round(lat * 1000) / 1000;
const DEG = Math.PI / 180;
const separation = (a, b) => {
  const c = Math.sin(a[1] * DEG) * Math.sin(b[1] * DEG) + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.cos((a[0] - b[0]) * DEG);
  return Math.acos(Math.min(1, c)) / DEG;
};

const lines = new Map(JSON.parse(fs.readFileSync(linesPath, 'utf8')).features.map(f => [f.id, f]));
const names = JSON.parse(fs.readFileSync(namesPath, 'utf8')).features;

const out = MANSIONS.map(([id, detRa, detDec], k) => {
  const feature = names.find(f => f.properties.name === `${id}宿`);
  if (!feature) throw new Error(`missing ${id}宿`);
  const polylines = lines.get(feature.id)?.geometry.coordinates ?? [];
  const det = [detRa, detDec];
  let best = null;
  for (const p of polylines.flat()) {
    const d = separation([ra(p[0]), p[1]], det);
    if (d < 1 && (!best || d < best.d)) best = { d, p: [ra(p[0]), dec(p[1])] };
  }
  if (!best) console.warn(`${id}: determinative star not in line data, using catalogue position`);
  const [lon, lat] = feature.geometry.coordinates;
  return {
    id,
    xiang: Math.floor(k / 7),
    label: [ra(lon), dec(lat)],
    det: best ? best.p : det,
    lines: polylines.map(polyline => polyline.flatMap(([a, b]) => [ra(a), dec(b)]))
  };
});

const target = path.join(root, 'public/data/mansions.json');
fs.writeFileSync(target, JSON.stringify(out));
console.log(`mansions.json: ${out.length} mansions, ${fs.statSync(target).size} bytes`);
