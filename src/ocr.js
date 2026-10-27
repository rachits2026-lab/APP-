// Reads the manufacture date from a photo of the detector label. Runs on the
// device with locally bundled data, so it works offline. The photo is never
// stored or uploaded.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MON = MONTHS.join('|');

let workerPromise = null;

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then((T) => {
      const create = T.createWorker || T.default.createWorker;
      const base = new URL(import.meta.env.BASE_URL + 'ocr/', location.href).href;
      return create('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base,
        gzip: true,
        logger: (m) => onProgress?.(m),
      });
    });
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

async function prepare(file, maxSide = 1800) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d');
  g.filter = 'grayscale(1) contrast(1.4)';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export async function readLabel(file, onProgress) {
  const canvas = await prepare(file);
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return { text: data.text, found: findDate(data.text) };
}

const okYear = (y) => y >= 1985 && y <= new Date().getFullYear();
const expandYear = (y) => (y >= 100 ? y : y >= 80 ? 1900 + y : 2000 + y);

// Returns { date: 'YYYY-MM-DD', exact: boolean } or null. Text near a
// "manufactured" style label is tried first.
export function findDate(raw) {
  const text = raw.toUpperCase().replace(/\s+/g, ' ');
  const at = text.search(/(MANUFACTUR|MFG|MFD|DATE CODE|MADE)/);
  if (at >= 0) {
    const near = scan(text.slice(at, at + 60));
    if (near) return near;
  }
  return scan(text);
}

function scan(t) {
  let m;
  // 2014-03-21
  if ((m = t.match(/\b((?:19|20)\d{2})[-/. ](0?[1-9]|1[0-2])[-/. ](0?[1-9]|[12]\d|3[01])\b/))) {
    if (okYear(+m[1])) return mk(+m[1], +m[2], +m[3], true);
  }
  // 21 MAR 2014, 21-MAR-14
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})[ -./]?(${MON})[A-Z]*[ -./,]*(\\d{2,4})\\b`)))) {
    const y = expandYear(+m[3]);
    if (okYear(y)) return mk(y, MONTHS.indexOf(m[2]) + 1, +m[1], true);
  }
  // MAR 2014, MARCH 21, 2014
  if ((m = t.match(new RegExp(`\\b(${MON})[A-Z]*[ -./]*(\\d{1,2})?[ ,.-]*((?:19|20)\\d{2})\\b`)))) {
    if (okYear(+m[3])) return mk(+m[3], MONTHS.indexOf(m[1]) + 1, m[2] ? +m[2] : 1, !!m[2]);
  }
  // 03/21/2014, or 21/03/2014 when the first number cannot be a month
  if ((m = t.match(/\b(\d{1,2})[-/. ](\d{1,2})[-/. ]((?:19|20)\d{2})\b/))) {
    let a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) [a, b] = [b, a];
    if (okYear(+m[3]) && a <= 12) return mk(+m[3], a, b, true);
  }
  // 03/2014
  if ((m = t.match(/\b(0?[1-9]|1[0-2])[-/.]((?:19|20)\d{2})\b/))) {
    if (okYear(+m[2])) return mk(+m[2], +m[1], 1, false);
  }
  // MFG 2014
  if ((m = t.match(/(?:MANUFACTUR\w*|MFG|MFD|MADE)\D{0,25}((?:19|20)\d{2})\b/))) {
    if (okYear(+m[1])) return mk(+m[1], 1, 1, false);
  }
  return null;
}

function mk(y, mo, d, exact) {
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1) return null;
  return { date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, exact };
}
