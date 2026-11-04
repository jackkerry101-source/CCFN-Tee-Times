import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMiclubCalendar, parseMiclubTimesheet, parseTeeitup, to24h, targetDates,
  inWindow, newlyAvailable, shouldRun, scanMiclub
} from '../src/core.mjs';

const cfg = {
  timezone: 'Australia/Sydney', daysAhead: 14, requestDelayMs: 0,
  window: { weekdays: [6, 0], startBefore: '15:00' },
  schedule: { frequentWeekdays: [1, 2, 3, 5], otherEveryHours: 3 }
};

// Mirrors the structure seen on the live MiClub calendar page.
const CAL = `
<script>var publicCaptchaEnabled = false;</script>
<div class="row-wrapper"> <div class="row feeGroupRow feeGroupId-132857 eighteenHoles" data-feeid="132857">
 <div class="col-lg-3 row-heading"> <h3>18 Holes - Public</h3> </div> <div class="items-wrapper">
 <div class="col-lg-1 cell" data-date="0" onclick="javascript:redirectToTimesheet('132857','2026-11-06');" data-feeid="132857"><p class="price">$53.00</p></div>
 <div class="col-lg-1 hidden-phone cell" data-date="1" onclick="javascript:redirectToTimesheet('132857','2026-11-07');"><p class="price">$69.00</p></div>
 <div class="col-lg-1 cell cell-na" data-date="2" onclick="javascript:redirectToTimesheet('132857','2026-11-08');"><p>Not Available</p></div>
 </div></div></div>
<div class="row-wrapper"> <div class="row feeGroupRow feeGroupId-100805 nineHole">
 <div class="row-heading"><h3>9 Holes - Public</h3></div>
 <div class="col-lg-1 cell" onclick="javascript:redirectToTimesheet('100805','2026-11-07');"><p class="price">$43.00</p></div>
</div></div>`;

const TS = `
<div id="row-1" class="row row-time pm_row" data-value="1">
 <div class="col-lg-8 row-heading"><span class="rowBookTooltip">Click to select row.</span><div class="row">
  <div class="col-lg-6 row-heading-inner time-wrapper"> <h3>7:04 am </h3> <h4>Social Play</h4> <h5></h5> </div>
  <div class="col-lg-6 row-heading-inner fees-wrapper"><ul><li><span class="price"> $69.00 </span> Adult (Weekend)</li></ul></div>
 </div></div>
 <div class="records-wrapper">
  <div id="1_0" class="col-lg-1 cell cell-taken"><p class="small">Taken</p></div>
  <div id="1_1" class="col-lg-1 cell cell-available"><p class="small">Available</p></div>
  <div id="1_2" class="col-lg-1 cell cell-available"><p class="small">Available</p></div>
  <div id="1_3" class="col-lg-1 cell cell-available"><p class="small">Available</p></div>
 </div></div>
<div id="row-2" class="row row-time pm_row" data-value="2">
 <div class="time-wrapper"><h3>2:56 pm</h3><h4>Social &amp; Visitors</h4></div>
 <div class="fees-wrapper"><span class="price">$69.00</span></div>
 <div class="records-wrapper"><div class="cell cell-available"></div></div></div>
<div id="row-3" class="row row-time pm_row" data-value="3">
 <div class="time-wrapper"><h3>3:04 pm</h3><h4>Social</h4></div>
 <div class="records-wrapper"><div class="cell cell-available"></div><div class="cell cell-available"></div></div></div>
<footer><div class="cell cell-available"></div></footer>`;

test('to24h', () => {
  assert.equal(to24h('7:04 am '), '07:04');
  assert.equal(to24h('12:30 pm'), '12:30');
  assert.equal(to24h('12:10 am'), '00:10');
  assert.equal(to24h('02:40 pm'), '14:40');
});

test('calendar parsing', () => {
  const { feeGroups, captcha } = parseMiclubCalendar(CAL);
  assert.equal(captcha, false);
  assert.equal(feeGroups.length, 4);
  assert.deepEqual(feeGroups[1], { feeGroupId: '132857', date: '2026-11-07', name: '18 Holes - Public', eighteen: true, available: true });
  assert.equal(feeGroups[2].available, false);
  assert.equal(feeGroups[3].eighteen, false);
  assert.equal(parseMiclubCalendar('<script>publicCaptchaEnabled = true;</script>').captcha, true);
});

test('timesheet parsing (footer cells ignored)', () => {
  const rows = parseMiclubTimesheet(TS);
  assert.deepEqual(rows, [
    { time: '07:04', spots: 3, label: 'Social Play', price: 69 },
    { time: '14:56', spots: 1, label: 'Social & Visitors', price: 69 },
    { time: '15:04', spots: 2, label: 'Social', price: null }
  ]);
});

test('target dates are weekends only', () => {
  assert.deepEqual(targetDates('2026-11-04', 14, [6, 0]),
    ['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15']);
});

test('window: weekend before 3pm', () => {
  assert.equal(inWindow({ date: '2026-11-07', time: '14:59' }, cfg), true);
  assert.equal(inWindow({ date: '2026-11-07', time: '15:00' }, cfg), false);
  assert.equal(inWindow({ date: '2026-11-06', time: '08:00' }, cfg), false);
});

test('scanMiclub end to end with fake fetch', async () => {
  const course = { id: 'x', host: 'example.com', bookingResourceId: '3000000', holes: 18 };
  const urls = [];
  const deps = {
    sleep: async () => {},
    fetchText: async url => { urls.push(url); return url.includes('Calendar') ? CAL : TS; }
  };
  const slots = await scanMiclub(course, cfg, deps, '2026-11-04');
  // 9-hole group excluded for an 18-hole course; 3:04pm excluded by window; Sun 8th unavailable.
  assert.deepEqual(slots.map(s => [s.date, s.time, s.spots]), [['2026-11-07', '07:04', 3], ['2026-11-07', '14:56', 1]]);
  assert.ok(urls.some(u => u.includes('feeGroupId=132857') && u.includes('2026-11-07')));
  assert.ok(!urls.some(u => u.includes('feeGroupId=100805')));
});

test('teeitup parsing converts UTC to Sydney time', () => {
  const json = [{ teetimes: [
    { teetime: '2026-11-07T00:30:00.000Z', maxPlayers: 2, rates: [{ name: '18 Holes', holes: 18, greenFeeWalking: 4500 }] },
    { teetime: '2026-11-07T05:00:00.000Z', maxPlayers: 4, rates: [{ name: '9 Holes', holes: 9, greenFeeWalking: 3000 }] }
  ] }];
  const out = parseTeeitup(json, { alias: 'a', facilityId: '1', holes: 18 }, '2026-11-07', 'Australia/Sydney');
  assert.equal(out.length, 1);
  assert.equal(out[0].time, '11:30');
  assert.equal(out[0].spots, 2);
  assert.equal(out[0].price, 45);
});

test('alerts only for newly matching times', () => {
  const prev = { 'a|d|07:00': 4, 'a|d|08:00': 1 };
  const curr = { 'a|d|07:00': 4, 'a|d|08:00': 3, 'a|d|09:00': 2, 'a|d|10:00': 1 };
  assert.deepEqual(newlyAvailable(prev, curr, 2), ['a|d|08:00', 'a|d|09:00']);
});

test('schedule gate (Sydney time)', () => {
  // Wed 4 Nov 2026 16:07 AEDT = 05:07Z → frequent day
  assert.equal(shouldRun(new Date('2026-11-04T05:07:00Z'), cfg), true);
  // Thu 5 Nov 12:07 AEDT (01:07Z) → 12 % 3 == 0 → run
  assert.equal(shouldRun(new Date('2026-11-05T01:07:00Z'), cfg), true);
  // Thu 5 Nov 12:37 AEDT → skip (second half-hour)
  assert.equal(shouldRun(new Date('2026-11-05T01:37:00Z'), cfg), false);
  // Sat 7 Nov 13:07 AEDT → skip
  assert.equal(shouldRun(new Date('2026-11-07T02:07:00Z'), cfg), false);
});
