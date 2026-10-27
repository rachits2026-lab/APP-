// Turns a black-background video clip into a transparent sprite sheet.
//
//   node scripts/hatch-sprite.mjs <video.mp4> <startSec> <endSec> <fps> <outDir>
//
// Needs: npm i -D playwright-core sharp, and Microsoft Edge or Chrome installed
// (used only to decode the video frames).
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import http from 'node:http';
import fs from 'node:fs';

const [video, startS, endS, fpsS, outDir] = process.argv.slice(2);
const start = +startS, end = +endS, fps = +fpsS;
const COLS = 5;
const FRAME_W = 420;

const size = fs.statSync(video).size;
const server = http.createServer((req, res) => {
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const a = +s, b = e ? +e : size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Content-Type': 'video/mp4' });
    fs.createReadStream(video, { start: a, end: b }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(video).pipe(res);
  }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 850, height: 1088 } });
await page.setContent(`<body style="margin:0;background:#000"><video id=v muted playsinline preload=auto src="http://127.0.0.1:${port}/v.mp4" style="display:block;width:850px;height:1088px"></video></body>`);
await page.waitForFunction(() => document.getElementById('v').readyState >= 2, null, { timeout: 20000 });
const dims = await page.evaluate(() => ({ w: document.getElementById('v').videoWidth, h: document.getElementById('v').videoHeight }));
console.log('video', dims);

const times = [];
for (let t = start; t < end - 1e-6; t += 1 / fps) times.push(t);
times.push(end);

const raws = [];
for (const t of times) {
  await page.evaluate((t) => new Promise((res) => { const v = document.getElementById('v'); v.onseeked = () => res(); v.currentTime = t; }), t);
  const png = await page.screenshot({ type: 'png' });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  raws.push({ data, W: info.width, H: info.height });
}
await browser.close();
server.close();
const { W, H } = raws[0];

// Background = dark pixels connected to the frame border.
function backgroundMask(rgba) {
  const bg = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let sp = 0;
  const dark = (i) => rgba[i * 4] < 48 && rgba[i * 4 + 1] < 48 && rgba[i * 4 + 2] < 48;
  const seed = (i) => { if (!bg[i] && dark(i)) { bg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % W, y = (i / W) | 0;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (y > 0) seed(i - W);
    if (y < H - 1) seed(i + W);
  }
  return bg;
}

const frames = raws.map(({ data }) => {
  const bg = backgroundMask(data);
  // Erode one pixel so dark anti-aliased edge pixels do not leave a fringe.
  const keep = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (bg[i]) continue;
    const edge = (x > 0 && bg[i - 1]) || (x < W - 1 && bg[i + 1]) || (y > 0 && bg[i - W]) || (y < H - 1 && bg[i + W]);
    keep[i] = edge ? 0 : 1;
  }
  // Spread the colour of kept pixels two pixels outward so the soft alpha
  // edge blends with chick colour, not with black.
  const rgb = Buffer.from(data);
  const have = Uint8Array.from(keep);
  for (let pass = 0; pass < 2; pass++) {
    const next = Uint8Array.from(have);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (have[i]) continue;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (have[j]) { rgb[i * 4] = rgb[j * 4]; rgb[i * 4 + 1] = rgb[j * 4 + 1]; rgb[i * 4 + 2] = rgb[j * 4 + 2]; next[i] = 1; break; }
      }
    }
    have.set(next);
  }
  return { rgb, keep };
});

// The source clip zooms and pans, so give every frame its own tight crop and
// scale it to the same height, centred, sitting on the same baseline.
const CELL_H = 590;
const FIG_H = 556;
const FIG_MAX_W = FRAME_W - 12;
const fh = CELL_H;
const rows = Math.ceil(frames.length / COLS);
const composites = [];
let lastPng;
for (let k = 0; k < frames.length; k++) {
  const { rgb, keep } = frames[k];
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (keep[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

  const alpha = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = keep[i] ? 255 : 0;
  const soft = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } }).blur(0.9).extractChannel(0).raw().toBuffer();
  if (soft.length !== W * H) throw new Error('alpha size mismatch');
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = rgb[i * 4]; out[i * 4 + 1] = rgb[i * 4 + 1]; out[i * 4 + 2] = rgb[i * 4 + 2]; out[i * 4 + 3] = soft[i]; }

  const scale = Math.min(FIG_MAX_W / cw, FIG_H / ch);
  const tw = Math.round(cw * scale), th = Math.round(ch * scale);
  const fig = await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: cw, height: ch })
    .resize(tw, th)
    .png()
    .toBuffer();
  const cell = await sharp({ create: { width: FRAME_W, height: fh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fig, left: Math.round((FRAME_W - tw) / 2), top: fh - th - 6 }])
    .png()
    .toBuffer();
  composites.push({ input: cell, left: (k % COLS) * FRAME_W, top: Math.floor(k / COLS) * fh });
  if (k === frames.length - 1) lastPng = cell;
}
fs.mkdirSync(outDir, { recursive: true });
await sharp({ create: { width: COLS * FRAME_W, height: rows * fh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(composites)
  .webp({ quality: 88, alphaQuality: 95 })
  .toFile(`${outDir}/hatch.webp`);
fs.writeFileSync(`${outDir}/hatch-last.png`, lastPng);
fs.writeFileSync(`${outDir}/hatch.json`, JSON.stringify({ cols: COLS, rows, frames: frames.length, w: FRAME_W, h: fh, fps }, null, 2));
console.log('wrote', outDir, fs.statSync(`${outDir}/hatch.webp`).size, 'bytes');
