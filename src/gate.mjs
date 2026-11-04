// Decides whether this scheduled run should do a full check.
// GitHub wakes us every 30 minutes; Thu/Sat/Sun are thinned to every 3 hours (Sydney time).
import { readFile, appendFile } from 'node:fs/promises';
import { shouldRun } from './core.mjs';

const cfg = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const force = process.env.FORCE_RUN === 'true';
const run = force || shouldRun(new Date(), cfg);
console.log(run ? (force ? 'Manual run.' : 'Scheduled check: go.') : 'Skipping this slot (off-peak day).');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `run=${run}\n`);
