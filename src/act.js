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
// hammer, food). 'world.…' and 'L.…' are the generated world and its landscape: constant through play,
// so they are handed over as they are, never copied or compared. A path
// written with a leading '+' ('+log') is append-only: the view starts it empty, and whatever the run
// adds to it is added to the state.
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
//
// Some state isn't the process's business at all: caches, version counters for redrawing, what the
// screen shows. rehearse can be given live keys ({ has, get, set }) for those; at the top of the view
// they read and write straight through, and are neither copied nor compared. The dice can be one of
// them (a run that asks for 'rng' gets dice.act).

const isPlain = x => x !== null && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype;
// A deep copy of plain state: objects, lists, sets, maps and grids of numbers, strings and the like.
// memo (original → copy) is shared across one view, so a thing reachable two ways (a fix both in a
// stream's list and in a stretch walked along it) is one thing in the copy too.
function copyWith(x, memo) {
  if (x === null || typeof x !== 'object') return x;
  if (memo.has(x)) return memo.get(x);
  let c;
  if (ArrayBuffer.isView(x)) { c = x.slice(); memo.set(x, c); return c; } // a grid
  if (Array.isArray(x)) { c = []; memo.set(x, c); for (const y of x) c.push(copyWith(y, memo)); return c; }
  if (x instanceof Set) { c = new Set(); memo.set(x, c); for (const y of x) c.add(copyWith(y, memo)); return c; }
  if (x instanceof Map) { c = new Map(); memo.set(x, c); for (const [k, y] of x) c.set(k, copyWith(y, memo)); return c; }
  c = {}; memo.set(x, c);
  for (const k of Object.keys(x)) c[k] = copyWith(x[k], memo);
  return c;
}
const copy = x => copyWith(x, new Map());
const ORIGINALS = new WeakMap(); // a view → its memo (original → copy), to find the state's own things again
const keysOf = p => p.split('.');
const get = (o, ks) => ks.reduce((a, k) => (a == null ? undefined : a[k]), o);
function put(o, ks, value) {
  let a = o;
  for (const k of ks.slice(0, -1)) a = (a[k] ??= {});
  a[ks[ks.length - 1]] = value;
}
const valueOf = (x, v) => (typeof x === 'function' ? x(v) : x ?? 0);
const CONSTANT = new Set(['world', 'L']);
const isConstant = p => CONSTANT.has(p.split('.')[0]);
const bare = p => p.replace(/^\+/, '');

// Every path the process touches, without ones already covered by a shorter path ('core.props' covers
// 'core.props.sharpness').
export function pathsOf(proc) {
  const all = [...new Set([...(proc.reads ?? []), ...(proc.writes ?? [])].map(bare))].sort((a, b) => a.length - b.length);
  return all.filter((p, i) => !all.slice(0, i).some(q => p.startsWith(`${q}.`)));
}
const appendOnly = proc => new Set([...(proc.writes ?? [])].filter(p => p.startsWith('+')).map(bare));
const declared = (proc, path) => (proc.writes ?? []).map(bare).some(w => path === w || path.startsWith(`${w}.`) || w.startsWith(`${path}.`));

// The view: a copy of each path's value from state.get(path), nested by path. The world is passed as is;
// an append-only path starts empty.
export function viewOf(proc, state) {
  const v = {}, adds = appendOnly(proc), memo = new Map();
  for (const p of pathsOf(proc)) put(v, keysOf(p), adds.has(p) ? [] : isConstant(p) ? state.get(p) : copyWith(state.get(p), memo));
  ORIGINALS.set(v, memo);
  return v;
}

// What changed between two copies of state, as leaf changes: { path, from, to } for a value replaced,
// { path, added, removed } for things added to a list or a set (a list only grows when its old
// entries are still there in order); a list the same length is compared item by item.
export function diff(a, b, path = '', out = []) {
  if (Object.is(a, b)) return out;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) { // a grid: one change, if any cell changed
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) out.push({ path, from: a, to: b });
    return out;
  }
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
function guard(node, path, paths, partial, id, live) {
  const seen = new Map(); // key → how to answer it ('live', 'own', 'deeper'), worked out once
  const how = k => {
    let h = seen.get(k);
    if (h) return h;
    const full = path ? `${path}.${k}` : k;
    h = !path && live?.has(k) ? 'live' : paths.has(full) || isConstant(full) ? 'own' : partial.has(full) ? 'deeper' : 'none';
    seen.set(k, h);
    return h;
  };
  return new Proxy(node, {
    get(o, k) {
      if (typeof k === 'symbol' || k === 'toJSON') return o[k];
      const h = how(k);
      if (h === 'own') return o[k];
      if (h === 'live') return live.get(k);
      if (h === 'deeper') return o[k] && typeof o[k] === 'object' ? guard(o[k], path ? `${path}.${k}` : k, paths, partial, id) : o[k];
      throw new Error(`${id} read ${path ? `${path}.${k}` : k} without declaring it`);
    },
    set(o, k, x) {
      if (typeof k !== 'symbol' && how(k) === 'live') live.set(k, x); else o[k] = x;
      return true;
    },
  });
}

// Run a process on a view without touching the game: the outcome, and the view after.
export function rehearse(proc, v0, dice, { live = null } = {}) {
  const v = {}, memo = new Map();
  for (const [k, x] of Object.entries(v0)) v[k] = isConstant(k) ? x : copyWith(x, memo);
  const back = new Map(); // the run's copy → the state's own thing
  for (const [orig, c0] of ORIGINALS.get(v0) ?? []) if (memo.has(c0)) back.set(memo.get(c0), orig);
  const paths = pathsOf(proc), partial = new Set(paths.flatMap(p => keysOf(p).slice(0, -1).map((_, i, ks) => ks.slice(0, i + 1).join('.'))));
  const out = proc.run(guard(v, '', new Set(paths), partial, proc.id, live), dice) ?? {};
  const changes = diff(v0, v);
  const stray = changes.filter(c => !declared(proc, c.path));
  if (stray.length) throw new Error(`${proc.id} changed ${stray.map(c => c.path).join(', ')} without declaring it`);
  const say = (out.say ?? []).map(l => (Array.isArray(l) ? l : [l, 'act']));
  return { id: proc.id, changes, make: out.make ?? [], use: out.use ?? [], say, report: out.report ?? null, after: v, back, writes: (proc.writes ?? []).map(bare), adds: appendOnly(proc) };
}

// Put an outcome into the state: each written path that changed is made to match the run's copy. The
// state's own things are kept and brought into line where the copy came from them (so whatever else
// holds them, holds them still, and two ways to one thing stay one thing); things the run made are
// added new. An append-only path has what was added appended.
export function apply(fx, state) {
  const done = new Map();
  const own = x => { // the state's thing for one in the run's copy
    if (x === null || typeof x !== 'object') return x;
    if (done.has(x)) return done.get(x);
    const r = fx.back.get(x);
    if (ArrayBuffer.isView(x)) { const t = r && r.length === x.length ? r : x.slice(); if (t === r) t.set(x); done.set(x, t); return t; }
    if (Array.isArray(x)) { const t = r ?? []; done.set(x, t); const items = x.map(own); t.length = 0; t.push(...items); return t; }
    if (x instanceof Set) { const t = r ?? new Set(); done.set(x, t); const items = [...x].map(own); t.clear(); for (const y of items) t.add(y); return t; }
    if (x instanceof Map) { const t = r ?? new Map(); done.set(x, t); const items = [...x].map(([k, y]) => [k, own(y)]); t.clear(); for (const [k, y] of items) t.set(k, y); return t; }
    const t = r ?? {}; done.set(x, t);
    const items = Object.keys(x).map(k => [k, own(x[k])]);
    for (const k of Object.keys(t)) if (!(k in x)) delete t[k];
    for (const [k, y] of items) t[k] = y;
    return t;
  };
  const touched = w => fx.changes.some(c => c.path === w || c.path.startsWith(`${w}.`) || w.startsWith(`${c.path}.`));
  for (const w of fx.writes) {
    if (!touched(w)) continue;
    const x = get(fx.after, keysOf(w));
    if (fx.adds.has(w)) { const cur = state.get(w); for (const y of x) cur.push(own(y)); continue; }
    state.set(w, own(x));
  }
}

export const hoursOf = (proc, v) => valueOf(proc.hours, v);
export const kcalOf = (proc, v) => valueOf(proc.kcal, v) || 150;
export const readyFor = (proc, v) => (proc.ready ? proc.ready(v) : true);

// A state over plain objects: namespaces map names to objects (or to functions giving them), and
// derived values ({ ns: { key: () => value } }) are worked out when asked for and can't be written.
// Any other name is looked up on base, whose top-level values can be replaced (a clock's hour, say).
export function stateOver(namespaces, derived = {}, base = null) {
  const root = ns => (ns in namespaces ? (typeof namespaces[ns] === 'function' ? namespaces[ns]() : namespaces[ns]) : base?.[ns]);
  return {
    get(path) {
      const [ns, ...ks] = keysOf(path);
      if (derived[ns]) { if (!ks.length) return Object.fromEntries(Object.entries(derived[ns]).map(([k, f]) => [k, f()])); const f = derived[ns][ks[0]]; return get(f?.(), ks.slice(1)); }
      return ks.length ? get(root(ns), ks) : root(ns);
    },
    set(path, value) {
      const [ns, ...ks] = keysOf(path);
      if (derived[ns]) throw new Error(`${path} is worked out from other state; it can't be set`);
      if (!ks.length) { // a whole namespace: usually its own object, brought into line already
        if (root(ns) === value) return;
        if (base && !(ns in namespaces)) base[ns] = value;
        else if (typeof namespaces[ns] !== 'function') namespaces[ns] = value;
        else throw new Error(`can't replace the whole of ${ns}`);
        return;
      }
      put(root(ns), ks, value);
    },
  };
}
