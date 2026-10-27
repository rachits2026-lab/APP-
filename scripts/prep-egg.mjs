import sharp from 'sharp';

// Usage: node scripts/prep-egg.mjs <input.png> <output.png>
// For an egg picture with a fake (baked-in) checkerboard background: the egg is
// warm cream, the checkerboard is neutral grey and white, so warmth separates
// them. Keeps the egg, fills its highlights, softens the edge, trims and scales.
const [src, out] = process.argv.slice(2);
const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;

const warm = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) warm[i] = data[i * 3] - data[i * 3 + 2] > 9 ? 1 : 0;

// Background = everything not warm that connects to the border. What is left
// (the egg, including pale highlights inside it) is kept.
const bg = new Uint8Array(W * H);
const stack = new Int32Array(W * H);
let sp = 0;
const seed = (i) => { if (!bg[i] && !warm[i]) { bg[i] = 1; stack[sp++] = i; } };
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

// Keep only the biggest warm blob (drops stray specks), then erode one pixel.
const label = new Int32Array(W * H);
let best = 0, bestSize = 0, id = 0;
for (let s = 0; s < W * H; s++) {
  if (bg[s] || label[s]) continue;
  id++; let size = 0; sp = 0; stack[sp++] = s; label[s] = id;
  while (sp) {
    const i = stack[--sp]; size++;
    const x = i % W, y = (i / W) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      if (j >= 0 && !bg[j] && !label[j]) { label[j] = id; stack[sp++] = j; }
    }
  }
  if (size > bestSize) { bestSize = size; best = id; }
}
const keep = new Uint8Array(W * H);
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = y * W + x;
  keep[i] = label[i] === best && label[i - 1] === best && label[i + 1] === best && label[i - W] === best && label[i + W] === best ? 255 : 0;
}

const soft = await sharp(Buffer.from(keep), { raw: { width: W, height: H, channels: 1 } }).blur(1.1).extractChannel(0).raw().toBuffer();
const rgba = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = soft[i]; }
const full = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
const trimmed = await sharp(full).trim({ threshold: 4 }).toBuffer();
await sharp(trimmed).resize({ height: 440, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(out);
const m = await sharp(out).metadata();
console.log(`wrote ${out} ${m.width}x${m.height}`);
