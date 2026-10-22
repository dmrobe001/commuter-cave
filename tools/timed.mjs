#!/usr/bin/env node
// timed.mjs — run a batch of commands, timing each, and report the total.
//
//   node tools/timed.mjs <label> [-j N] -- "<command>" ["<command>" ...] [:: "<command>" ...]
//
// Each command runs through the shell. With -j N (default 1), up to N commands run at once; a "::"
// between commands is a barrier: everything before it finishes before anything after it starts (the
// build before the tests, say). Run one at a time, a command's output passes straight through; run
// several at once, each command's output is held and printed whole when it finishes, so outputs don't
// interleave. After each one a line like "⏱ test:sim · tests/sim/outlook.mjs · 4.2 s" is printed; at
// the end, a summary with every step, the batch's wall-clock time and, when steps overlapped, the sum
// of the steps' own times (the machine time spent). The batch stops at the first failing command (exit
// code 1): nothing new starts, though commands already running finish. Every batch is appended to
// out/timings.jsonl (date, label, steps, total, summed, ok), so run times can be compared across
// changes and added up over a round of work.

import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sep = args.indexOf('--');
if (sep < 1 || sep === args.length - 1) {
  console.error('usage: node tools/timed.mjs <label> [-j N] -- "<command>" ["<command>" ...] [:: "<command>" ...]');
  process.exit(2);
}
const head = args.slice(0, sep);
const jAt = head.indexOf('-j');
const jobs = jAt >= 0 ? Math.max(1, Number(head[jAt + 1]) || 1) : 1;
const label = (jAt >= 0 ? head.filter((_, i) => i !== jAt && i !== jAt + 1) : head).join(' ');
const groups = [[]];
for (const a of args.slice(sep + 1)) if (a === '::') groups.push([]); else groups[groups.length - 1].push(a);
const commands = groups.flat();

const fmt = ms => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 120000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const short = cmd => cmd.replace(/^node\s+/, '').replace(/\s+/g, ' ');

function runOne(cmd, alone) {
  return new Promise(resolve => {
    const s0 = performance.now();
    const child = spawn(cmd, { cwd: root, shell: true, stdio: alone ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    const out = [];
    if (!alone) { child.stdout.on('data', b => out.push(b)); child.stderr.on('data', b => out.push(b)); }
    child.on('close', (code, signal) => resolve({ cmd, ms: performance.now() - s0, code: code ?? signal, out: Buffer.concat(out).toString() }));
  });
}

const steps = [];
let ok = true;
const t0 = performance.now();
for (const group of groups) {
  if (!ok) break;
  const queue = [...group], alone = jobs === 1 || group.length === 1;
  const worker = async () => {
    while (ok && queue.length) {
      const r = await runOne(queue.shift(), alone);
      const passed = r.code === 0;
      if (!alone && r.out) process.stdout.write(r.out.endsWith('\n') ? r.out : `${r.out}\n`);
      steps.push({ cmd: short(r.cmd), ms: Math.round(r.ms), ok: passed });
      console.log(`⏱ ${label} · ${short(r.cmd)} · ${fmt(r.ms)}${passed ? '' : ` · FAILED (exit ${r.code})`}`);
      if (!passed) ok = false;
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, group.length) }, worker));
}
const total = performance.now() - t0, summed = steps.reduce((a, s) => a + s.ms, 0);

console.log(`\n⏱ ${label} summary${ok ? '' : ' (stopped at a failure)'}`);
for (const s of steps) console.log(`   ${fmt(s.ms).padStart(10)}  ${s.ok ? '' : 'FAILED  '}${s.cmd}`);
console.log(`   ${fmt(total).padStart(10)}  TOTAL ${label} (${steps.length} of ${commands.length} step${commands.length === 1 ? '' : 's'}${jobs > 1 ? `, up to ${jobs} at once; ${fmt(summed)} of steps in all` : ''})`);

try {
  mkdirSync(join(root, 'out'), { recursive: true });
  appendFileSync(join(root, 'out', 'timings.jsonl'), JSON.stringify({ date: new Date().toISOString(), label, ok, jobs, totalMs: Math.round(total), summedMs: Math.round(summed), steps }) + '\n');
} catch { /* timing history is a convenience */ }
process.exit(ok ? 0 : 1);
