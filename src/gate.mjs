// Decides whether this scheduled run should do a full check.
// Mon/Tue/Wed/Fri: every run. Other days: only once enough time has passed since the last check.
import { readFile, appendFile } from 'node:fs/promises';
import { shouldRun } from './core.mjs';

const read = async p => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const cfg = await read('../config.json');
let last = null;
try { last = (await read('../docs/data.json')).generatedAt; } catch {}

const force = process.env.FORCE_RUN === 'true';
const run = force || shouldRun(new Date(), cfg, last);
console.log(`Last check: ${last || 'never'}.`,
  run ? (force ? 'Manual run.' : 'Checking now.') : 'Too soon since the last check; skipping.');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `run=${run}\n`);
