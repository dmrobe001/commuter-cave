// act.js — the common shape of every process: the state it reads, the state it may change, and a run
// that turns the one into the other.
//
// A process is a record:
//   { id, name,
//     reads:  ['here.water', 'clock.now', 'core.props', ...],   what it looks at
//     writes: ['body.hyd', 'body.pendingSick', ...],           what it may change
//     hours, kcal,                    time and effort: numbers, or functions of the view
//     ready(v)                        optional: true, or the words for why it can't be done now
//     run(v, dice) → { make, use, say, report } }
// A path is a namespace and then properties. The namespaces are whatever the game supplies: its state
// (body, site, here, sky, ground, clock, mem, ...) and the things bound to the job by slot name (core,
// hammer, food). 'world.…' is the generated world itself: constant through play, so it is handed over
// as it is, never copied or compared.
//
// The view v holds a copy of every path read or written, nested the same way (v.body.hyd,
// v.core.props.fracture). run changes the copy; what it did is the difference between the copy before
// and after (changes), plus what it made (make: new things, { name, kind, props, from }), what it used
// up (use: things from the view, by their uid), and what it has to say (say: lines, each a string or
// [string, kind]). report holds anything else worth showing that isn't state (what was counted, say).
// Reading a path not declared, or changing one not declared as written, is an error: a process can't
// reach past its contract.
//
// The dice: dice.act is this attempt's luck; dice.place(key) is chance fixed by where (a cell's
// population): the same key always gives the same draws. Because a run sees only its view and its
// dice, it can be run again on the same view with other dice without touching the game: that is how
// the spread of a process's outcomes can be found.

const isPlain = x => x !== null && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype;
// A deep copy of plain state: objects, lists and sets of numbers, strings and the like.
function copy(x) {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(copy);
  if (x instanceof Set) return new Set([...x].map(copy));
  if (x instanceof Map) return new Map([...x].map(([k, y]) => [k, copy(y)]));
  const o = {};
  for (const k of Object.keys(x)) o[k] = copy(x[k]);
  return o;
}
const keysOf = p => p.split('.');
const get = (o, ks) => ks.reduce((a, k) => (a == null ? undefined : a[k]), o);
function put(o, ks, value) {
  let a = o;
  for (const k of ks.slice(0, -1)) a = (a[k] ??= {});
  a[ks[ks.length - 1]] = value;
}
const valueOf = (x, v) => (typeof x === 'function' ? x(v) : x ?? 0);
const isConstant = p => p === 'world' || p.startsWith('world.');

// Every path the process touches, without ones already covered by a shorter path ('core.props' covers
// 'core.props.sharpness').
export function pathsOf(proc) {
  const all = [...new Set([...(proc.reads ?? []), ...(proc.writes ?? [])])].sort((a, b) => a.length - b.length);
  return all.filter((p, i) => !all.slice(0, i).some(q => p.startsWith(`${q}.`)));
}
const declared = (proc, path) => (proc.writes ?? []).some(w => path === w || path.startsWith(`${w}.`) || w.startsWith(`${path}.`));

// The view: a copy of each path's value from state.get(path), nested by path. The world is passed as is.
export function viewOf(proc, state) {
  const v = {};
  for (const p of pathsOf(proc)) put(v, keysOf(p), isConstant(p) ? state.get(p) : copy(state.get(p)));
  return v;
}

// What changed between two copies of state, as leaf changes: { path, from, to } for a value replaced,
// { path, added, removed } for things added to a list or a set (a list only grows when its old
// entries are still there in order); a list the same length is compared item by item.
export function diff(a, b, path = '', out = []) {
  if (Object.is(a, b)) return out;
  if (a instanceof Set && b instanceof Set) {
    const added = [...b].filter(x => !a.has(x)), removed = [...a].filter(x => !b.has(x));
    if (added.length || removed.length) out.push({ path, added, removed });
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === b.length) a.forEach((x, i) => diff(x, b[i], `${path}.${i}`, out)); // the same list, changed in place
    else if (b.length > a.length && a.every((x, i) => !diff(x, b[i]).length)) out.push({ path, added: b.slice(a.length), removed: [] }); // grown
    else out.push({ path, from: a, to: b });
    return out;
  }
  if (isPlain(a) && isPlain(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!isConstant(path ? `${path}.${k}` : k)) diff(a[k], b[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  out.push({ path, from: a, to: b });
  return out;
}

// The view as the run sees it: reading anything not declared is an error too, so a process can't
// quietly depend on state its contract doesn't name. Only the parts of the view built up from paths
// are guarded; a path's own value (a whole item, say) is the process's to read as it likes.
function guard(node, path, paths, id) {
  return new Proxy(node, {
    get(o, k) {
      if (typeof k === 'symbol' || k === 'toJSON') return o[k];
      const full = path ? `${path}.${k}` : k;
      if (paths.has(full) || isConstant(full)) return o[k];
      if ([...paths].some(p => p.startsWith(`${full}.`))) return o[k] && typeof o[k] === 'object' ? guard(o[k], full, paths, id) : o[k];
      throw new Error(`${id} read ${full} without declaring it`);
    },
  });
}

// Run a process on a view without touching the game: the outcome, and the view after.
export function rehearse(proc, v0, dice) {
  const v = {};
  for (const [k, x] of Object.entries(v0)) v[k] = k === 'world' ? x : copy(x);
  const out = proc.run(guard(v, '', new Set(pathsOf(proc)), proc.id), dice) ?? {};
  const changes = diff(v0, v);
  const stray = changes.filter(c => !declared(proc, c.path));
  if (stray.length) throw new Error(`${proc.id} changed ${stray.map(c => c.path).join(', ')} without declaring it`);
  const say = (out.say ?? []).map(l => (Array.isArray(l) ? l : [l, 'act']));
  return { id: proc.id, changes, make: out.make ?? [], use: out.use ?? [], say, report: out.report ?? null, after: v };
}

// Put an outcome's changes into the state: each leaf change on its own, so whatever else changed the
// state meanwhile (time passing) is kept.
export function apply(fx, state) {
  for (const c of fx.changes) {
    if ('to' in c) { state.set(c.path, copy(c.to)); continue; }
    const cur = state.get(c.path);
    if (cur instanceof Set) { for (const x of c.added) cur.add(x); for (const x of c.removed) cur.delete(x); }
    else if (Array.isArray(cur)) cur.push(...copy(c.added));
    else state.set(c.path, copy(get(fx.after, keysOf(c.path))));
  }
}

export const hoursOf = (proc, v) => valueOf(proc.hours, v);
export const kcalOf = (proc, v) => valueOf(proc.kcal, v) || 150;
export const readyFor = (proc, v) => (proc.ready ? proc.ready(v) : true);

// A state over plain objects: namespaces map names to objects (or to functions giving them), and
// derived values ({ ns: { key: () => value } }) are worked out when asked for and can't be written.
export function stateOver(namespaces, derived = {}) {
  const root = ns => (typeof namespaces[ns] === 'function' ? namespaces[ns]() : namespaces[ns]);
  return {
    get(path) {
      const [ns, ...ks] = keysOf(path);
      if (derived[ns]) { if (!ks.length) return Object.fromEntries(Object.entries(derived[ns]).map(([k, f]) => [k, f()])); const f = derived[ns][ks[0]]; return get(f?.(), ks.slice(1)); }
      return ks.length ? get(root(ns), ks) : root(ns);
    },
    set(path, value) {
      const [ns, ...ks] = keysOf(path);
      if (derived[ns]) throw new Error(`${path} is worked out from other state; it can't be set`);
      if (!ks.length) throw new Error(`can't replace the whole of ${ns}`);
      put(root(ns), ks, value);
    },
  };
}
