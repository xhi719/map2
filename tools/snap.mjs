// Render stills for given dates: node tools/snap.mjs out_dir 1941-06-22 1942-11-18 ...
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let [outDir, ...dates] = process.argv.slice(2);
let cam = null;
if (dates[0] && dates[0].startsWith('cam=')) { const [lon, lat, k] = dates.shift().slice(4).split(',').map(Number); cam = { lon, lat, k }; }
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log('console:', m.text()); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('file://' + path.join(root, 'index.html') + '?render');
await page.waitForFunction(() => window.READY === true);
if (cam) await page.evaluate((c) => window.WW2.setCam(c), cam);
for (const d of dates) {
  const t = await page.evaluate((d) => window.WW2.dnum(isNaN(Number(d)) ? d : Number(d)), d);
  const t0 = Date.now();
  await page.evaluate((t) => window.renderAt(t), t);
  const ms = Date.now() - t0;
  const buf = await page.evaluate(() => document.getElementById('map').toDataURL('image/jpeg', 0.85));
  fs.writeFileSync(path.join(outDir, `${d}.jpg`), Buffer.from(buf.split(',')[1], 'base64'));
  console.log(d, ms + 'ms');
}
await browser.close();
