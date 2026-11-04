// Core scanning logic. No dependencies and no Node-only imports, so the same code
// can be tested in a browser: deps (fetchText, fetchJson, sleep) are passed in.

// ---------- date helpers (all in the club's local time zone) ----------

export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute, weekday: wd };
}

export function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(ymd) {
  return new Date(ymd + 'T12:00:00Z').getUTCDay();
}

// Target dates: the next `daysAhead` days (from today) that fall on allowed weekdays.
export function targetDates(todayYmd, daysAhead, weekdays) {
  const out = [];
  for (let i = 0; i <= daysAhead; i++) {
    const d = addDays(todayYmd, i);
    if (weekdays.includes(weekdayOf(d))) out.push(d);
  }
  return out;
}

// "7:04 am" / "12:30 pm " -> "07:04" / "12:30"
export function to24h(text) {
  const m = String(text).trim().toLowerCase().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (!m) return null;
  let h = +m[1];
  if (m[3] === 'pm' && h !== 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function inWindow(slot, cfg) {
  return cfg.window.weekdays.includes(weekdayOf(slot.date)) && slot.time < cfg.window.startBefore;
}

// ---------- MiClub ----------

export function miclubBase(course) {
  return `https://${course.host}/guests/bookings`;
}

export function miclubTimesheetUrl(course, date, feeGroupId) {
  return `${miclubBase(course)}/ViewPublicTimesheet.msp?bookingResourceId=${course.bookingResourceId}` +
    `&selectedDate=${date}&feeGroupId=${feeGroupId}`;
}

export function miclubCalendarUrl(course, date) {
  return `${miclubBase(course)}/ViewPublicCalendar.msp?bookingResourceId=${course.bookingResourceId}` +
    (date ? `&selectedDate=${date}` : '');
}

// ---- tiny HTML helpers (no dependencies; MiClub markup is very regular) ----

const decode = s => String(s)
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3]) : '';
};

const hasClass = (tag, c) => new RegExp(`(^|\\s)${c}(\\s|$)`).test(attr(tag, 'class'));

const firstInner = (html, el) => {
  const m = html.match(new RegExp(`<${el}\\b[^>]*>([\\s\\S]*?)</${el}>`, 'i'));
  return m ? decode(m[1]) : '';
};

// Split html into chunks, each starting at an opening <div> whose class list contains `cls`.
function chunksByClass(html, cls) {
  const re = /<div\b[^>]*>/gi;
  const starts = [];
  let m;
  while ((m = re.exec(html))) if (hasClass(m[0], cls)) starts.push({ i: m.index, tag: m[0] });
  return starts.map((s, n) => ({ tag: s.tag, body: html.slice(s.i, n + 1 < starts.length ? starts[n + 1].i : undefined) }));
}

// Parse a public calendar page -> [{feeGroupId, name, date, available, eighteen}]
export function parseMiclubCalendar(html) {
  const out = [];
  for (const row of chunksByClass(html, 'feeGroupRow')) {
    const name = firstInner(row.body, 'h3');
    const eighteen = hasClass(row.tag, 'eighteenHoles');
    for (const tag of row.body.match(/<div\b[^>]*>/gi) || []) {
      if (!hasClass(tag, 'cell')) continue;
      const m = attr(tag, 'onclick').match(/redirectToTimesheet\('(\d+)'\s*,\s*'(\d{4}-\d{2}-\d{2})'\)/);
      if (!m) continue;
      out.push({ feeGroupId: m[1], date: m[2], name, eighteen, available: !hasClass(tag, 'cell-na') });
    }
  }
  const captcha = /publicCaptchaEnabled\s*=\s*true/.test(html);
  return { feeGroups: out, captcha };
}

// Parse a public timesheet page -> [{time, spots, label, price}]
export function parseMiclubTimesheet(html) {
  const out = [];
  const rows = chunksByClass(html, 'row-time');
  // The last row's chunk would run to the end of the page; trim it at the footer.
  if (rows.length) {
    const last = rows[rows.length - 1];
    const cut = last.body.search(/<footer\b|<\/form>/i);
    if (cut > 0) last.body = last.body.slice(0, cut);
  }
  for (const row of rows) {
    const time = to24h(firstInner(row.body, 'h3'));
    if (!time) continue;
    const tags = row.body.match(/<div\b[^>]*>/gi) || [];
    const spots = tags.filter(t => hasClass(t, 'cell-available')).length;
    const label = firstInner(row.body, 'h4');
    const pm = row.body.match(/class="price"[^>]*>([^<]*)</i);
    const price = pm ? parseFloat(pm[1].replace(/[^0-9.]/g, '')) || null : null;
    out.push({ time, spots, label, price });
  }
  return out;
}

// Fee groups that only ever cover late-afternoon times; skipping them saves requests.
const LATE_FEE_GROUP = /twilight|sundowner|late afternoon|after\s*[3-9](:\d\d)?\s*pm|\b[3-9]:\d\d\s*pm\s*-/i;

export async function scanMiclub(course, cfg, deps, todayYmd) {
  const { fetchText, sleep } = deps;
  const dates = new Set(targetDates(todayYmd, cfg.daysAhead, cfg.window.weekdays));
  const exclude = course.excludeFeeGroups ? new RegExp(course.excludeFeeGroups, 'i') : null;

  // Calendar pages show 6 days each; walk forward until we've covered daysAhead.
  const groups = [];
  for (let offset = 0; offset <= cfg.daysAhead; offset += 6) {
    const html = await fetchText(miclubCalendarUrl(course, addDays(todayYmd, offset)));
    const cal = parseMiclubCalendar(html);
    if (cal.captcha) throw new Error('Club has turned on a captcha for public bookings');
    groups.push(...cal.feeGroups);
    await sleep(cfg.requestDelayMs);
  }

  const wanted = groups.filter(g =>
    g.available && dates.has(g.date) &&
    (course.holes !== 18 || g.eighteen) &&
    !LATE_FEE_GROUP.test(g.name) &&
    !(exclude && exclude.test(g.name)));

  const seen = new Set();
  const byKey = new Map();
  for (const g of wanted) {
    const k = g.date + '|' + g.feeGroupId;
    if (seen.has(k)) continue;
    seen.add(k);
    const url = miclubTimesheetUrl(course, g.date, g.feeGroupId);
    const rows = parseMiclubTimesheet(await fetchText(url));
    await sleep(cfg.requestDelayMs);
    for (const r of rows) {
      if (r.spots < 1) continue;
      const slot = { date: g.date, time: r.time, spots: r.spots, label: r.label || g.name,
        price: r.price, holes: course.holes, url };
      if (!inWindow(slot, cfg)) continue;
      const key = slot.date + '|' + slot.time;
      const prev = byKey.get(key);
      if (!prev || slot.spots > prev.spots) byKey.set(key, slot);
    }
  }
  return [...byKey.values()];
}

// ---------- TeeItUp / GolfNow (Kenna) ----------

export function teeitupBookingUrl(course, date) {
  return `https://${course.alias}.book.teeitup.com/?course=${course.facilityId}&date=${date}`;
}

export function parseTeeitup(json, course, date, tz) {
  const out = [];
  for (const block of (Array.isArray(json) ? json : [])) {
    for (const t of block.teetimes || []) {
      const when = localParts(new Date(t.teetime), tz);
      if (when.ymd !== date) continue;
      const rates = t.rates || [];
      const r18 = rates.filter(r => r.holes === 18);
      const pick = (course.holes === 18 ? r18 : rates);
      if (!pick.length) continue;
      const spots = Number(t.maxPlayers) || 0;
      if (spots < 1) continue;
      const cents = Math.min(...pick.map(r => r.greenFeeWalking ?? r.greenFeeCart ?? Infinity));
      out.push({
        date, time: `${String(when.hour).padStart(2, '0')}:${String(when.minute).padStart(2, '0')}`,
        spots, label: pick[0].name || 'Public', price: isFinite(cents) ? cents / 100 : null,
        holes: course.holes, url: teeitupBookingUrl(course, date)
      });
    }
  }
  return out;
}

export async function scanTeeitup(course, cfg, deps, todayYmd) {
  const { fetchJson, sleep } = deps;
  const out = [];
  for (const date of targetDates(todayYmd, cfg.daysAhead, cfg.window.weekdays)) {
    const url = `https://phx-api-be-east-1b.kenna.io/v2/tee-times?date=${date}&facilityIds=${course.facilityId}`;
    const json = await fetchJson(url, { 'x-be-alias': course.alias });
    out.push(...parseTeeitup(json, course, date, cfg.timezone).filter(s => inWindow(s, cfg)));
    await sleep(cfg.requestDelayMs);
  }
  return out;
}

// ---------- dispatcher ----------

export async function scanCourse(course, cfg, deps, todayYmd) {
  const fn = course.system === 'miclub' ? scanMiclub : course.system === 'teeitup' ? scanTeeitup : null;
  if (!fn) throw new Error('Unknown booking system: ' + course.system);
  const slots = await fn(course, cfg, deps, todayYmd);
  return slots.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

export function courseBookingHome(course) {
  return course.system === 'miclub' ? miclubCalendarUrl(course)
    : `https://${course.alias}.book.teeitup.com/`;
}

// ---------- alert diffing ----------

// prev/curr: { "course|date|time": spots }. Returns keys worth alerting on.
export function newlyAvailable(prev, curr, minSpots) {
  const out = [];
  for (const [k, spots] of Object.entries(curr)) {
    if (spots < minSpots) continue;
    const before = prev[k] ?? 0;
    if (before < minSpots) out.push(k);
  }
  return out;
}

// Should this scheduled run go ahead? (GitHub runs us every 30 min; we thin it out.)
export function shouldRun(now, cfg) {
  const p = localParts(now, cfg.timezone);
  if (cfg.schedule.frequentWeekdays.includes(p.weekday)) return true;
  return p.hour % cfg.schedule.otherEveryHours === 0 && p.minute < 30;
}
