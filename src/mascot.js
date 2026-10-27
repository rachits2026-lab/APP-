// The mascot. The built-in character is a placeholder so the app has a face
// while the real one is being made.
//
// To swap in the real art: drop one image per mood into public/mascot/ and fill
// in MASCOT_IMAGES below. Any mood left as null falls back to the placeholder,
// so you can add them one at a time. Moods used by the app:
//   idle       resting, friendly
//   listening  eyes wide, waiting for a chirp
//   alert      heard something
//   happy      found it, passed, all done
//   worried    a test failed, something is overdue
//   sleepy     empty states
const CHICK = `${import.meta.env.BASE_URL}mascot/chick.png`;
export const MASCOT_IMAGES = {
  idle: CHICK, // swap each for its own image, e.g. '/mascot/idle.png'
  listening: CHICK,
  alert: CHICK,
  happy: CHICK,
  worried: CHICK,
  sleepy: CHICK,
};

const BODY = `
<svg viewBox="0 0 160 170" aria-hidden="true" focusable="false">
  <ellipse class="m-shadow" cx="80" cy="162" rx="46" ry="6"/>
  <circle class="m-body" cx="80" cy="86" r="66"/>
  <circle class="m-ring" cx="80" cy="86" r="48"/>
  <circle class="m-led" cx="80" cy="30" r="7"/>

  <g class="m-eyes m-normal"><ellipse cx="62" cy="82" rx="7" ry="10"/><ellipse cx="98" cy="82" rx="7" ry="10"/>
    <circle class="m-glint" cx="64" cy="78" r="2.6"/><circle class="m-glint" cx="100" cy="78" r="2.6"/></g>
  <g class="m-eyes m-wide"><ellipse cx="62" cy="82" rx="10" ry="14"/><ellipse cx="98" cy="82" rx="10" ry="14"/>
    <circle class="m-glint" cx="65" cy="77" r="3.4"/><circle class="m-glint" cx="101" cy="77" r="3.4"/></g>
  <g class="m-eyes m-happy"><path d="M50 88 Q62 70 74 88"/><path d="M86 88 Q98 70 110 88"/></g>
  <g class="m-eyes m-closed"><path d="M52 84 L72 84"/><path d="M88 84 L108 84"/></g>

  <g class="m-brows"><path d="M48 64 L72 72"/><path d="M112 64 L88 72"/></g>

  <path class="m-mouth m-smile" d="M64 110 Q80 122 96 110"/>
  <path class="m-mouth m-grin" d="M58 104 Q80 132 102 104 Z"/>
  <ellipse class="m-mouth m-o" cx="80" cy="114" rx="7" ry="9"/>
  <path class="m-mouth m-worry" d="M64 120 Q80 106 96 120"/>
  <path class="m-mouth m-flat" d="M68 114 L92 114"/>
</svg>`;

export function mascot(mood = 'idle', size = 120) {
  const el = document.createElement('div');
  el.className = 'mascot';
  el.style.setProperty('--size', `${size}px`);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Mascot');
  el.innerHTML = BODY;
  const img = document.createElement('img');
  img.alt = '';
  img.hidden = true;
  el.append(img);
  setMood(el, mood);
  return el;
}

export function setMood(el, mood) {
  el.dataset.mood = mood;
  const img = el.querySelector('img');
  const src = MASCOT_IMAGES[mood];
  if (src) {
    img.src = src;
    img.hidden = false;
    el.classList.add('custom');
  } else {
    img.hidden = true;
    el.classList.remove('custom');
  }
}

// Play a one-shot reaction: 'bounce', 'shake' or 'ping'.
export function react(el, kind) {
  const cls = `do-${kind}`;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}
