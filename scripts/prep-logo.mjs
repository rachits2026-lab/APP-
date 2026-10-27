import sharp from 'sharp';

// Usage: node scripts/prep-logo.mjs <input.png> <output.png>
// For a logo exported as dark letters on a solid black background: rebuilds it
// as a transparent PNG (letters become the alpha), fills it with the app's ink
// colour, trims the empty margin and scales it to a phone-friendly width.
const [src, out] = process.argv.slice(2);
const INK = { r: 0x2b, g: 0x1d, b: 0x0e };

const { data, info } = await sharp(src).greyscale().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const rgba = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const a = Math.max(0, Math.min(1, (data[i] - 5) / 6)); // soft edge, ignores black-level noise
  rgba[i * 4] = INK.r; rgba[i * 4 + 1] = INK.g; rgba[i * 4 + 2] = INK.b; rgba[i * 4 + 3] = Math.round(a * 255);
}
const full = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
const trimmed = await sharp(full).trim({ threshold: 8 }).toBuffer();
await sharp(trimmed).extend({ top: 6, bottom: 6, left: 6, right: 6, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize({ width: 900, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(out);
const m = await sharp(out).metadata();
console.log(`wrote ${out} ${m.width}x${m.height}`);
