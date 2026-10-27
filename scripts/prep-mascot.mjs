import sharp from 'sharp';

// Usage: node scripts/prep-mascot.mjs <input.png> <output.png>
// Trims transparent margins and scales to a phone-friendly size.
const [src, out] = process.argv.slice(2);
const img = sharp(src).ensureAlpha().trim({ threshold: 8 });
const meta = await img.clone().toBuffer({ resolveWithObject: true });
await sharp(meta.data).resize({ height: 720, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(out);
const m = await sharp(out).metadata();
console.log(`wrote ${out} ${m.width}x${m.height}`);
