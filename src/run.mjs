// Entry point for each scheduled check.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { scanCourse, localParts, newlyAvailable, courseBookingHome, weekdayOf } from './core.mjs';
import { sendAlerts, logTelegramChatIds } from './notify.mjs';

const ROOT = new URL('..', import.meta.url);
const path = p => new URL(p, ROOT);
const UA = 'Mozilla/5.0 (compatible; TeeTimeTracker/1.0; personal, low-frequency checks)';

const readJson = async (p, fallback) => {
  try { return JSON.parse(await readFile(path(p), 'utf8')); } catch { return fallback; }
};

async function fetchWithRetry(url, headers = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      last = e;
      await new Promise(res => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw last;
}

const deps = {
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  fetchText: async url => (await fetchWithRetry(url)).text(),
  fetchJson: async (url, headers) => (await fetchWithRetry(url, headers)).json()
};

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function main() {
  const cfg = await readJson('config.json');
  const now = new Date();
  const today = localParts(now, cfg.timezone).ymd;
  const prevData = await readJson('docs/data.json', { courses: [] });
  const prevState = await readJson('state/seen.json', null);

  const courses = [];
  for (const course of cfg.courses) {
    const base = { id: course.id, name: course.name, tier: course.tier, holes: course.holes,
      bookingUrl: courseBookingHome(course) };
    try {
      const slots = await scanCourse(course, cfg, deps, today);
      courses.push({ ...base, ok: true, checkedAt: now.toISOString(), slots });
      console.log(`✓ ${course.name}: ${slots.length} slot(s) in window`);
    } catch (e) {
      // Keep the last good results so a temporary outage doesn't blank the board.
      const old = prevData.courses.find(c => c.id === course.id);
      const why = String(e.message || e) + (e.cause ? ` (${e.cause.code || e.cause.message})` : '');
      courses.push({ ...base, ok: false, error: why,
        checkedAt: old?.checkedAt || null,
        slots: (old?.slots || []).filter(s => s.date >= today) });
      console.log(`✗ ${course.name}: ${why}`);
    }
  }

  await mkdir(path('docs/'), { recursive: true });
  await mkdir(path('state/'), { recursive: true });
  await writeFile(path('docs/data.json'), JSON.stringify({
    generatedAt: now.toISOString(),
    window: cfg.window, alertMinSpots: cfg.alertMinSpots, courses
  }, null, 1));

  // ----- alerts -----
  const curr = {};
  for (const c of courses) for (const s of c.slots) curr[`${c.id}|${s.date}|${s.time}`] = s.spots;
  // A course that failed this run keeps its previous entries so it doesn't re-alert on recovery.
  if (prevState) for (const c of courses.filter(c => !c.ok))
    for (const [k, v] of Object.entries(prevState.seen || {})) if (k.startsWith(c.id + '|')) curr[k] = v;

  // Never set the alert baseline from a run where every course failed.
  if (!courses.some(c => c.ok)) { console.log('All courses failed; alert state left unchanged.'); return; }
  await writeFile(path('state/seen.json'), JSON.stringify({ updatedAt: now.toISOString(), seen: curr }, null, 1));

  if (!prevState) {
    const total = Object.values(curr).filter(v => v >= cfg.alertMinSpots).length;
    await sendAlerts(`⛳ Tee time tracker is live. ${total} matching time(s) right now. ` +
      `You'll get a message here when new ones open up.`, pagesUrl());
    return;
  }

  const fresh = newlyAvailable(prevState.seen || {}, curr, cfg.alertMinSpots);
  if (!fresh.length) { console.log('No new times to alert on.'); return; }

  const order = new Map(cfg.courses.map((c, i) => [c.id, i]));
  const byCourse = new Map(courses.map(c => [c.id, c]));
  const items = fresh
    .map(k => { const [id, date, time] = k.split('|'); return { c: byCourse.get(id), date, time, spots: curr[k] }; })
    .sort((a, b) => a.c.tier - b.c.tier || order.get(a.c.id) - order.get(b.c.id) ||
      (a.date + a.time).localeCompare(b.date + b.time));

  const fmtDate = d => `${DAY[weekdayOf(d)]} ${+d.slice(8)}/${+d.slice(5, 7)}`;
  const fmtTime = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };

  // One block per course, one line per date: "Sat 7/11: 7:30am (4), 1:10pm (2)"
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.c.id)) groups.set(it.c.id, { c: it.c, dates: new Map() });
    const g = groups.get(it.c.id);
    if (!g.dates.has(it.date)) g.dates.set(it.date, []);
    g.dates.get(it.date).push(`${fmtTime(it.time)} (${it.spots})`);
  }
  const MAX_PER_LINE = 6;
  let msg = `⛳ ${items.length} new tee time${items.length > 1 ? 's' : ''}\n`;
  for (const { c, dates } of groups.values()) {
    msg += `\n${c.tier === 1 ? '★ ' : ''}${c.name}\n`;
    for (const [d, ts] of dates) {
      msg += `  ${fmtDate(d)}: ${ts.slice(0, MAX_PER_LINE).join(', ')}` +
        (ts.length > MAX_PER_LINE ? ` +${ts.length - MAX_PER_LINE} more` : '') + '\n';
    }
  }
  msg += `\n(spots left in brackets)`;
  await sendAlerts(msg.trim(), pagesUrl());
}

function pagesUrl() {
  const repo = process.env.GITHUB_REPOSITORY; // "owner/name"
  if (!repo) return null;
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
}

await logTelegramChatIds();
await main();
