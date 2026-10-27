export const LIFESPAN_YEARS = 10;
const DAY = 86400000;

export function today() {
  return iso(new Date());
}

export function iso(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parse(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addYears(s, n) {
  const d = parse(s);
  d.setFullYear(d.getFullYear() + n);
  return iso(d);
}

export function daysBetween(a, b) {
  return Math.round((parse(b) - parse(a)) / DAY);
}

export function fmt(s) {
  const d = parse(s);
  if (!d) return 'Unknown';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtMonth(s) {
  const d = parse(s);
  if (!d) return 'Unknown';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function ageText(s) {
  const days = daysBetween(s, today());
  if (days < 0) return 'Not yet made';
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  return `${(days / 365.25).toFixed(1)} years`;
}

// n-th (1-based) given weekday (0=Sun) of a month.
export function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

// US rules: starts 2nd Sunday of March, ends 1st Sunday of November.
export function dstChanges(year) {
  return [
    { date: nthWeekday(year, 2, 0, 2), kind: 'start' },
    { date: nthWeekday(year, 10, 0, 1), kind: 'end' },
  ];
}

export function nextDst(from = new Date()) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (const y of [from.getFullYear(), from.getFullYear() + 1]) {
    for (const c of dstChanges(y)) if (c.date >= start) return c;
  }
}

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function prevMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 2, 1));
}
