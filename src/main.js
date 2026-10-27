import './style.css';
import * as S from './store.js';
import { today, fmt, fmtMonth, ageText, nextDst, iso } from './dates.js';
import { Listener, ChirpDetector, meterValue, micErrorText, buzz } from './audio.js';
import { playPracticeChirps, playTestAlarm, ScriptedListener, walkThrough } from './demo.js';
import { readLabel } from './ocr.js';
import { dueNow, fireDueNotifications, enableNotifications, notificationsSupported, downloadCalendar } from './reminders.js';
import { mascot, setMood, react } from './mascot.js';
import { createHatch, preloadHatch } from './sprite.js';
import { confetti, countUp } from './fx.js';

const app = document.getElementById('main');
let cleanup = null;

// ---------- tiny DOM helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

// replaceChildren turns null into the text "null", so drop empties first.
function fill(el, nodes) {
  el.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
}

function show(...nodes) {
  fill(app, nodes);
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function badge(status) {
  return h('span', { class: `badge ${status.code}` }, status.label);
}

// A light tap on every button, like a native app.
document.addEventListener('click', (e) => {
  if (e.target.closest('.btn, .chip')) buzz(8);
});

// ---------- header streak ----------
let lastStreak = -1;
function updateStreak() {
  const n = S.streak();
  const pill = document.getElementById('streak');
  document.getElementById('streak-n').textContent = String(n);
  pill.classList.toggle('lit', n > 0);
  pill.setAttribute('aria-label', `${n} month${n === 1 ? '' : 's'} in a row with every detector tested`);
  if (lastStreak >= 0 && n > lastStreak) {
    pill.classList.remove('bump');
    void pill.offsetWidth;
    pill.classList.add('bump');
  }
  lastStreak = n;
}

// ---------- router ----------
const routes = [
  [/^\/$/, homeView],
  [/^\/welcome$/, welcomeView],
  [/^\/find$/, () => findView('real')],
  [/^\/find\/(practice|sim)$/, (m) => findView(m[1])],
  [/^\/add$/, () => formView(null)],
  [/^\/detectors$/, listView],
  [/^\/detector\/(.+)$/, (m) => (S.getDetector(m[1]) ? formView(S.getDetector(m[1])) : go('#/detectors'))],
  [/^\/test$/, () => testView('real')],
  [/^\/test\/demo$/, () => testView('demo')],
  [/^\/demo$/, demoView],
  [/^\/reminders$/, remindersView],
  [/^\/about$/, aboutView],
];

// Leaving a screen fades it out first, then the next one fades in.
let routeToken = 0;
let lastPath = '';
let booted = false;
const splash = document.getElementById('splash');
const LOADING_MS = 1700;

// Going from the welcome screen into the app shows the loading screen (the
// egg and the logo) for a moment. Switching tabs never does.
function route() {
  cleanup?.();
  cleanup = null;
  const token = ++routeToken;
  const path = location.hash.slice(1) || '/';
  if (booted && lastPath === '/welcome' && path !== '/welcome') {
    splash?.classList.remove('out');
    setTimeout(() => {
      if (token !== routeToken) return;
      render();
      splash?.classList.add('out');
    }, LOADING_MS);
    return;
  }
  if (booted) splash?.classList.add('out');
  // The tab highlight starts gliding straight away; the page fades behind it.
  if (booted && lastPath !== '/welcome' && path !== '/welcome') markTabs(path);
  const soft = app.childElementCount && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!soft) return render();
  app.classList.add('leaving');
  setTimeout(() => { if (token === routeToken) render(); }, 160);
}

function render() {
  app.classList.remove('leaving');
  const path = location.hash.slice(1) || '/';
  lastPath = path;
  document.body.classList.toggle('on-welcome', path === '/welcome');
  try {
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) { fn(m); break; }
    }
  } catch (err) {
    showError(err);
  }
  markTabs(path);
  replayEnter();
  updateStreak();
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

// If something breaks, say so on screen instead of leaving a dead page.
function showError(err) {
  console.error(err);
  document.body.classList.remove('on-welcome');
  show(
    h('h1', null, 'Something went wrong'),
    h('div', { class: 'error', role: 'alert' }, String(err && err.message ? err.message : err)),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload'),
      h('a', { class: 'btn', href: '#/welcome' }, 'Back to start')));
}

window.addEventListener('error', (e) => {
  if (!app.childElementCount) showError(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => console.error(e.reason));

// Restart the fade-in each time a screen is drawn.
function replayEnter() {
  app.classList.remove('enter');
  void app.offsetWidth;
  app.classList.add('enter');
}

// The highlight on the tab bar is one pill that glides to the selected tab.
// It jumps (no glide) the first time it appears and when the window resizes.
const tabBar = document.querySelector('.tabs');
let pillPlaced = false;

function markTabs(path) {
  document.querySelectorAll('.tabs a').forEach((a) => {
    const tab = a.dataset.tab;
    const on = tab === 'home' ? path === '/' : path.startsWith('/' + tab) || (tab === 'detectors' && /^\/(add|detector)/.test(path));
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  moveTabPill();
}

function moveTabPill(snap = false) {
  const current = tabBar.querySelector('a[aria-current="page"]');
  if (!current || !current.offsetWidth) { tabBar.classList.add('no-pill'); pillPlaced = false; return; }
  tabBar.style.setProperty('--px', `${current.offsetLeft}px`);
  tabBar.style.setProperty('--pw', `${current.offsetWidth}px`);
  const jump = snap || !pillPlaced;
  if (jump) {
    tabBar.classList.add('snap');
    void tabBar.offsetWidth;
  }
  tabBar.classList.remove('no-pill');
  if (jump) requestAnimationFrame(() => tabBar.classList.remove('snap'));
  pillPlaced = true;
}
window.addEventListener('resize', () => moveTabPill(true));

window.addEventListener('hashchange', () => { if (booted) route(); });

// ---------- welcome ----------
// Shown every time the app opens. The chick hatches, rests on its last frame,
// then the title and buttons fade in.
function welcomeView() {
  const hatch = createHatch();
  const page = h('div', { class: 'welcome' });
  const top = h('div', { class: 'welcome-top', onclick: () => { react(top, 'bounce'); buzz(15); } }, hatch.el);
  fill(page, [
    top,
    h('h1', { class: 'welcome-title' }, h('img', { src: `${import.meta.env.BASE_URL}logo.png`, alt: 'Chirp Hunter' })),
    h('p', { class: 'welcome-sub' }, 'Find the chirping smoke detector fast, and never miss a battery change again.'),
    h('div', { class: 'welcome-actions' },
      h('a', { class: 'btn primary big', href: '#/find' }, 'Find a chirp'),
      h('a', { class: 'btn big', href: '#/' }, 'Open the app'),
      h('a', { class: 'btn ghost', href: '#/demo' }, 'Demo tools')),
  ]);
  show(page);

  cleanup = () => hatch.stop();
  // Fallback so the buttons always appear, even if the animation cannot run.
  const reveal = () => page.classList.add('ready');
  const failsafe = setTimeout(reveal, 3500);
  hatch.play().finally(() => { clearTimeout(failsafe); reveal(); });
}

// ---------- home ----------
function greeting() {
  const list = S.detectors();
  if (!list.length) return ['idle', 'Hi, I\'m Beep. Hear a chirp? Let\'s hunt it down.'];
  if (list.some((d) => S.statusOf(d).code === 'replace')) return ['worried', 'One of your detectors is past its ten year life. Time to replace it.'];
  if (!S.testedThisMonth()) return ['listening', 'Time for this month\'s test. It only takes a minute.'];
  const n = S.streak();
  return ['happy', n > 1 ? `${n} months in a row. Nice work.` : 'All tested this month. Nice work.'];
}

function homeView() {
  const list = S.detectors();
  const needs = list.filter((d) => S.statusOf(d).code !== 'ok');
  const due = dueNow();
  const [mood, line] = greeting();
  const mas = mascot(mood, 112);

  const nodes = [
    h('div', { class: 'hero' }, mas, h('div', { class: 'bubble' }, line)),
    h('a', { class: 'btn primary big block', href: '#/find' }, 'Find the chirp'),
  ];

  if (due.length) {
    nodes.push(h('h2', null, 'Do soon'));
    nodes.push(h('div', { class: 'panel' }, due.map((d) => h('div', { class: 'rem' },
      h('strong', null, d.title), d.body,
      d.go ? h('div', { class: 'row' }, h('a', { class: 'btn solid', href: d.go }, 'Start')) : null))));
  }

  nodes.push(h('h2', null, 'Your detectors'));
  if (!list.length) {
    nodes.push(h('p', null, 'None saved yet. Find the chirping one first, or add a detector by hand.'));
    nodes.push(h('div', { class: 'row split' }, h('a', { class: 'btn solid', href: '#/add' }, 'Add a detector'), h('a', { class: 'btn', href: '#/demo' }, 'Try the demo')));
  } else {
    nodes.push(h('p', null, `${list.length} saved. ${needs.length ? `${needs.length} need${needs.length === 1 ? 's' : ''} attention.` : 'All look fine.'}`));
    nodes.push(h('div', { class: 'row split' }, h('a', { class: 'btn', href: '#/detectors' }, 'My detectors'), h('a', { class: 'btn solid', href: '#/test' }, 'Run test')));
  }

  nodes.push(footer());
  show(...nodes);
}

function footer() {
  return h('footer', { class: 'foot' }, h('a', { href: '#/about' }, 'Privacy and terms'));
}

// ---------- find chirp ----------
// mode: 'real' listens through the microphone. 'practice' plays chirps through
// the speaker that the microphone then hears. 'sim' uses scripted readings.
function findView(mode = 'real') {
  const wrap = h('div');
  const mas = mascot('idle', 104);
  show(h('h1', null, 'Find the chirp'), wrap);

  let listener = null;
  let raf = 0;
  let wake = null;
  let alive = true;
  let calmTimer = 0;

  cleanup = () => {
    alive = false;
    cancelAnimationFrame(raf);
    clearTimeout(calmTimer);
    listener?.stop();
    wake?.release?.().catch(() => {});
  };

  const idle = (error) => {
    setMood(mas, error ? 'worried' : 'idle');
    fill(wrap, [
      h('div', { class: 'hero' }, mas, h('div', { class: 'bubble' }, 'Stand in the middle of the house and tap start. Hold the phone out in front of you.')),
      h('ol', null,
        h('li', null, 'Wait for a chirp. They come about once a minute.'),
        h('li', null, 'Walk toward where the meter reads higher.'),
        h('li', null, 'Stop after a few steps and wait for the next chirp.'),
        h('li', null, 'When the meter is full and the phone buzzes, look up.')),
      error ? h('div', { class: 'error', role: 'alert' }, error) : null,
      h('button', { class: 'btn primary big block', onclick: () => begin('real') }, 'Start listening'),
      h('p', { class: 'hint' }, 'The microphone is used only on this screen. Nothing is recorded.'),
      h('div', { class: 'panel demo-panel' },
        h('h3', null, 'No chirping detector handy?'),
        h('p', { class: 'muted small' }, 'Try the demo. Practice chirps play from your speaker and the microphone really hears them.'),
        h('div', { class: 'row split' },
          h('button', { class: 'btn solid', onclick: () => begin('practice') }, 'Play practice chirps'),
          h('button', { class: 'btn', onclick: () => begin('sim') }, 'Simulate a walk'))),
    ]);
  };

  async function begin(how) {
    mode = how;
    listener = how === 'sim' ? walkThrough() : new Listener();
    try {
      await listener.start();
    } catch (e) {
      listener = null;
      idle(micErrorText(e));
      return;
    }
    try { wake = await navigator.wakeLock?.request('screen'); } catch {}
    run();
    if (how === 'practice') playPracticeChirps().catch(() => {});
  }

  function run() {
    setMood(mas, 'listening');
    const segs = Array.from({ length: 20 }, (_, i) => h('i', { class: i < 7 ? 'a' : i < 14 ? 'b' : 'c' }));
    const num = h('div', { class: 'meter-num' }, '0');
    const word = h('div', { class: 'meter-word' }, 'Waiting');
    const live = h('b');
    const hist = h('div', { class: 'history', 'aria-hidden': 'true' });
    const trend = h('div', { class: 'bubble', 'aria-live': 'polite' },
      mode === 'practice' ? 'Practice chirps are coming from your speaker. Keep the phone near it and turn the volume up.' :
      mode === 'sim' ? 'Demo: pretend you are walking toward the detector.' :
      'Listening. The first chirp can take up to a minute.');
    const found = h('div');
    const meter = h('div', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-label': 'Chirp loudness' }, segs);

    fill(wrap, [
      mode === 'real' ? null : h('div', { class: 'tag' }, mode === 'practice' ? 'Demo: practice chirps' : 'Demo: simulated'),
      h('div', { class: 'hero' }, mas, trend),
      h('div', { class: 'meter-wrap' },
        h('div', { class: 'meter-read' }, num, word),
        meter,
        h('div', { class: 'live' }, h('span', null, 'Room'), h('span', { class: 'bar' }, live))),
      found,
      h('h3', null, 'Recent chirps'),
      hist,
      h('div', { class: 'row' }, h('button', { class: 'btn block', onclick: () => { cleanup(); go('#/'); } }, 'Stop')),
    ]);

    const det = new ChirpDetector();
    const chirps = [];
    let held = 0;
    let heldAt = 0;
    let shown = -1;
    let lastT = performance.now();

    const say = (t) => { trend.textContent = t; };

    const paint = (v) => {
      const r = Math.round(v);
      if (r === shown) return;
      shown = r;
      const lit = Math.round((v / 100) * segs.length);
      segs.forEach((s, i) => s.classList.toggle('on', i < lit));
      num.textContent = String(r);
      meter.setAttribute('aria-valuenow', r);
      word.textContent = r >= 88 ? 'Right here' : r >= 65 ? 'Very close' : r >= 35 ? 'Getting close' : r > 0 ? 'Faint' : 'Waiting';
    };

    const tick = (now) => {
      if (!alive) return;
      const dt = (now - lastT) / 1000;
      lastT = now;

      const r = listener.read();
      const ev = det.push(r, now);
      live.style.width = `${Math.max(0, Math.min(100, ((r.level - det.floor) / 40) * 100))}%`;

      if (ev) {
        const v = meterValue(ev.peak, ev.floor);
        const prev = chirps.length ? chirps[chirps.length - 1] : null;
        chirps.push(v);
        held = v;
        heldAt = now;

        setMood(mas, 'alert');
        react(mas, 'ping');
        clearTimeout(calmTimer);
        calmTimer = setTimeout(() => setMood(mas, v >= 88 ? 'happy' : 'listening'), 900);

        if (prev == null) say('Heard it. Take a few steps, then wait for the next one.');
        else if (v - prev > 6) say('Louder than last time. You are getting closer.');
        else if (prev - v > 6) say('Quieter than last time. Turn around.');
        else say('About the same as last time. Try another direction.');
        hist.replaceChildren(...chirps.slice(-12).map((c) => h('span', { style: `height:${Math.max(6, c)}%` })));

        meter.classList.remove('hit');
        if (v >= 88) {
          void meter.offsetWidth;
          meter.classList.add('hit');
          buzz([250, 120, 250, 120, 400]);
          say('This is very likely the one. Look up at the ceiling and walls here.');
          fill(found, [h('div', { class: 'panel alarm' },
            h('h3', null, 'Found it?'),
            h('p', null, 'Save it now so I can track its battery and age.'),
            h('div', { class: 'row stack' },
              h('a', { class: 'btn primary', href: '#/add', onclick: () => cleanup() }, 'Save this detector'),
              h('button', { class: 'btn ghost', onclick: () => fill(found, []) }, 'Keep looking')))]);
          confetti(found);
        }
      }

      // Hold the last chirp's reading, then let it fall so walking away shows.
      if (held > 0 && now - heldAt > 8000) held = Math.max(0, held - 2.5 * dt);
      paint(held);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  if (mode === 'real') idle();
  else begin(mode);
}

// ---------- detector list ----------
function listView() {
  const list = S.detectors();
  const nodes = [h('div', { class: 'head-row' }, h('h1', null, 'Detectors'),
    list.length ? h('a', { class: 'btn small solid', href: '#/add' }, 'Add') : null)];
  if (!list.length) {
    nodes.push(h('div', { class: 'hero' }, mascot('sleepy', 104), h('div', { class: 'bubble' }, 'Nothing saved yet. Add your first detector and I\'ll keep an eye on it.')));
    nodes.push(h('div', { class: 'row stack' },
      h('a', { class: 'btn solid big', href: '#/add' }, 'Add a detector'),
      h('button', { class: 'btn', onclick: () => { S.loadDemo(); toast('Sample detectors loaded'); listView(); replayEnter(); updateStreak(); } }, 'Load sample detectors')));
  } else {
    nodes.push(h('ul', { class: 'list' }, list.map(card)));
  }
  show(...nodes);
}

function card(d, i) {
  const s = S.statusOf(d);
  const rep = S.replaceBy(d);
  return h('li', { class: 'card', style: `--i:${i}` },
    h('div', { class: 'card-head' }, h('h3', null, d.name), badge(s)),
    s.detail ? h('p', { class: 'muted small' }, s.detail) : null,
    h('dl', null,
      h('dt', null, 'Battery changed'), h('dd', null, fmt(d.batteryDate)),
      h('dt', null, 'Made'), h('dd', null, d.madeDate ? `${fmtMonth(d.madeDate)} (${ageText(d.madeDate)} old)` : 'Unknown'),
      h('dt', null, 'Replace by'), h('dd', null, rep ? fmtMonth(rep) : 'Unknown')),
    h('div', { class: 'row split wide-first' },
      h('button', { class: 'btn', onclick: () => { S.updateDetector(d.id, { batteryDate: today() }); toast(`Battery date saved for ${d.name}`); listView(); replayEnter(); } }, 'Changed battery today'),
      h('a', { class: 'btn', href: `#/detector/${d.id}` }, 'Edit')));
}

// ---------- add / edit ----------
const PLACES = ['Hallway', 'Bedroom', 'Kitchen', 'Living room', 'Basement', 'Garage', 'Stairs'];

function formView(existing) {
  const editing = !!existing;
  const d = existing || { name: '', batteryDate: today(), madeDate: '' };

  const name = h('input', { type: 'text', id: 'name', value: d.name, autocomplete: 'off', placeholder: 'Upstairs hallway' });
  const battery = h('input', { type: 'date', id: 'battery', value: d.batteryDate, max: today() });
  const made = h('input', { type: 'date', id: 'made', value: d.madeDate, max: today() });
  const ocrOut = h('div', { 'aria-live': 'polite' });
  const err = h('div', { role: 'alert' });
  const chipEls = PLACES.map((p) => h('button', { type: 'button', class: 'chip', onclick: () => { name.value = p; syncChips(); } }, p));
  const syncChips = () => chipEls.forEach((c) => c.classList.toggle('on', c.textContent === name.value.trim()));
  name.addEventListener('input', syncChips);
  syncChips();

  const photo = h('input', {
    type: 'file', id: 'photo', accept: 'image/*', capture: 'environment',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const bar = h('b');
      fill(ocrOut, [h('div', { class: 'loading' }, h('span', null, 'Reading label'), h('span', { class: 'bar' }, bar))]);
      try {
        const { found } = await readLabel(file, (m) => {
          if (m.status === 'recognizing text') bar.style.width = `${Math.round(m.progress * 100)}%`;
        });
        if (found) {
          made.value = found.date;
          fill(ocrOut, [h('div', { class: 'panel alarm' }, `Read ${found.exact ? fmt(found.date) : fmtMonth(found.date) + ' (month or year only)'} from the label. Check that it matches.`)]);
        } else {
          fill(ocrOut, [h('p', { class: 'hint' }, 'Could not find a date. Try a closer, brighter photo, or type it in from the label.')]);
        }
      } catch {
        fill(ocrOut, [h('p', { class: 'hint' }, 'The label reader could not run here. Type the date from the label.')]);
      }
    },
  });

  const save = () => {
    const nm = name.value.trim();
    if (!nm) {
      fill(err, [h('div', { class: 'error' }, 'Give the detector a location name.')]);
      name.focus();
      return;
    }
    const patch = { name: nm, batteryDate: battery.value || today(), madeDate: made.value };
    if (editing) S.updateDetector(existing.id, patch);
    else S.addDetector(patch);
    go('#/detectors');
  };

  show(
    h('h1', null, editing ? 'Edit detector' : 'Save this detector'),
    h('label', { for: 'name' }, 'Where is it?'),
    name,
    h('div', { class: 'chips' }, chipEls),
    h('label', { for: 'photo' }, 'Photo of the back of the detector'),
    photo,
    h('p', { class: 'hint' }, 'Twist it off the ceiling and photograph the label. The date is read on your phone and the photo is not kept.'),
    ocrOut,
    h('label', { for: 'made' }, 'Date it was made'),
    made,
    h('label', { for: 'battery' }, 'Battery last changed'),
    battery,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => { battery.value = today(); } }, 'Changed it today')),
    err,
    h('div', { class: 'row stack form-actions' },
      h('button', { class: 'btn primary big', onclick: save }, 'Save'),
      h('a', { class: 'btn ghost', href: '#/detectors' }, 'Cancel'),
      editing ? h('button', { class: 'btn ghost danger', onclick: () => {
        if (confirm(`Remove ${existing.name}?`)) { S.removeDetector(existing.id); go('#/detectors'); }
      } }, 'Remove detector') : null),
  );
}

// ---------- monthly test ----------
function progress(states) {
  return h('div', { class: 'progress', 'aria-hidden': 'true' }, states.map((s) => h('i', { class: s })));
}

// mode: 'real' uses the microphone. 'demo' uses scripted readings: every
// detector passes except the last, which stays silent so the failure screen
// can be shown too.
function testView(mode = 'real') {
  const list = S.detectors();
  if (!list.length) {
    show(h('h1', null, 'Test'),
      h('div', { class: 'hero' }, mascot('sleepy', 104), h('div', { class: 'bubble' }, 'Save a detector first, then come back and I\'ll help you test it.')),
      h('div', { class: 'row stack' },
        h('a', { class: 'btn solid big', href: '#/add' }, 'Add a detector'),
        h('button', { class: 'btn', onclick: () => { S.loadDemo(); toast('Sample detectors loaded'); go('#/test/demo'); } }, 'Load samples and run a demo')));
    return;
  }

  const demo = mode === 'demo';
  const limit = demo ? 7 : 20;
  const results = [];
  let listener = null;
  let raf = 0;
  let alive = true;
  cleanup = () => { alive = false; cancelAnimationFrame(raf); listener?.stop(); };

  const bars = (i, current = true) => progress(list.map((_, k) => {
    if (k < results.length) return results[k].pass ? 'done' : 'bad';
    return k === i && current ? 'current' : '';
  }));

  const intro = (error) => show(
    h('h1', null, demo ? 'Demo test' : 'Monthly test'),
    h('div', { class: 'hero' }, mascot(error ? 'worried' : 'listening', 104),
      h('div', { class: 'bubble' }, demo
        ? 'Demo: each detector sounds automatically, except the last one so you can see a failure.'
        : `${list.length} detector${list.length === 1 ? '' : 's'} to check. Hold the phone near each one and press its test button.`)),
    demo ? null : h('p', { class: 'muted' }, 'Test alarms are loud. Keep the phone about an arm\'s length away.'),
    error ? h('div', { class: 'error', role: 'alert' }, error) : null,
    h('button', { class: 'btn primary big block', onclick: begin }, demo ? 'Start demo test' : 'Start test'),
    demo ? null : h('div', { class: 'panel demo-panel' },
      h('h3', null, 'No detector handy?'),
      h('p', { class: 'muted small' }, 'Run a quick demo with scripted alarms. You can also play an alarm sound from this screen\'s speaker during a real test.'),
      h('a', { class: 'btn', href: '#/test/demo' }, 'Run a demo test')),
  );

  async function begin() {
    if (!demo) {
      listener = new Listener();
      try { await listener.start(); } catch (e) { listener = null; intro(micErrorText(e)); return; }
    }
    step(0);
  }

  function step(i) {
    if (i >= list.length) return summary();
    const d = list[i];
    if (demo) {
      const silent = list.length > 1 && i === list.length - 1;
      listener = new ScriptedListener({ alarmAt: silent ? null : 1400 });
    }
    const timer = h('div', { class: 'timer' }, String(limit));
    const tbar = h('b');
    const mas = mascot('listening', 96);
    const status = h('div', { class: 'bubble', 'aria-live': 'polite' }, demo ? 'Waiting for the alarm...' : 'Press the test button now.');
    show(
      bars(i),
      h('p', { class: 'steps' }, `Detector ${i + 1} of ${list.length}`),
      h('div', { class: 'test-name' }, d.name),
      h('div', { class: 'hero' }, mas, status),
      timer,
      h('div', { class: 'timebar' }, tbar),
      h('div', { class: 'row stack' },
        h('button', { class: 'btn', onclick: () => finish(false, 'Skipped') }, 'It did not sound'),
        demo ? null : h('button', { class: 'btn ghost', onclick: () => { playTestAlarm().catch(() => {}); } }, 'Demo: play an alarm sound')),
    );
    replayEnter();

    const t0 = performance.now();
    let last = t0;
    let loudMs = 0;
    let floor = null;
    const warm = [];
    let done = false;

    const finish = (pass, note) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      results.push({ id: d.id, name: d.name, pass, note });
      result(i, pass);
    };

    const tick = (now) => {
      if (!alive || done) return;
      const dt = now - last;
      last = now;
      const r = listener.read();
      const elapsed = now - t0;

      if (elapsed < 500) {
        warm.push(r.level);
        raf = requestAnimationFrame(tick);
        return;
      }
      if (floor === null) {
        warm.sort((a, b) => a - b);
        floor = warm.length ? warm[warm.length >> 1] : r.level;
      }
      const loud = r.level - floor > 20 && r.tonal > 14;
      if (loud) loudMs += dt;
      else floor += (r.level - floor) * 0.02;

      const left = Math.max(0, limit - elapsed / 1000);
      timer.textContent = String(Math.ceil(left));
      tbar.style.width = `${(left / limit) * 100}%`;
      status.textContent = loud ? 'I can hear it.' : loudMs > 0 ? 'Heard something. Keep holding the button.' : (demo ? 'Waiting for the alarm...' : 'Press the test button now.');
      setMood(mas, loud ? 'alert' : 'listening');

      if (loudMs >= 600) return finish(true, 'Alarm heard');
      if (elapsed > limit * 1000) return finish(false, 'No alarm heard');
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function result(i, pass) {
    const mas = mascot(pass ? 'happy' : 'worried', 104);
    const last = i + 1 >= list.length;
    show(
      bars(i, false),
      h('p', { class: 'steps' }, `Detector ${i + 1} of ${list.length}`),
      h('div', { class: 'test-name' }, list[i].name),
      h('div', { class: 'hero' }, mas, h('div', { class: 'bubble' }, pass ? 'Loud and clear. This one works.' : 'I did not hear the alarm. Check the battery, then test again.')),
      h('p', { class: `${pass ? 'pass' : 'fail'} big-number` }, pass ? 'Passed' : 'Not heard'),
      h('div', { class: 'row stack' },
        h('button', { class: pass ? 'btn good' : 'btn solid', onclick: () => step(i + 1) }, last ? 'See summary' : 'Next detector'),
        pass ? null : h('button', { class: 'btn ghost', onclick: () => { results.pop(); step(i); } }, 'Test again')),
    );
    replayEnter();
    if (pass) { react(mas, 'bounce'); buzz(30); } else { react(mas, 'shake'); buzz([60, 60, 60]); }
  }

  function summary() {
    listener?.stop();
    listener = null;
    if (!demo) S.recordTestRun(results);
    const bad = results.filter((r) => !r.pass);
    const n = S.streak();
    const mas = mascot(bad.length ? 'worried' : 'happy', 112);
    const num = h('p', { class: 'big-number' }, '0');
    show(
      bars(-1, false),
      h('h1', null, bad.length ? `${bad.length} need${bad.length === 1 ? 's' : ''} attention` : 'All passed'),
      h('div', { class: 'hero' }, mas, h('div', { class: 'bubble' }, bad.length ? 'Replace the battery in the ones that failed, then test them again.' : 'Every detector sounded off. That is a perfect month.')),
      h('div', { class: 'panel' }, results.map((r, k) => h('div', { class: 'result', style: `--i:${k}` }, h('span', null, r.name), h('span', { class: r.pass ? 'pass' : 'fail' }, r.pass ? 'Passed' : 'Needs attention')))),
      bad.length ? h('div', { class: 'error' }, 'If one still does not sound after a new battery, replace the detector.') : null,
      demo ? h('p', { class: 'hint' }, 'Demo results are not saved to your streak.') : null,
      h('h2', null, 'Streak'),
      num,
      h('p', { class: 'muted' }, n ? `month${n === 1 ? '' : 's'} in a row with every detector passing.` : 'No full passing month yet. Fix the ones above and run the test again.'),
      h('div', { class: 'row split' }, h('a', { class: 'btn solid', href: '#/' }, 'Done'), h('a', { class: 'btn', href: '#/detectors' }, 'Detector list')),
    );
    replayEnter();
    updateStreak();
    setTimeout(() => {
      countUp(num, n);
      if (!bad.length) { react(mas, 'bounce'); confetti(mas); buzz([40, 40, 80]); }
      else react(mas, 'shake');
    }, 250);
  }

  if (demo) begin();
  else intro();
}

// ---------- reminders ----------
function remindersView() {
  const dst = nextDst();
  const rows = [];
  if (dst) rows.push([iso(dst.date), `Clocks ${dst.kind === 'start' ? 'spring forward' : 'fall back'}. Change all batteries.`]);
  const first = new Date();
  first.setDate(1);
  first.setMonth(first.getMonth() + 1);
  rows.push([iso(first), 'Monthly test, then the first of every month.']);
  for (const d of S.detectors()) {
    if (!d.madeDate) continue;
    rows.push([S.replaceBy(d), `Replace ${d.name}. Ten years old.`]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const perm = notificationsSupported() ? Notification.permission : 'unsupported';
  const notifyMsg = h('p', { class: 'hint', 'aria-live': 'polite' },
    perm === 'granted' ? 'On. You will see these when you open the app.' :
    perm === 'denied' ? 'Blocked in your browser settings.' :
    perm === 'unsupported' ? 'Not available in this browser.' : '');

  show(
    h('h1', null, 'Reminders'),
    h('p', { class: 'lead' }, 'Battery changes when the clocks change, a test every month, and a warning before each detector turns ten.'),
    h('h2', null, 'Coming up'),
    h('div', { class: 'panel' }, rows.map(([when, what]) => h('div', { class: 'rem' }, h('strong', null, fmt(when)), what))),
    h('h2', null, 'Get alerts'),
    h('p', null, 'This app has no server, so it cannot wake your phone by itself. Two ways to get alerts anyway:'),
    h('h3', null, 'Calendar (most reliable)'),
    h('p', null, 'Download a file and open it. Your phone\'s own calendar adds every reminder and alerts you even if this app is closed.'),
    h('div', { class: 'row' }, h('button', { class: 'btn solid', onclick: downloadCalendar }, 'Add to my calendar')),
    h('h3', null, 'Notifications when you open the app'),
    h('div', { class: 'row' }, h('button', { class: 'btn', disabled: perm === 'granted' || perm === 'denied' || perm === 'unsupported', onclick: async () => {
      const r = await enableNotifications();
      if (r === 'granted') fireDueNotifications();
      remindersView();
    } }, 'Turn on notifications')),
    notifyMsg,
  );
}

// ---------- demo tools ----------
function toast(message) {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2900);
}

function demoView() {
  const haveDetectors = S.detectors().length > 0;
  show(
    h('h1', null, 'Demo tools'),
    h('div', { class: 'hero' }, mascot('happy', 104), h('div', { class: 'bubble' }, 'Everything here works without a real chirping detector.')),

    h('h2', null, '1. Add sample data'),
    h('div', { class: 'panel' },
      h('p', null, 'Four detectors with different problems (fine, battery due, replace soon, expired) and a three month test streak.'),
      h('div', { class: 'row split' },
        h('button', { class: 'btn solid', onclick: () => { S.loadDemo(); updateStreak(); toast('Sample detectors loaded'); go('#/detectors'); } }, 'Load samples'),
        h('button', { class: 'btn danger', onclick: () => {
          if (confirm('Remove every detector and all test history from this phone?')) { S.clearAll(); updateStreak(); toast('Everything cleared'); demoView(); replayEnter(); }
        } }, 'Clear everything'))),

    h('h2', null, '2. Find a chirp'),
    h('div', { class: 'panel' },
      h('p', null, 'Practice chirps play from your speaker, getting louder like you are walking toward a detector. The microphone hears them for real. Turn the volume up and keep the phone close to the speaker.'),
      h('div', { class: 'row split' },
        h('a', { class: 'btn primary', href: '#/find/practice' }, 'Play practice chirps'),
        h('a', { class: 'btn', href: '#/find/sim' }, 'Simulate a walk'))),

    h('h2', null, '3. Monthly test'),
    h('div', { class: 'panel' },
      h('p', null, 'Runs through your detectors with scripted alarms. The last one stays silent so you can show a failure.'),
      h('div', { class: 'row' }, h('button', { class: 'btn solid', onclick: () => {
        if (!haveDetectors) { S.loadDemo(); updateStreak(); toast('Sample detectors loaded'); }
        go('#/test/demo');
      } }, 'Run demo test'))),

    h('h2', null, '4. Reminders'),
    h('div', { class: 'panel' },
      h('p', null, 'Send yourself a notification to see what a reminder looks like.'),
      h('div', { class: 'row split' },
        h('button', { class: 'btn', onclick: async () => {
          const r = await enableNotifications();
          if (r === 'granted') {
            try { new Notification('Monthly smoke detector test', { body: 'Test each detector now. It takes a minute.' }); } catch {}
            toast('Notification sent');
          } else toast(r === 'unsupported' ? 'Notifications are not available here' : 'Notifications are blocked');
        } }, 'Send test notification'),
        h('a', { class: 'btn', href: '#/reminders' }, 'See reminders'))),

    h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: '#/welcome' }, 'Replay intro')),
  );
}

// ---------- about ----------
function aboutView() {
  show(
    h('h1', null, 'Privacy and terms'),
    h('h2', null, 'What the app does with your data'),
    h('p', null, 'No account. No sign-up. No analytics. Nothing is sent anywhere.'),
    h('p', null, 'The microphone is on only while you are on the Find chirp or Test screens. The app turns sound into one loudness number and discards it. No audio is recorded or saved.'),
    h('p', null, 'Photos of detector labels are read on your phone to find the date. The photo is not saved or uploaded.'),
    h('p', null, 'Your detector list is stored in this browser on this phone. Clearing site data erases it.'),
    h('h2', null, 'Terms of use'),
    h('p', null, 'Chirp Hunter is an aid, not a certified safety device. It can mishear in a noisy room or misread a label. Always check the manufacture date and replacement guidance printed on your detector, and follow the maker\'s instructions.'),
    h('p', null, 'A working smoke alarm is what protects you. Test with the detector\'s own test button, replace detectors that fail or are ten years old, and never leave a detector without a battery.'),
    h('p', null, 'If an alarm sounds and there may be a fire, leave the building and call emergency services. Do not use this app.'),
    h('p', null, 'The software is provided as is, without warranty of any kind.'),
    h('div', { class: 'row split' }, h('a', { class: 'btn', href: '#/' }, 'Back'), h('a', { class: 'btn', href: '#/demo' }, 'Demo tools')),
  );
}

// ---------- boot ----------
// The app always opens on the welcome screen.
// The loading screen is already showing (it is in index.html). Hold it for a
// moment while the hatch animation loads, then fade it out into the welcome.
history.replaceState(null, '', '#/welcome');
const minimum = new Promise((r) => setTimeout(r, 1400));
const ready = Promise.race([preloadHatch(), new Promise((r) => setTimeout(r, 2500))]);
Promise.all([minimum, ready]).then(() => {
  splash?.classList.add('out');
  setTimeout(() => { booted = true; route(); fireDueNotifications(); }, 300);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
