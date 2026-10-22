// spread.js — the range of a process's outcomes, alongside the one that happened.
//
// A process (act.js) runs on a view of what it reads and on dice. Run it again on the same view with
// other dice, n times, and every outcome it can have shows up with about its share. Which dice change
// is a choice, and it decides what the range means:
//   'act'   this attempt's own luck (the knap's blow, the drink's dose, the step's drift), the place as it is;
//   'place' the place's luck (what lives at a site: cells like this one), this attempt's luck as it fell;
//   'both'  both.
// actAt, if given, is the attempt's dice as they stood when it was done (rng.copy()), so 'place' holds
// them fixed, and varying nothing reproduces what happened (spread checks that it does).
//
// Every outcome is taken apart into leaves, by path:
//   state:   each changed path's value after (unchanged runs count as the value before; a thing changed
//            whole is taken apart into its own leaves); what was added to a list ('path+' items and
//            'path +n', how many);
//   made:    'made (count)', and each thing made by kind ('made.edge.sharpness'), pooled over all made;
//   used:    'used (count)';
//   report:  'report.…', whatever the process reports beyond the state (what was counted, a quality).
// A reported leaf may be there in some runs and not others (a thing seen, or not): present is the share
// of runs it's in, and its summary is over those. Each leaf is summarised: numbers by quantiles (5, 25, 50, 75, 95%), mean, min and max, and how often
// the value is what it was before; anything else by how often each value comes up. The leaf as it
// happened (actual) gets its rank among the runs: the share below it, plus half the share equal to it
// (0.5: typical; near 0 or 1: unusual luck). The leaves are arranged as a tree by path.
import { rehearse } from './act.js';
import { makeRng } from './rng.js';

const get = (o, ks) => ks.reduce((a, k) => (a == null ? undefined : a[k]), o);
const isState = p => !/^(made|used|report)\b/.test(p) && !/[+]|\[\]/.test(p);

// The primitive leaves of x under path, into out (path → values).
function leaves(x, path, out) {
  if (x === null || x === undefined || typeof x !== 'object') { (out[path] ??= []).push(x); return; }
  if (ArrayBuffer.isView(x)) { (out[`${path} (cells set)`] ??= []).push(x.reduce((a, v) => a + (v ? 1 : 0), 0)); return; }
  if (x instanceof Set) { (out[`${path} (count)`] ??= []).push(x.size); return; }
  if (x instanceof Map) { (out[`${path} (count)`] ??= []).push(x.size); return; }
  if (Array.isArray(x)) { (out[`${path}.length`] ??= []).push(x.length); for (const y of x) leaves(y, `${path}[]`, out); return; }
  for (const [k, y] of Object.entries(x)) leaves(y, path ? `${path}.${k}` : k, out);
}
// One outcome as leaves.
export function outcomeLeaves(fx) {
  const out = {};
  for (const c of fx.changes) {
    if ('to' in c) leaves(c.to, c.path, out);
    else { (out[`${c.path} +n`] ??= []).push(c.added.length); for (const y of c.added) leaves(y, `${c.path}+`, out); if (c.removed?.length) (out[`${c.path} -n`] ??= []).push(c.removed.length); }
  }
  (out['made (count)'] ??= []).push(fx.make.length);
  for (const m of fx.make) { (out['made.kind'] ??= []).push(m.kind); leaves(m.props, `made.${m.kind}`, out); }
  (out['used (count)'] ??= []).push(fx.use.length);
  if (fx.report) leaves(fx.report, 'report', out);
  return out;
}

const q = (xs, p) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))];
export function summarise(values, before) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (values.length && nums.length === values.length) {
    const xs = [...nums].sort((a, b) => a - b), mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { kind: 'num', n: xs.length, mean, min: xs[0], max: xs[xs.length - 1], q: [0.05, 0.25, 0.5, 0.75, 0.95].map(p => q(xs, p)), same: before === undefined ? null : xs.filter(x => x === before).length / xs.length };
  }
  const counts = {};
  for (const v of values) { const k = v === undefined ? '(none)' : String(v); counts[k] = (counts[k] ?? 0) + 1; }
  for (const k of Object.keys(counts)) counts[k] /= values.length;
  return { kind: 'cat', n: values.length, counts };
}
export function rankOf(s, values, a) {
  if (a === undefined) return null;
  if (s.kind === 'num') { const below = values.filter(v => v < a).length, eq = values.filter(v => v === a).length; return (below + 0.5 * eq) / values.length; }
  return s.counts[a === undefined ? '(none)' : String(a)] ?? 0; // for a category: how often what happened comes up
}
// A tree of leaves by path: { name, path, leaf?, children }.
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

// The range of outcomes: proc run n times on v0. live(d) gives the live keys for a run with dice d (for
// processes that need them, see game.js); around(i, run) wraps each run (the game uses it to swap in
// the place's dice for its own helpers). actual: the outcome that happened.
export function spread(proc, v0, { n = 200, vary = 'act', seed = 'spread', actAt = null, place = null, live = null, around = (i, f) => f(), actual = null } = {}) {
  const samples = [], errors = [];
  const diceFor = i => ({
    act: vary === 'place' && actAt ? actAt.copy() : makeRng(`${seed}/act/${i}`),
    place: vary === 'act' && place ? place : key => makeRng(`${seed}/place/${i}/${key}`),
  });
  for (let i = 0; i < n; i++) {
    const d = diceFor(i);
    try { samples.push(outcomeLeaves(around(i, () => rehearse(proc, v0, d, { live: live?.(d) }), d))); } catch (e) { errors.push(e.message); }
  }
  const paths = new Set(samples.flatMap(s => Object.keys(s)));
  const happened = actual ? outcomeLeaves(actual) : null;
  if (happened) for (const p of Object.keys(happened)) paths.add(p);
  const entries = [];
  for (const path of paths) {
    const before = isState(path) ? get(v0, path.split('.')) : undefined;
    const values = samples.flatMap(s => s[path] ?? (isState(path) ? [before] : / [+-]n$|\(count\)$/.test(path) ? [0] : []));
    if (!values.length) continue;
    const s = summarise(values, before), a = happened ? (happened[path] ?? (isState(path) ? [before] : / [+-]n$|\(count\)$/.test(path) ? [0] : []))[0] : undefined;
    // how often it's there at all, for what a run may or may not report (a thing seen, or not)
    const present = isState(path) || / [+-]n$|\(count\)$|\[\]|[+]|^made\./.test(path) ? 1 : samples.filter(x => path in x).length / samples.length;
    entries.push({ path, before, summary: s, actual: a, present, rank: rankOf(s, values, a), varies: present < 1 || (s.kind === 'num' ? s.min !== s.max : Object.keys(s.counts).length > 1) });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const ins = {};
  for (const [k, x] of Object.entries(v0)) if (k !== 'world' && k !== 'L') leaves(x, k, ins);
  const inputs = Object.entries(ins).map(([path, vs]) => ({ path, value: vs.length === 1 ? vs[0] : `${vs.length} values` }));
  return {
    id: proc.id, name: proc.name ?? proc.id, n: samples.length, vary, errors: [...new Set(errors)],
    outcome: treeOf(entries), leaves: entries, inputs: treeOf(inputs), inputList: inputs,
    unusual: entries.filter(e => e.summary.kind === 'num' && e.varies && e.rank != null && (e.rank < 0.1 || e.rank > 0.9)),
  };
}

// The same step again: does varying nothing give back what happened? (A check that the view and the
// dice really are all a run depends on.)
export function reproduces(proc, v0, actAt, place, actual, { live = null, around = (i, f) => f() } = {}) {
  const d = { act: actAt.copy(), place };
  const fx = around(0, () => rehearse(proc, v0, d, { live: live?.(d) }), d);
  return JSON.stringify(outcomeLeaves(fx)) === JSON.stringify(outcomeLeaves(actual));
}
