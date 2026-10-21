#!/usr/bin/env node
// timed.mjs — run a batch of commands in order, timing each, and report the total.
//
//   node tools/timed.mjs <label> -- "<command>" ["<command>" ...]
//
// Each command runs through the shell with its output passed straight through. After each one a
// line like "⏱ test:sim · tests/sim/outlook.mjs · 4.2 s" is printed; at the end, a summary with
// every step and the batch total. The batch stops at the first failing command (exit code 1).
// Every batch is also appended to out/timings.jsonl (date, label, steps, total, ok), so run times
// can be compared across changes.

import { spawnSync } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sep = args.indexOf('--');
if (sep < 1 || sep === args.length - 1) {
  console.error('usage: node tools/timed.mjs <label> -- "<command>" ["<command>" ...]');
  process.exit(2);
}
const label = args.slice(0, sep).join(' ');
const commands = args.slice(sep + 1);

const fmt = ms => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 120000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const short = cmd => cmd.replace(/^node\s+/, '').replace(/\s+/g, ' ');

const steps = [];
let ok = true;
const t0 = performance.now();
for (const cmd of commands) {
  const s0 = performance.now();
  const res = spawnSync(cmd, { cwd: root, shell: true, stdio: 'inherit' });
  const ms = performance.now() - s0;
  const passed = res.status === 0;
  steps.push({ cmd: short(cmd), ms: Math.round(ms), ok: passed });
  console.log(`⏱ ${label} · ${short(cmd)} · ${fmt(ms)}${passed ? '' : ` · FAILED (exit ${res.status ?? res.signal})`}`);
  if (!passed) { ok = false; break; }
}
const total = performance.now() - t0;

console.log(`\n⏱ ${label} summary${ok ? '' : ' (stopped at a failure)'}`);
for (const s of steps) console.log(`   ${fmt(s.ms).padStart(10)}  ${s.ok ? '' : 'FAILED  '}${s.cmd}`);
console.log(`   ${fmt(total).padStart(10)}  TOTAL ${label} (${steps.length} of ${commands.length} step${commands.length === 1 ? '' : 's'})`);

try {
  mkdirSync(join(root, 'out'), { recursive: true });
  appendFileSync(join(root, 'out', 'timings.jsonl'), JSON.stringify({ date: new Date().toISOString(), label, ok, totalMs: Math.round(total), steps }) + '\n');
} catch { /* timing history is a convenience */ }
process.exit(ok ? 0 : 1);
