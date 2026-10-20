// Compacts d3-celestial constellation data (BSD-3-Clause, Olaf Frohn) into
// public/data/constellations.json for the sky view.
//
//   node scripts/build-constellations.mjs <constellations.lines.json> <constellations.json>
//
// Source: https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/
// Output: [{ id, rank, label: [ra, dec], lines: [[ra, dec, ra, dec, ...], ...] }]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [linesPath, namesPath] = process.argv.slice(2);
if (!linesPath || !namesPath) {
  console.error('usage: node scripts/build-constellations.mjs <constellations.lines.json> <constellations.json>');
  process.exit(1);
}

const ra = lon => Math.round(((lon % 360) + 360) % 360 * 1000) / 1000;
const dec = lat => Math.round(lat * 1000) / 1000;

const lines = JSON.parse(fs.readFileSync(linesPath, 'utf8'));
const names = JSON.parse(fs.readFileSync(namesPath, 'utf8'));
const labelById = new Map(names.features.map(f => [f.id, f.geometry.coordinates]));

const out = lines.features.map(feature => {
  const label = labelById.get(feature.id);
  return {
    id: feature.id,
    rank: Number(feature.properties.rank) || 3,
    label: label ? [ra(label[0]), dec(label[1])] : null,
    lines: feature.geometry.coordinates.map(polyline => polyline.flatMap(([lon, lat]) => [ra(lon), dec(lat)]))
  };
});

const target = path.join(root, 'public/data/constellations.json');
fs.writeFileSync(target, JSON.stringify(out));
const segments = out.reduce((n, c) => n + c.lines.reduce((m, l) => m + l.length / 2 - 1, 0), 0);
console.log(`constellations.json: ${out.length} constellations, ${segments} segments, ${fs.statSync(target).size} bytes`);
