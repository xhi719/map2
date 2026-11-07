// Builds src/geo-data.js from the raw sources.
//   node tools/prepare-geo.mjs
// Sources (see README):
//   sources/world_1938.geojson               aourednik/historical-basemaps
//   sources/ne_50m_lakes.geojson             Natural Earth
//   sources/ne_50m_rivers_lake_centerlines.geojson  Natural Earth
//   node_modules/world-atlas/land-50m.json   Natural Earth via world-atlas
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as topojson from 'topojson-client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

// Crop window: everything the camera can ever see stays well inside 90° of
// every camera centre, so the renderer can project points without horizon clipping.
const BOX = { x0: -180, x1: 180, y0: -90, y1: 90 };
// Detail is kept in and around Europe; far regions are simplified harder.
const near = (ring) => { const c = ring.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map((v) => v / ring.length); return c[0] > -35 && c[0] < 95 && c[1] > 8 && c[1] < 85; };

function clipRing(ring) {
  // Sutherland–Hodgman against the four edges of BOX.
  const edges = [
    (p) => p[0] >= BOX.x0, (p) => p[0] <= BOX.x1,
    (p) => p[1] >= BOX.y0, (p) => p[1] <= BOX.y1,
  ];
  const isect = [
    (a, b) => { const t = (BOX.x0 - a[0]) / (b[0] - a[0]); return [BOX.x0, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (BOX.x1 - a[0]) / (b[0] - a[0]); return [BOX.x1, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (BOX.y0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), BOX.y0]; },
    (a, b) => { const t = (BOX.y1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), BOX.y1]; },
  ];
  let out = ring;
  for (let e = 0; e < 4; e++) {
    const inp = out; out = [];
    if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const ci = edges[e](cur), pi = edges[e](prev);
      if (ci) { if (!pi) out.push(isect[e](prev, cur)); out.push(cur); }
      else if (pi) out.push(isect[e](prev, cur));
    }
  }
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
const noClip = (r) => r;
function simplify(pts, tol, closed) {
  const out = [];
  for (const p of pts) {
    const q = [r2(p[0]), r2(p[1])];
    const last = out[out.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) >= tol) out.push(q);
  }
  if (closed && out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return out;
}
function ringArea(r) {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s / 2);
}
function polys(geom) {
  if (!geom) return [];
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
}
function prepPolygon(poly, tol, minArea) {
  const rings = [];
  if (!near(poly[0])) { tol *= 4; minArea *= 6; }
  for (const ring of poly) {
    const c = simplify(noClip(ring), tol, true);
    if (c.length >= 3 && ringArea(c) >= minArea) rings.push(c);
  }
  return rings.length && rings[0] ? rings : null;
}

// ---- land ---------------------------------------------------------------
const landTopo = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/world-atlas/land-50m.json'), 'utf8'));
const landGeo = topojson.feature(landTopo, landTopo.objects.land);
const land = [];
for (const f of landGeo.features) for (const p of polys(f.geometry)) {
  const q = prepPolygon(p, 0.035, 0.004); if (q) land.push(q);
}

// ---- lakes (historic only: skip post-war reservoirs) ---------------------
const LAKES = new Set(['Lake Ladoga', 'Lake Onega', 'Lake Peipus', 'Lake Pskov', "Lake Il'Men'", 'Vänern', 'Vättern',
  'Mälaren', 'Lake Balaton', 'Lake Geneva', 'Bodensee', 'Lake Saimaa', 'Päijänne', 'Inarijärvi', 'Oulujärvi',
  'Lake Beloye', 'Lake Vygozero', 'Lake Segozerskoye', 'Lake Topozero', 'Pielinen', 'Lake Van', 'Lake Tuz',
  'Lake Urmia', 'Lake Sevan', 'Lake Skadar', 'Lough Neagh', 'IJsselmeer', 'Syvash', 'Kaliningradskiy Zaliv', 'Zalev Wislany']);
const lakes = [];
for (const f of read('sources/ne_50m_lakes.geojson').features) {
  if (!LAKES.has(f.properties.name)) continue;
  for (const p of polys(f.geometry)) { const q = prepPolygon(p, 0.03, 0.002); if (q) lakes.push(q); }
}

// ---- rivers -------------------------------------------------------------
const RIVERS = new Set(['Rhine', 'Rhein', 'Rhin', 'Nederrijn', 'Waal', 'Danube', 'Donau', 'Bratul Chillia', 'Dnipro', 'Dnepre',
  'Don', 'Volga', 'Vistula', 'Oder', 'Elbe', 'Seine', 'Loire', 'Po', 'Dniester', 'Daugava', 'Neva', 'Svir’', 'Tisza', 'Tisa',
  'Drava', 'Rhône', 'Thames', 'Damietta Branch', 'Rosetta Branch', 'Severnaya Dvina', 'Kama', 'Ural']);
const rivers = [];
for (const f of read('sources/ne_50m_rivers_lake_centerlines.geojson').features) {
  if (!f.geometry || !RIVERS.has(f.properties.name)) continue;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const l of lines) {
    const q = simplify(l.filter((p) => p[0] > BOX.x0 && p[0] < BOX.x1 && p[1] > BOX.y0 && p[1] < BOX.y1), 0.06, false);
    if (q.length > 1) rivers.push(q);
  }
}

// ---- 1938 political borders ---------------------------------------------
// Unnamed islands in the source are given to their 1938 owners.
function ownerOfUnnamed(lon, lat) {
  if (lon > 13 && lon < 14 && lat > 54 && lat < 55) return 'Germany';           // Rügen
  if (lon > 21.5 && lon < 23.5 && lat > 57.8 && lat < 59.3) return 'Estonia';   // Saaremaa / Hiiumaa
  if (lon > 19 && lon < 21 && lat > 59.7 && lat < 60.6) return 'Finland';       // Åland
  if (lon > -7.5 && lon < -6 && lat > 61 && lat < 63) return 'Denmark';         // Faroe
  if (lon > -9 && lon < 0 && lat > 53 && lat < 61) return 'United Kingdom';
  return null;
}
const RENAME = { 'United Kingdom of Great Britain and Ireland': null };
const countries = {}, owner = {};
for (const f of read('sources/world_1938.geojson').features) {
  for (const p of polys(f.geometry)) {
    const ring = p[0];
    const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length, cy = ring.reduce((s, q) => s + q[1], 0) / ring.length;
    let name = f.properties.NAME;
    if (!name) name = ownerOfUnnamed(cx, cy);
    if (!name || name in RENAME) continue;
    if (name === 'Denmark' && cx < -12) continue; // Greenland / Iceland: out of scope
    const q = prepPolygon(p, 0.03, 0.003);
    if (!q) continue;
    (countries[name] ||= []).push(q);
    owner[name] = f.properties.SUBJECTO || name;
  }
}

const out = { land, lakes, rivers, countries, owner };
const json = JSON.stringify(out);
fs.writeFileSync(path.join(root, 'src/geo-data.js'), `// Generated by tools/prepare-geo.mjs — do not edit.\nwindow.GEO=${json};\n`);
console.log('geo-data.js', (json.length / 1024).toFixed(0) + ' KB',
  'land', land.length, 'lakes', lakes.length, 'rivers', rivers.length, 'countries', Object.keys(countries).length);
console.log(Object.keys(countries).sort().join(', '));
