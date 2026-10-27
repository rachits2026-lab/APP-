import './style.css';
import * as S from './store.js';
import { today, fmt, fmtMonth, ageText } from './dates.js';
import { Listener, ChirpDetector, meterValue, micErrorText, buzz } from './audio.js';
import { readLabel } from './ocr.js';
import { dueNow, upcoming, fireDueNotifications, enableNotifications, notificationsSupported, downloadCalendar } from './reminders.js';

const app = document.getElementById('main');
let cleanup = null;

// ---------- tiny DOM helper ----------
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

// ---------- router ----------
const routes = [
  [/^\/$/, homeView],
  [/^\/find$/, findView],
  [/^\/add$/, () => formView(null)],
  [/^\/detectors$/, listView],
  [/^\/detector\/(.+)$/, (m) => (S.getDetector(m[1]) ? formView(S.getDetector(m[1])) : go('#/detectors'))],
  [/^\/test$/, testView],
  [/^\/reminders$/, remindersView],
  [/^\/about$/, aboutView],
];

function route() {
  cleanup?.();
  cleanup = null;
  const path = location.hash.slice(1) || '/';
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) { fn(m); break; }
  }
  document.querySelectorAll('.tabs a').forEach((a) => {
    const on = path.startsWith('/' + a.dataset.tab) || (a.dataset.tab === 'detectors' && /^\/(add|detector)/.test(path));
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);

// ---------- home ----------
function homeView() {
  const list = S.detectors();
  const needs = list.filter((d) => S.statusOf(d).code !== 'ok');
  const due = dueNow();
  const n = S.streak();

  const nodes = [
    h('h1', null, 'Hear a chirp?'),
    h('p', { class: 'lead' }, 'Walk around with your phone. The meter fills as you get closer to the detector that is chirping.'),
    h('a', { class: 'btn primary big block', href: '#/find' }, 'Find chirp'),
  ];

  if (due.length) {
    nodes.push(h('h2', null, 'Do soon'));
    nodes.push(h('div', null, due.map((d) => h('div', { class: 'rem' }, h('strong', null, d.title), d.body, d.go ? h('div', { class: 'row' }, h('a', { class: 'btn solid', href: d.go }, 'Start')) : null))));
  }

  nodes.push(h('h2', null, 'Your detectors'));
  if (!list.length) {
    nodes.push(h('p', null, 'None saved yet. Find the chirping one first, or add a detector by hand.'));
    nodes.push(h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/add' }, 'Add a detector')));
  } else {
    nodes.push(h('p', null, `${list.length} saved. ${needs.length ? `${needs.length} need${needs.length === 1 ? 's' : ''} attention.` : 'All look fine.'}`));
    nodes.push(h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/detectors' }, 'See list'), h('a', { class: 'btn', href: '#/test' }, 'Run test')));
    nodes.push(h('p', { class: 'muted' }, n ? `You have tested every detector ${n} month${n === 1 ? '' : 's'} in a row.` : 'No full test run yet.'));
  }

  nodes.push(footer());
  show(...nodes);
}

function footer() {
  return h('footer', { class: 'foot' }, h('a', { href: '#/about' }, 'Privacy and terms'));
}

// ---------- find chirp ----------
function findView() {
  const wrap = h('div');
  show(h('h1', null, 'Find chirp'), wrap);

  let listener = null;
  let raf = 0;
  let wake = null;
  let alive = true;

  cleanup = () => {
    alive = false;
    cancelAnimationFrame(raf);
    listener?.stop();
    wake?.release?.().catch(() => {});
  };

  const idle = (error) => {
    fill(wrap, [
      h('p', { class: 'lead' }, 'Stand in the middle of the house and tap Start. Keep the phone out in front of you.'),
      h('ol', null,
        h('li', null, 'Wait for a chirp. They come about once a minute.'),
        h('li', null, 'Walk toward the room where the meter reads higher.'),
        h('li', null, 'Stop after a few steps and wait for the next chirp.'),
        h('li', null, 'When the meter is full and the phone vibrates, look up.')),
      error ? h('div', { class: 'error', role: 'alert' }, error) : null,
      h('button', { class: 'btn primary big block', onclick: begin }, 'Start listening'),
      h('p', { class: 'hint' }, 'The microphone is used only on this screen. Nothing is recorded.'),
    ]);
  };

  async function begin() {
    listener = new Listener();
    try {
      await listener.start();
    } catch (e) {
      listener = null;
      idle(micErrorText(e));
      return;
    }
    try { wake = await navigator.wakeLock?.request('screen'); } catch {}
    run();
  }

  function run() {
    const segs = Array.from({ length: 20 }, () => h('i'));
    const num = h('div', { class: 'meter-num' }, '0');
    const word = h('div', { class: 'meter-word' }, 'Waiting for a chirp');
    const live = h('b');
    const hist = h('div', { class: 'history', 'aria-hidden': 'true' });
    const trend = h('p', { class: 'lead', 'aria-live': 'polite' }, 'Listening. Chirps come about once a minute.');
    const found = h('div');
    const meter = h('div', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-label': 'Chirp loudness' }, segs);

    wrap.replaceChildren(
      h('div', { class: 'meter-wrap' },
        h('div', { class: 'meter-read' }, num, word),
        meter,
        h('div', { class: 'live' }, h('span', null, 'Room'), h('span', { class: 'bar' }, live))),
      trend,
      found,
      h('h3', null, 'Recent chirps'),
      hist,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { cleanup(); go('#/'); } }, 'Stop')),
    );

    const det = new ChirpDetector();
    const chirps = [];
    let held = 0;
    let heldAt = 0;
    let shown = -1;
    let lastT = performance.now();

    const paint = (v) => {
      const r = Math.round(v);
      if (r === shown) return;
      shown = r;
      const lit = Math.round((v / 100) * segs.length);
      segs.forEach((s, i) => { s.className = i < lit ? (i >= 15 ? 'hot' : 'on') : ''; });
      num.textContent = String(r);
      meter.setAttribute('aria-valuenow', r);
      word.textContent = r >= 88 ? 'Right here' : r >= 65 ? 'Very close' : r >= 35 ? 'Getting close' : r > 0 ? 'Faint' : 'Waiting for a chirp';
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
        if (prev == null) trend.textContent = 'Heard a chirp. Take a few steps, then wait for the next one.';
        else if (v - prev > 6) trend.textContent = 'Louder than last time. You are getting closer.';
        else if (prev - v > 6) trend.textContent = 'Quieter than last time. Turn around.';
        else trend.textContent = 'About the same as last time. Try another direction.';
        hist.replaceChildren(...chirps.slice(-12).map((c) => h('span', { style: `height:${Math.max(4, c)}%` })));
        if (v >= 88) {
          buzz([250, 120, 250, 120, 400]);
          trend.textContent = 'This is very likely the one. Look up at the ceiling and walls here.';
          found.replaceChildren(h('div', { class: 'panel alarm' },
            h('h3', null, 'Found it?'),
            h('p', null, 'Save it now so you can track its battery and age.'),
            h('div', { class: 'row' },
              h('a', { class: 'btn primary', href: '#/add', onclick: () => cleanup() }, 'Save this detector'),
              h('button', { class: 'btn', onclick: () => found.replaceChildren() }, 'Keep looking'))));
        }
      }

      // Hold the last chirp's reading, then let it fall so walking away shows.
      if (held > 0 && now - heldAt > 8000) held = Math.max(0, held - 2.5 * dt);
      paint(held);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  idle();
}

// ---------- detector list ----------
function listView() {
  const list = S.detectors();
  const nodes = [h('h1', null, 'Detectors')];
  if (!list.length) {
    nodes.push(h('p', { class: 'lead' }, 'Nothing saved yet.'));
  } else {
    nodes.push(h('ul', { class: 'list' }, list.map(card)));
  }
  nodes.push(h('div', { class: 'row' }, h('a', { class: 'btn solid', href: '#/add' }, 'Add a detector')));
  show(...nodes);
}

function card(d) {
  const s = S.statusOf(d);
  const rep = S.replaceBy(d);
  return h('li', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, d.name), badge(s)),
    s.detail ? h('p', { class: 'muted small' }, s.detail) : null,
    h('dl', null,
      h('dt', null, 'Battery changed'), h('dd', null, fmt(d.batteryDate)),
      h('dt', null, 'Made'), h('dd', null, d.madeDate ? `${fmtMonth(d.madeDate)} (${ageText(d.madeDate)} old)` : 'Unknown'),
      h('dt', null, 'Replace by'), h('dd', null, rep ? fmtMonth(rep) : 'Unknown')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { S.updateDetector(d.id, { batteryDate: today() }); listView(); } }, 'Changed battery today'),
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

  const photo = h('input', {
    type: 'file', id: 'photo', accept: 'image/*', capture: 'environment',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const bar = h('b');
      ocrOut.replaceChildren(h('div', { class: 'loading' }, h('span', null, 'Reading label'), h('span', { class: 'bar' }, bar)));
      try {
        const { found } = await readLabel(file, (m) => {
          if (m.status === 'recognizing text') bar.style.width = `${Math.round(m.progress * 100)}%`;
        });
        if (found) {
          made.value = found.date;
          ocrOut.replaceChildren(h('p', { class: 'hint' }, `Read ${found.exact ? fmt(found.date) : fmtMonth(found.date) + ' (month or year only)'} from the label. Check that it matches.`));
        } else {
          ocrOut.replaceChildren(h('p', { class: 'hint' }, 'Could not find a date. Try a closer, brighter photo, or type it in from the label.'));
        }
      } catch {
        ocrOut.replaceChildren(h('p', { class: 'hint' }, 'The label reader could not run here. Type the date from the label.'));
      }
    },
  });

  const save = () => {
    const nm = name.value.trim();
    if (!nm) {
      err.replaceChildren(h('div', { class: 'error' }, 'Give the detector a location name.'));
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
    h('div', { class: 'chips' }, PLACES.map((p) => h('button', { type: 'button', class: 'chip', onclick: () => { name.value = p; } }, p))),
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
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
      h('a', { class: 'btn', href: '#/detectors' }, 'Cancel')),
    editing ? h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: () => {
      if (confirm(`Remove ${existing.name}?`)) { S.removeDetector(existing.id); go('#/detectors'); }
    } }, 'Remove detector')) : null,
  );
}

// ---------- monthly test ----------
function testView() {
  const list = S.detectors();
  if (!list.length) {
    show(h('h1', null, 'Test'), h('p', { class: 'lead' }, 'Save a detector first, then come back to test it.'),
      h('div', { class: 'row' }, h('a', { class: 'btn solid', href: '#/add' }, 'Add a detector')));
    return;
  }

  const results = [];
  let listener = null;
  let raf = 0;
  let alive = true;
  cleanup = () => { alive = false; cancelAnimationFrame(raf); listener?.stop(); };

  const intro = (error) => show(
    h('h1', null, 'Test'),
    h('p', { class: 'lead' }, `${list.length} detector${list.length === 1 ? '' : 's'} to test. For each one, hold the phone near it and press its test button.`),
    h('p', null, 'Test alarms are loud. Keep the phone about an arm\'s length away.'),
    error ? h('div', { class: 'error', role: 'alert' }, error) : null,
    h('button', { class: 'btn primary big block', onclick: begin }, 'Start test'),
  );

  async function begin() {
    listener = new Listener();
    try { await listener.start(); } catch (e) { listener = null; intro(micErrorText(e)); return; }
    step(0);
  }

  function step(i) {
    if (i >= list.length) return summary();
    const d = list[i];
    const timer = h('div', { class: 'timer' }, '20');
    const status = h('p', { class: 'lead', 'aria-live': 'polite' }, 'Press the test button now.');
    show(
      h('p', { class: 'steps' }, `Detector ${i + 1} of ${list.length}`),
      h('div', { class: 'test-name' }, d.name),
      h('p', null, 'Hold the phone near it and press and hold its test button.'),
      timer, status,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => finish(false, 'Skipped') }, 'It did not sound')),
    );

    const t0 = performance.now();
    let last = t0;
    let loudMs = 0;
    let peakOver = 0;
    let floor = null;
    const warm = [];
    let done = false;

    const finish = (pass, note) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      results.push({ id: d.id, name: d.name, pass, note });
      result(i, pass, note);
    };

    const tick = (now) => {
      if (!alive || done) return;
      const dt = now - last;
      last = now;
      const r = listener.read();
      const elapsed = now - t0;

      // Skip silent frames (-Infinity); they would poison the floor.
      if (!Number.isFinite(r.level) || !Number.isFinite(r.tonal)) {
        if (elapsed > 20000) return finish(false, 'No alarm heard');
        raf = requestAnimationFrame(tick);
        return;
      }
      if (elapsed < 500) {
        warm.push(r.level);
        raf = requestAnimationFrame(tick);
        return;
      }
      if (floor === null) {
        warm.sort((a, b) => a - b);
        floor = warm.length ? warm[warm.length >> 1] : r.level;
      }
      const over = r.level - floor;
      const loud = over > 20 && r.tonal > 14;
      if (loud) { loudMs += dt; peakOver = Math.max(peakOver, over); }
      else floor += (r.level - floor) * 0.02;

      timer.textContent = String(Math.max(0, Math.ceil(20 - elapsed / 1000)));
      status.textContent = loud ? 'Hearing the alarm.' : loudMs > 0 ? 'Heard something. Keep holding the button.' : 'Press the test button now.';

      if (loudMs >= 600) return finish(true, 'Alarm heard');
      if (elapsed > 20000) return finish(false, 'No alarm heard');
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function result(i, pass, note) {
    const next = () => step(i + 1);
    show(
      h('p', { class: 'steps' }, `Detector ${i + 1} of ${list.length}`),
      h('div', { class: 'test-name' }, list[i].name),
      pass
        ? h('p', { class: 'pass big-number' }, 'Passed')
        : h('div', null,
          h('p', { class: 'fail big-number' }, 'Not heard'),
          h('div', { class: 'error' }, 'The app did not hear the alarm. Check the battery, then test again. If it still fails, replace the detector.')),
      h('div', { class: 'row' },
        pass ? null : h('button', { class: 'btn', onclick: () => { results.pop(); step(i); } }, 'Test again'),
        h('button', { class: 'btn solid', onclick: next }, i + 1 < list.length ? 'Next detector' : 'See summary')),
    );
  }

  function summary() {
    listener?.stop();
    listener = null;
    S.recordTestRun(results);
    const bad = results.filter((r) => !r.pass);
    const n = S.streak();
    show(
      h('h1', null, bad.length ? `${bad.length} need${bad.length === 1 ? 's' : ''} attention` : 'All passed'),
      h('div', null, results.map((r) => h('div', { class: 'result' }, h('span', null, r.name), h('span', { class: r.pass ? 'pass' : 'fail' }, r.pass ? 'Passed' : 'Needs attention')))),
      bad.length ? h('div', { class: 'error' }, 'For each one that failed: replace the battery and test again. If it still does not sound, replace the detector.') : null,
      h('h2', null, 'Streak'),
      h('p', { class: 'big-number' }, String(n)),
      h('p', { class: 'muted' }, n ? `month${n === 1 ? '' : 's'} in a row with every detector passing.` : 'No full passing month yet. Fix the ones above and run the test again.'),
      h('div', { class: 'row' }, h('a', { class: 'btn solid', href: '#/' }, 'Done'), h('a', { class: 'btn', href: '#/detectors' }, 'Detector list')),
    );
  }

  intro();
}

// ---------- reminders ----------
function remindersView() {
  const rows = upcoming();
  const perm = notificationsSupported() ? Notification.permission : 'unsupported';
  const notifyMsg = h('p', { class: 'hint', 'aria-live': 'polite' },
    perm === 'granted' ? 'On. You will see these when you open the app.' :
    perm === 'denied' ? 'Blocked in your browser settings.' :
    perm === 'unsupported' ? 'Not available in this browser.' : '');

  show(
    h('h1', null, 'Reminders'),
    h('p', { class: 'lead' }, 'Battery changes when the clocks change, a test every month, and a warning before each detector turns ten.'),
    h('h2', null, 'Coming up'),
    h('div', null, rows.map((r) => h('div', { class: 'rem' }, h('strong', { class: r.overdue ? 'fail' : null }, fmt(r.date)), r.text))),
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
    h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/' }, 'Back')),
  );
}

// ---------- boot ----------
route();
fireDueNotifications();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
