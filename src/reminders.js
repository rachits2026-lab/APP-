import { detectors, replaceBy, getState, markNotified, testedThisMonth, statusOf } from './store.js';
import { today, parse, iso, daysBetween, dstChanges, nextDst, fmt } from './dates.js';

// Everything the app wants you to do soon, computed from the saved list.
export function dueNow() {
  const out = [];
  const now = today();

  const dst = nextDst();
  if (dst) {
    const days = daysBetween(now, iso(dst.date));
    if (days <= 7) {
      out.push({
        key: `dst-${iso(dst.date)}`,
        title: 'Change your detector batteries',
        body: days === 0
          ? 'Clocks change today. Swap the batteries in every smoke detector.'
          : `Clocks change ${fmt(iso(dst.date))}. Plan to swap the batteries in every smoke detector.`,
      });
    }
  }

  if (detectors().length && !testedThisMonth()) {
    out.push({
      key: `test-${now.slice(0, 7)}`,
      title: 'Monthly smoke detector test',
      body: 'Test each detector now. It takes a minute.',
      go: '#/test',
    });
  }

  for (const d of detectors()) {
    const s = statusOf(d);
    if (s.code === 'replace') {
      out.push({
        key: `expired-${d.id}`,
        title: `Replace: ${d.name}`,
        body: `This detector was made ${fmt(d.madeDate)} and is past its ten year life.`,
      });
    } else if (s.code === 'soon') {
      out.push({
        key: `soon-${d.id}`,
        title: `Replacement coming: ${d.name}`,
        body: `This detector reaches ten years on ${fmt(replaceBy(d))}.`,
      });
    }
  }
  return out;
}

// The "Coming up" list, oldest first. Sorted on ISO dates, since sorting the
// formatted text puts "Jan 2027" before "Nov 2026".
export function upcoming() {
  const now = today();
  const rows = [];
  const dst = nextDst();
  if (dst) rows.push({ date: iso(dst.date), text: `Clocks ${dst.kind === 'start' ? 'spring forward' : 'fall back'}. Change all batteries.` });
  const first = new Date();
  first.setDate(1);
  first.setMonth(first.getMonth() + 1);
  rows.push({ date: iso(first), text: 'Monthly test, then the first of every month.' });
  for (const d of detectors()) {
    if (!d.madeDate) continue;
    const date = replaceBy(d);
    const overdue = date < now;
    rows.push({ date, overdue, text: overdue ? `Overdue: replace ${d.name}. It is past ten years old.` : `Replace ${d.name}. Ten years old.` });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function notificationsSupported() {
  return 'Notification' in window;
}

export async function enableNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  const res = await Notification.requestPermission();
  return res;
}

// Android Chrome throws on `new Notification()`; it only allows notifications
// shown through the service worker. Use that whenever one is registered.
async function show(title, options) {
  const reg = await navigator.serviceWorker?.getRegistration?.();
  if (reg) await reg.showNotification(title, options);
  else new Notification(title, options);
}

// Notifications can only be shown while the app has been opened, because the
// app has no server to wake it up. The calendar file covers the rest.
export async function fireDueNotifications() {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const seen = getState().settings.lastNotified;
  for (const item of dueNow()) {
    if (seen[item.key]) continue;
    try {
      await show(item.title, { body: item.body, tag: item.key, icon: '/icon-192.png', data: { go: item.go || '#/' } });
      markNotified(item.key);
    } catch {}
  }
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const esc = (s) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

function event(uid, date, summary, desc, rrule) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@chirphunter.local`,
    `DTSTAMP:${stamp(new Date())}T000000Z`,
    `DTSTART;VALUE=DATE:${stamp(date)}`,
    `DTEND;VALUE=DATE:${stamp(next)}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(desc)}`,
    ...(rrule ? [`RRULE:${rrule}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(summary)}`,
    'TRIGGER:PT9H',
    'END:VALARM',
    'END:VEVENT',
  ].join('\r\n');
}

// A calendar file your phone's own calendar app will alert from, with no
// connection to this app needed.
export function buildCalendar() {
  const events = [];
  const y = new Date().getFullYear();
  for (let year = y; year <= y + 3; year++) {
    for (const c of dstChanges(year)) {
      if (c.date < new Date()) continue;
      events.push(event(
        `dst-${stamp(c.date)}`, c.date,
        'Change smoke detector batteries',
        'Clocks change today. Swap the batteries in every smoke detector.',
      ));
    }
  }
  const first = new Date();
  first.setDate(1);
  first.setMonth(first.getMonth() + 1);
  events.push(event('monthly-test', first, 'Test smoke detectors', 'Open Chirp Hunter and run the monthly test.', 'FREQ=MONTHLY;BYMONTHDAY=1'));

  for (const d of detectors()) {
    if (!d.madeDate) continue;
    const end = parse(replaceBy(d));
    const warn = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate());
    if (warn >= new Date()) {
      events.push(event(`warn-${d.id}`, warn, `Smoke detector expires in a year: ${d.name}`, 'Buy a replacement soon.'));
    }
    if (end >= new Date()) {
      events.push(event(`expire-${d.id}`, end, `Replace smoke detector: ${d.name}`, 'This detector has reached ten years old.'));
    }
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chirp Hunter//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
}

export function downloadCalendar() {
  const blob = new Blob([buildCalendar()], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'chirp-hunter-reminders.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
