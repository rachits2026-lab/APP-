const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['#e8432a', '#f6b21a', '#3a9d4a', '#2f7fd1', '#231f1a'];

// A short burst of confetti from the middle of an element.
export function confetti(from, count = 44) {
  if (reduced()) return;
  const r = from.getBoundingClientRect();
  const x0 = r.left + r.width / 2;
  const y0 = r.top + r.height / 2;
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  document.body.append(layer);

  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const size = 6 + Math.random() * 7;
    p.style.cssText = `left:${x0}px;top:${y0}px;width:${size}px;height:${size * (Math.random() > 0.5 ? 1 : 0.5)}px;background:${COLORS[i % COLORS.length]}`;
    layer.append(p);
    const dx = (Math.random() - 0.5) * 360;
    const up = 120 + Math.random() * 160;
    const fall = 160 + Math.random() * 200;
    const rot = (Math.random() - 0.5) * 900;
    p.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.6}px,${-up}px) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${dx}px,${fall}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' },
    );
  }
  setTimeout(() => layer.remove(), 1800);
}

export function countUp(el, to, ms = 700) {
  if (reduced() || to === 0) { el.textContent = String(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
