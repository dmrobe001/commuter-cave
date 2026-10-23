// spread.js — the range of a process's outcomes, alongside the one that happened.
//
// A process (act.js) runs on the state it reads and on dice. Run it again in a fresh transaction with
// other dice, n times, each thrown away after, and every outcome it can have shows up with about its
// share. Which dice change is a choice, and it decides what the range means:
//   'act'   this attempt's own luck (the knap's blow, the drink's dose, a bearing's error), the place as it is;
//   'place' the place's luck (what lives at a site: cells like this one), this attempt's luck as it fell;
//   'both'  both.
// actAt, if given, is the attempt's dice as they stood when it was done (rng.copy()), so 'place' holds
// them fixed, and varying nothing reproduces what happened (reproduces checks that it does).
//
// Two accounts of the outcomes:
// - Draws, by observable. A run notes the numbers its luck produced (dice.note(kind, id, fields)):
//   for a search, one record per thing that could have been noticed (observed or not, with what was
//   perceived of it: the exact bearing and distance, not the words); for a craft, the attempt's margin
//   and what it made; for a walk, where it ended and what befell it. Grouped by kind and id over the
//   runs: how often each is observed at all, and, when it is, every field summarised (numbers by
//   quantiles, mean and range; bearings as angles, by their circular mean and spread; anything else by
//   how often each value comes up); a field with a true value beside it (bearing and trueBearing) also
//   gets its error (degrees off, or the ratio to the truth). These are the numbers the journal's words
//   are made from; the words themselves are left out.
// - State, by path: each changed path's value after (unchanged runs count as the value before), things
//   added to lists ('path+' items, 'path +n' how many), things made and used, what the process
//   reported; the journal is left out (its numbers are in the draws).
// What happened is ranked among the runs: the share below it plus half the share equal to it (0.5:
// typical; near 0 or 1: unusual luck).
import { attempt } from './act.js';
import { makeRng } from './rng.js';

const isState = p => !/^(made|used|report)\b/.test(p) && !/[+]|\[\]/.test(p);
const isAngle = f => /(^|[a-z])(bearing|Bearing|dir|heading)$/.test(f) || f === 'bearing';
const wrapDeg = a => ((a % 360) + 540) % 360 - 180; // −180..180
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// The primitive leaves of x under path, into out (path → values).
function leaves(x, path, out) {
  if (x === null || x === undefined || typeof x !== 'object') { (out[path] ??= []).push(x); return; }
  if (Array.isArray(x)) { (out[`${path}.length`] ??= []).push(x.length); for (const y of x) leaves(y, `${path}[]`, out); return; }
  for (const [k, y] of Object.entries(x)) leaves(y, path ? `${path}.${k}` : k, out);
}
// One outcome's state changes as leaves (the journal left out).
export function outcomeLeaves(fx) {
  const out = {};
  for (const c of fx.changes) {
    if (/^log\b/.test(c.path)) continue;
    if ('to' in c) leaves(c.to, c.path, out);
    else if ('cells' in c) (out[`${c.path} (cells changed)`] ??= []).push(c.cells);
    else { (out[`${c.path} +n`] ??= []).push(c.added.length); for (const y of c.added) leaves(y, `${c.path}+`, out); if (c.removed?.length) (out[`${c.path} -n`] ??= []).push(c.removed.length); }
  }
  (out['made (count)'] ??= []).push(fx.make.length);
  for (const m of fx.make) { (out['made.kind'] ??= []).push(m.kind); leaves(m.props, `made.${m.kind}`, out); }
  (out['used (count)'] ??= []).push(fx.use.length);
  if (fx.report) leaves(fx.report, 'report', out);
  return out;
}

const q = (xs, p) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))];
export function summarise(values, before, angle = false) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (values.length && nums.length === values.length) {
    if (angle) { // circular: the mean direction, and how widely they spread about it
      const s = nums.reduce((a, x) => a + Math.sin(x * Math.PI / 180), 0) / nums.length, c = nums.reduce((a, x) => a + Math.cos(x * Math.PI / 180), 0) / nums.length;
      const mean = (Math.atan2(s, c) * 180 / Math.PI + 360) % 360, R = Math.hypot(s, c);
      const dev = nums.map(x => wrapDeg(x - mean)).sort((a, b) => a - b);
      return { kind: 'angle', n: nums.length, mean, sd: R >= 1 ? 0 : Math.sqrt(-2 * Math.log(Math.max(R, 1e-9))) * 180 / Math.PI, q: [0.05, 0.25, 0.5, 0.75, 0.95].map(p => (mean + q(dev, p) + 360) % 360) };
    }
    const xs = [...nums].sort((a, b) => a - b), mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { kind: 'num', n: xs.length, mean, min: xs[0], max: xs[xs.length - 1], q: [0.05, 0.25, 0.5, 0.75, 0.95].map(p => q(xs, p)), same: before === undefined ? null : xs.filter(x => x === before).length / xs.length };
  }
  const counts = {};
  for (const v of values) { const k = v === undefined ? '(none)' : String(v); counts[k] = (counts[k] ?? 0) + 1; }
  for (const k of Object.keys(counts)) counts[k] /= values.length;
  return { kind: 'cat', n: values.length, counts };
}
export function rankOf(s, values, a) {
  if (a === undefined || a === null) return null;
  if (s.kind === 'angle') { const d = x => wrapDeg(x - s.mean), da = d(a); return (values.filter(v => d(v) < da).length + 0.5 * values.filter(v => d(v) === da).length) / values.length; }
  if (s.kind === 'num') { const below = values.filter(v => v < a).length, eq = values.filter(v => v === a).length; return (below + 0.5 * eq) / values.length; }
  return s.counts[String(a)] ?? 0; // for a category: how often what happened comes up
}
const unusualRank = (s, r) => r != null && s.kind !== 'cat' && (r < 0.1 || r > 0.9);
// A tree of entries by path: { name, path, leaf?, children }.
function treeOf(entries) {
  const root = { name: '', path: '', children: [] };
  for (const e of entries) {
    let node = root;
    const parts = e.path.split('.');
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('.');
      let c = node.children.find(x => x.name === name);
      if (!c) { c = { name, path, children: [] }; node.children.push(c); }
      node = c;
    });
    node.leaf = e;
  }
  return root;
}

// The draws of n runs, by observable: for each kind and id, how often it's observed, and its fields.
export function byObservable(runs, actual) {
  const groups = new Map(), n = runs.length;
  const add = (d, i) => {
    const key = `${d.kind}\u0000${d.id}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { kind: d.kind, id: d.id, name: d.name ?? d.id, runs: Array.from({ length: n }, () => []) });
    g.runs[i].push(d);
  };
  runs.forEach((draws, i) => draws.forEach(d => add(d, i)));
  for (const d of actual ?? []) if (!groups.has(`${d.kind}\u0000${d.id}`)) groups.set(`${d.kind}\u0000${d.id}`, { kind: d.kind, id: d.id, name: d.name ?? d.id, runs: Array.from({ length: n }, () => []) });
  const out = [];
  for (const g of groups.values()) {
    const all = g.runs.flat(), seen = all.filter(d => d.observed !== false), here = (actual ?? []).filter(d => d.kind === g.kind && d.id === g.id);
    const happened = here.find(d => d.observed !== false) ?? null;
    const fields = [...new Set(all.flatMap(d => Object.keys(d)))].filter(f => !['kind', 'id', 'name', 'observed'].includes(f));
    const stats = [];
    for (const f of fields) {
      // pooled over every record that has it: what was perceived comes only with an observation, while
      // what a thing is (its chance of being noticed, how many there are, where it truly lies) comes either way
      const values = all.map(d => d[f]).filter(v => v !== undefined);
      if (!values.length) continue;
      const s = summarise(values, undefined, isAngle(f)), a = (happened ?? here[0])?.[f];
      stats.push({ field: f, summary: s, actual: a, rank: rankOf(s, values, a) });
      const tf = `true${cap(f)}`;
      if (fields.includes(tf)) { // how far off the perception was
        const errs = seen.filter(d => typeof d[f] === 'number' && typeof d[tf] === 'number').map(d => (isAngle(f) ? wrapDeg(d[f] - d[tf]) : d[tf] ? d[f] / d[tf] : NaN)).filter(Number.isFinite);
        if (errs.length) { const es = summarise(errs), ea = happened && typeof happened[f] === 'number' ? (isAngle(f) ? wrapDeg(happened[f] - happened[tf]) : happened[f] / happened[tf]) : undefined; stats.push({ field: isAngle(f) ? `${f} error (°)` : `${f} / true`, summary: es, actual: ea, rank: rankOf(es, errs, ea) }); }
      }
    }
    out.push({ kind: g.kind, id: g.id, name: g.name, observed: g.runs.filter(rs => rs.some(d => d.observed !== false)).length / n, records: all.length, happened: actual ? !!happened : null, fields: stats });
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || b.observed - a.observed || String(a.name).localeCompare(String(b.name)));
}

// The range of outcomes: proc run n times on the state as stateFn() gives it. live(d) gives the live
// keys for a run with dice d; around(i, run, d) wraps each run (the game swaps in the place's dice for
// its own helpers there). actual: the outcome that happened.
export function spread(proc, stateFn, { n = 200, vary = 'act', seed = 'spread', actAt = null, place = null, live = null, around = (i, f) => f(), actual = null } = {}) {
  const leafRuns = [], drawRuns = [], errors = [];
  const diceFor = i => ({
    act: vary === 'place' && actAt ? actAt.copy() : makeRng(`${seed}/act/${i}`),
    place: vary === 'act' && place ? place : key => makeRng(`${seed}/place/${i}/${key}`),
  });
  for (let i = 0; i < n; i++) {
    const d = diceFor(i);
    try {
      const fx = around(i, () => attempt(proc, stateFn(), d, { live: live?.(d) }), d);
      fx.tx.discard();
      leafRuns.push(outcomeLeaves(fx)); drawRuns.push(fx.draws);
    } catch (e) { errors.push(e.message); }
  }
  const happened = actual ? outcomeLeaves(actual) : null, paths = new Set([...leafRuns.flatMap(s => Object.keys(s)), ...Object.keys(happened ?? {})]);
  const beforeOf = path => { // the value before, from the change that covers this path (the path itself, or a thing changed whole that holds it)
    const c = actual?.changes.find(x => 'to' in x && (path === x.path || path.startsWith(`${x.path}.`)));
    return c ? path.slice(c.path.length).split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), c.from) : undefined;
  };
  const entries = [];
  for (const path of paths) {
    const before = isState(path) ? beforeOf(path) : undefined;
    const fill = s => s[path] ?? (isState(path) ? [before] : / [+-]n$|\(count\)$|\(cells changed\)$/.test(path) ? [0] : []);
    const values = leafRuns.flatMap(fill);
    if (!values.length) continue;
    const s = summarise(values, before), a = happened ? fill(happened)[0] : undefined;
    const present = isState(path) || / [+-]n$|\(count\)$|\[\]|[+]|^made\.|\(cells changed\)$/.test(path) ? 1 : leafRuns.filter(x => path in x).length / leafRuns.length;
    entries.push({ path, before, summary: s, actual: a, present, rank: rankOf(s, values, a), varies: present < 1 || (s.kind === 'num' ? s.min !== s.max : Object.keys(s.counts).length > 1) });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const inputs = actual ? [...actual.reads].map(([path, value]) => ({ path, value })) : [];
  const observables = byObservable(drawRuns, actual?.draws);
  return {
    id: proc.id, name: proc.name ?? proc.id, n: leafRuns.length, vary, errors: [...new Set(errors)],
    observables, outcome: treeOf(entries), leaves: entries, inputs: treeOf(inputs), inputList: inputs,
    unusual: [
      ...observables.flatMap(o => o.fields.filter(f => unusualRank(f.summary, f.rank) && !o.fields.some(g => g.field === `${f.field} error (°)` || g.field === `${f.field} / true`)).map(f => ({ path: `${o.kind} ${o.name}: ${f.field}`, actual: f.actual, rank: f.rank }))),
    ], // (the state's own leaves follow from the draws; their ranks are in the state tree)
  };
}

// Run again with the very dice it had: does it come out as it did? (A check that the state it read
// and its dice really are all it depends on.)
export function reproduces(proc, stateFn, actAt, place, actual, { live = null, around = (i, f) => f() } = {}) {
  const d = { act: actAt.copy(), place };
  const fx = around(0, () => attempt(proc, stateFn(), d, { live: live?.(d) }), d);
  fx.tx.discard();
  return JSON.stringify([outcomeLeaves(fx), fx.draws]) === JSON.stringify([outcomeLeaves(actual), actual.draws]);
}

// Words for an observable's summary, shared by the game's panel and the command line: how often it's
// observed (and whether it was this time), then each field that varies or matters, a perceived value
// next to its truth and its error. Plain text; the caller escapes it.
const fmt = x => (typeof x !== 'number' ? String(x) : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? String(+x.toFixed(2)) : String(+x.toPrecision(2)));
const pct = x => `${Math.round(100 * x)}%`;
export function describeObservable(o) {
  const by = Object.fromEntries(o.fields.map(f => [f.field, f]));
  const parts = [];
  for (const f of o.fields) {
    const name = f.field, s = f.summary;
    if (/^true[A-Z]/.test(name) || / error \(°\)$| \/ true$/.test(name) || name === 'name') continue;
    const constant = s.kind === 'cat' ? Object.keys(s.counts).length === 1 : s.kind === 'angle' ? s.sd < 0.01 : s.min === s.max;
    if (constant && s.kind === 'cat' && Object.keys(s.counts)[0] === 'false') continue; // a flag never raised: not worth a line
    const a = f.actual === undefined || f.actual === null ? '' : `${fmt(f.actual)}${s.kind === 'angle' ? '°' : ''} · `;
    let text;
    if (s.kind === 'angle') text = constant ? `${fmt(s.mean)}°` : `${a}${fmt(s.mean)}° ±${fmt(s.sd)}°`;
    else if (s.kind === 'num') text = constant ? fmt(s.min) : `${a}${fmt(s.q[0])}–${fmt(s.q[4])}, median ${fmt(s.q[2])}`;
    else text = constant ? Object.keys(s.counts)[0] : `${a}${Object.entries(s.counts).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`;
    const t = by[`true${name.charAt(0).toUpperCase()}${name.slice(1)}`], e = by[`${name} error (°)`] ?? by[`${name} / true`];
    if (t) {
      const tv = t.summary.kind === 'angle' ? `${fmt(t.summary.mean)}°` : t.summary.kind === 'num' ? fmt(t.summary.q[2]) : '';
      const ev = e ? (e.field.endsWith('(°)') ? `off ${fmt(e.summary.q[2])}° (${fmt(e.summary.q[0])} to ${fmt(e.summary.q[4])})` : `×${fmt(e.summary.q[2])} (${fmt(e.summary.q[0])}–${fmt(e.summary.q[4])})`) : '';
      text += ` [true ${tv}${ev ? `; ${ev}` : ''}]`;
    }
    if (f.rank != null && s.kind !== 'cat' && !constant && (f.rank < 0.1 || f.rank > 0.9)) text += ` (rank ${pct(f.rank)}: unusual)`;
    parts.push(`${name} ${text}`);
  }
  const seen = o.observed === 1 ? 'every run' : o.observed === 0 ? 'no run' : `${pct(o.observed)} of runs`;
  return { head: `${o.name}: ${seen}${o.happened === false && o.observed > 0 ? ' (not this time)' : o.happened === true && o.observed < 1 ? ' (this time, yes)' : ''}`, parts };
}
