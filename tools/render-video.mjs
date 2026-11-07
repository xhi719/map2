// Renders the animation to an MP4 (1920x1080, 30 fps) with headless Chromium + ffmpeg.
//   node tools/render-video.mjs [out.mp4] [daysPerSecond=11]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'video/ww2_europe_fronts_1939-1945.mp4'));
const DPS = Number(process.argv[3] || 11), FPS = 30, HOLD_END_S = 3;
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto('file://' + path.join(root, 'index.html') + '?render');
await page.waitForFunction(() => window.READY === true);
const { T_START, T_STOP } = await page.evaluate(() => ({ T_START: window.WW2.T_START, T_STOP: window.WW2.T_STOP }));
const step = DPS / FPS;
const n = Math.ceil((T_STOP - T_START) / step) + 1;
console.log(`frames: ${n} (+${HOLD_END_S * FPS} hold), ~${((n / FPS) + HOLD_END_S).toFixed(1)} s`);

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));

const t0 = Date.now();
let last = null;
for (let i = 0; i < n; i++) {
  const t = Math.min(T_STOP, T_START + i * step);
  const b64 = await page.evaluate((t) => { window.renderAt(t); return document.getElementById('map').toDataURL('image/jpeg', 0.93).slice(23); }, t);
  last = Buffer.from(b64, 'base64');
  await write(last);
  if (i % 300 === 0) console.log(`${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
for (let i = 0; i < HOLD_END_S * FPS; i++) await write(last);
ff.stdin.end();
await new Promise((res) => ff.on('close', res));
await browser.close();
console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB', `${((Date.now() - t0) / 1000).toFixed(0)}s`);
