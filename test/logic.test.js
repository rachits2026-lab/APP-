import test from 'node:test';
import assert from 'node:assert/strict';
import { findDate } from '../src/ocr.js';
import { addYears, daysBetween, nthWeekday, dstChanges, iso, prevMonthKey } from '../src/dates.js';
import { ChirpDetector, meterValue } from '../src/audio.js';

test('label dates in common formats', () => {
  assert.deepEqual(findDate('MODEL 9120B MANUFACTURED 2014-03-21 MADE IN USA'), { date: '2014-03-21', exact: true });
  assert.deepEqual(findDate('Date of manufacture: 21 MAR 2012'), { date: '2012-03-21', exact: true });
  assert.deepEqual(findDate('MFD 03/2016'), { date: '2016-03-01', exact: false });
  assert.deepEqual(findDate('MFG 2009'), { date: '2009-01-01', exact: false });
  assert.deepEqual(findDate('Made 12/31/2015'), { date: '2015-12-31', exact: true });
  assert.equal(findDate('no dates here, model 1234'), null);
});

test('replacement date is ten years out', () => {
  assert.equal(addYears('2014-03-21', 10), '2024-03-21');
  assert.equal(daysBetween('2024-01-01', '2024-01-31'), 30);
});

test('daylight saving dates', () => {
  assert.equal(iso(nthWeekday(2026, 2, 0, 2)), '2026-03-08');
  const [start, end] = dstChanges(2026);
  assert.equal(iso(start.date), '2026-03-08');
  assert.equal(iso(end.date), '2026-11-01');
});

test('month key rolls back across years', () => {
  assert.equal(prevMonthKey('2026-01'), '2025-12');
});

test('chirp detector finds a short loud tone and ignores steady noise', () => {
  const d = new ChirpDetector();
  let t = 0;
  const quiet = { level: -80, tonal: 3 };
  const loud = { level: -25, tonal: 30 };
  for (let i = 0; i < 30; i++, t += 16) d.push(quiet, t);
  let ev = null;
  for (let i = 0; i < 10; i++, t += 16) d.push(loud, t);
  for (let i = 0; i < 20; i++, t += 16) ev = d.push(quiet, t) || ev;
  assert.ok(ev, 'chirp detected');
  assert.ok(meterValue(ev.peak, ev.floor) > 90);

  const steady = new ChirpDetector();
  let sev = null;
  t = 0;
  for (let i = 0; i < 30; i++, t += 16) steady.push(quiet, t);
  for (let i = 0; i < 100; i++, t += 16) sev = steady.push(loud, t) || sev;
  for (let i = 0; i < 20; i++, t += 16) sev = steady.push(quiet, t) || sev;
  assert.equal(sev, null, 'long steady sound is not a chirp');
});
