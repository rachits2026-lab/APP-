import meta from './hatch-meta.json';

// The hatching animation, played from a sprite sheet (hatch.webp) so it has a
// transparent background and works on every phone without video autoplay rules.
// It plays once and then rests on its last frame.
const SHEET = `${import.meta.env.BASE_URL}mascot/hatch.webp`;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Warm the sprite sheet up while the loading screen is showing.
export function preloadHatch() {
  const img = new Image();
  img.src = SHEET;
  return img.decode().catch(() => {});
}

export function createHatch() {
  const el = document.createElement('div');
  el.className = 'hatch';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'A chick hatching');
  el.style.setProperty('--ratio', `${meta.w} / ${meta.h}`);
  el.style.backgroundImage = `url(${SHEET})`;
  el.style.backgroundSize = `${meta.cols * 100}% ${meta.rows * 100}%`;

  const show = (k) => {
    const c = k % meta.cols;
    const r = Math.floor(k / meta.cols);
    const x = meta.cols > 1 ? (c / (meta.cols - 1)) * 100 : 0;
    const y = meta.rows > 1 ? (r / (meta.rows - 1)) * 100 : 0;
    el.style.backgroundPosition = `${x}% ${y}%`;
  };
  const last = meta.frames - 1;
  show(0);

  let stopped = false;

  // Resolves when the animation has finished (or could not run), with the
  // last frame showing.
  async function play() {
    try {
      const img = new Image();
      img.src = SHEET;
      await img.decode();
    } catch {
      // Sheet failed to load: nothing to animate, carry on without it.
      el.classList.add('missing');
      return;
    }
    if (stopped) return;
    el.classList.add('ready');
    if (reduced()) { show(last); return; }

    await new Promise((done) => {
      const t0 = performance.now();
      const tick = (now) => {
        if (stopped) return done();
        const k = Math.min(last, Math.floor(((now - t0) / 1000) * meta.fps));
        show(k);
        if (k >= last) return done();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  return { el, play, stop: () => { stopped = true; } };
}
