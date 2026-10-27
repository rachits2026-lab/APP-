import { today, addYears, daysBetween, LIFESPAN_YEARS, monthKey, prevMonthKey } from './dates.js';

const KEY = 'chirphunter.v1';
const empty = () => ({ detectors: [], tests: {}, settings: { notify: false, lastNotified: {} } });

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch {}
  return empty();
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

function save() {
  persist();
  listeners.forEach((fn) => fn());
}

export const onChange = (fn) => listeners.add(fn);
export const getState = () => state;
export const detectors = () => state.detectors;
export const getDetector = (id) => state.detectors.find((d) => d.id === id);

export function addDetector(d) {
  const det = { id: crypto.randomUUID(), name: '', batteryDate: today(), madeDate: '', createdAt: today(), ...d };
  state.detectors.push(det);
  save();
  return det;
}

export function updateDetector(id, patch) {
  Object.assign(getDetector(id), patch);
  save();
}

export function removeDetector(id) {
  state.detectors = state.detectors.filter((d) => d.id !== id);
  save();
}

export function setSetting(k, v) {
  state.settings[k] = v;
  save();
}

export function markNotified(key) {
  state.settings.lastNotified[key] = today();
  persist();
}

export function replaceBy(d) {
  return d.madeDate ? addYears(d.madeDate, LIFESPAN_YEARS) : '';
}

export const BATTERY_DUE_DAYS = 365;
export const REPLACE_WARN_DAYS = 365;

// code: ok | battery | soon | replace | unknown
export function statusOf(d) {
  const now = today();
  if (d.madeDate) {
    const left = daysBetween(now, replaceBy(d));
    if (left < 0) return { code: 'replace', label: 'Replace detector', detail: `Expired ${-left} days ago` };
    if (left <= REPLACE_WARN_DAYS) return { code: 'soon', label: 'Replace within a year', detail: `${left} days left` };
  }
  const since = daysBetween(d.batteryDate, now);
  if (since >= BATTERY_DUE_DAYS) return { code: 'battery', label: 'Battery due soon', detail: `Changed ${since} days ago` };
  if (!d.madeDate) return { code: 'unknown', label: 'Add made date', detail: 'Age unknown' };
  return { code: 'ok', label: 'OK', detail: '' };
}

export function recordTestRun(results) {
  const key = monthKey();
  const allPassed = results.length > 0 && results.every((r) => r.pass);
  const prev = state.tests[key];
  // A passing run is never downgraded by a later partial one in the same month.
  state.tests[key] = { allPassed: allPassed || !!(prev && prev.allPassed), at: today(), results };
  save();
}

export function streak() {
  let key = monthKey();
  if (!state.tests[key]?.allPassed) key = prevMonthKey(key);
  let n = 0;
  while (state.tests[key]?.allPassed) {
    n++;
    key = prevMonthKey(key);
  }
  return n;
}

export function testedThisMonth() {
  return !!state.tests[monthKey()];
}
