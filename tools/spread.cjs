#!/usr/bin/env node
// spread.cjs — what else could have happened, for the last action of a game record, from the command
// line. Replays the record in the built game (undrawn), then runs its last action again with other
// dice (spread.js, through __hk.spreadLast) and prints the range of every outcome that varies, the
// unusual luck in what happened, a walk's open steps, and (with --inputs) what the action read.
//
//   node tools/spread.cjs <record.json | -> [--vary act|place|both] [--n 200] [--all] [--inputs] [--json]
//
// A record is what "Copy game record" gives (Body tab). --all lists outcomes that never vary too;
// --json prints the whole result.
const fs = require('fs');
const { game } = require('../tests/ui/drive.cjs');
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; }, flag = k => args.includes(k);
const src = args.find((a, i) => !a.startsWith('--') && !['--vary', '--n'].includes(args[i - 1]));
if (!src) { console.error('usage: node tools/spread.cjs <record.json | -> [--vary act|place|both] [--n 200] [--all] [--inputs] [--json]'); process.exit(2); }
const text = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8');
const f = x => (typeof x !== 'number' ? String(x) : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? String(+x.toFixed(2)) : String(+x.toPrecision(2)));
const pct = x => `${Math.round(100 * x)}%`;
function line(e) {
  const s = e.summary, a = e.actual === undefined ? 'not this time' : f(e.actual);
  if (e.present < 1) return `${a}; there in ${pct(e.present)} of runs${s.kind === 'num' ? `, ${f(s.q[0])}–${f(s.q[4])}` : ''}`;
  if (!e.varies) return `${a} (always)`;
  if (s.kind === 'num') return `${a}; 5–95% ${f(s.q[0])}–${f(s.q[4])}, median ${f(s.q[2])}${s.same ? `, unchanged ${pct(s.same)}` : ''}${e.rank != null ? `; rank ${pct(e.rank)}${e.rank < 0.1 || e.rank > 0.9 ? ' (unusual)' : ''}` : ''}`;
  return `${a}; ${Object.entries(s.counts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`;
}
(async () => {
  const g = await game(null, { record: text });
  const r = g.hk.spreadLast(opt('--vary') ?? 'act', opt('--n') ? Number(opt('--n')) : null);
  if (!r) { console.log('No action to look into.'); process.exit(1); }
  if (flag('--json')) { console.log(JSON.stringify({ ...r, outcome: undefined, inputs: undefined }, null, 1)); process.exit(0); }
  const vary = { act: "this attempt's luck", place: "the place's luck", both: 'both' }[r.vary];
  console.log(`${r.name}: ${r.n} runs varying ${vary}; run again with the same dice it ${r.reproduces ? 'comes out the same' : 'comes out DIFFERENTLY'}${r.errors.length ? `; ${r.errors.length} errors: ${r.errors[0]}` : ''}`);
  console.log(r.unusual.length ? `unusual luck: ${r.unusual.map(e => `${e.path} ${f(e.actual)} (rank ${pct(e.rank)})`).join('; ')}` : 'nothing unusual in what happened');
  for (const e of r.leaves) if (flag('--all') || e.varies) console.log(`  ${e.path}: ${line(e)}`);
  if (r.walk) {
    console.log(`walk: ${r.walk.steps.length} steps, surprisal ${r.walk.bits.toFixed(1)} bits; the open ones (the cell taken under 90%):`);
    for (const s of r.walk.steps.filter(s => s.p < 0.9)) console.log(`  step ${s.i + 1} from ${s.from.x},${s.from.y}: went ${s.took.x},${s.took.y} (${pct(s.p)})${s.others.length ? `; else ${s.others.slice(0, 3).map(o => `${o.cell} ${pct(o.p)}`).join(', ')}` : ''}`);
  }
  if (flag('--inputs')) for (const i of r.inputList) console.log(`  read ${i.path} = ${f(i.value)}`);
  process.exit(0);
})();
