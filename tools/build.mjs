// Inlines geography, history, renderer and fonts into a single self-contained index.html.
//   node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fontDir = 'node_modules/@fontsource/noto-sans-kr/files';
const face = (subset, weight) => {
  const b64 = fs.readFileSync(path.join(root, fontDir, `noto-sans-kr-${subset}-${weight}-normal.woff2`)).toString('base64');
  return `@font-face{font-family:"Noto Sans KR";font-style:normal;font-display:swap;font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
};
const fonts = ['latin', 'korean'].flatMap((s) => [400, 700].map((w) => face(s, w))).join('\n');
const esc = (js) => js.replace(/<\/script/gi, '<\\/script');
let html = rd('src/template.html')
  .replace('/*FONTS*/', () => fonts)
  .replace('/*D3*/', () => esc(rd('node_modules/d3-array/dist/d3-array.min.js') + '\n' + rd('node_modules/d3-geo/dist/d3-geo.min.js')))
  .replace('/*GEO*/', () => esc(rd('src/geo-data.js')))
  .replace('/*HIST*/', () => esc(rd('src/history.js')))
  .replace('/*APP*/', () => esc(rd('src/app.js')));
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('index.html', (html.length / 1024 / 1024).toFixed(2) + ' MB');
