// act.js — the common shape of every process, and the machinery that runs one: a process reads the state
// it declares, and what it would change comes back as a log of changes, which common machinery applies.
//
// A process is a record:
//   { id, name,
//     reads:  ['here.water', 'clock.now', 'core.props', ...],   what it looks at
//     writes: ['body.hyd', 'body.pendingSick', ...],           what it may change
//     hours, kcal,                    time and effort: numbers, or functions of the view
//     ready(v)                        optional: true, or the words for why it can't be done now
//     run(v, dice) → { make, use, say, report } }
// A path is a namespace and then properties. The namespaces are whatever the game supplies: its state
// (body, site, here, sky, ground, clock, mem, sites, day, ...) and the things bound to the job by slot
// name (core, hammer, food). 'world.…' and 'L.…' are the generated world and land, constant through
// play, handed over as they are.
//
// A transaction (begin) runs a process on the live state without copying it. The view v is a layer over
// the state: reading goes straight through, and writing goes into the transaction's own record of
// changes, which later reads in the same run see (so a process working step by step sees its own
// work). Nothing touches the state until the record is committed. Then the state's own objects take the
// new values in place (so whatever else holds them still does, and a thing reachable two ways stays one
// thing), and what they held before is kept, so the change can be undone and done again (revert,
// reapply): to run an action again as it was, with other dice, and put things back after. Discarding a
// transaction costs nothing. Reading or writing a path the process hasn't declared throws, at the moment
// it happens.
//
// What a run did (changes) is read off its record: { path, from, to } for a value replaced, { path,
// added, removed } for things added to a list or set, { path, cells } for cells of a grid changed. What
// it read (reads) is kept too: every plain value it looked at, by path. Its draws are the numbers its
// luck produced, noted as it goes (dice.note): what the range of outcomes is worked out from (spread.js).
//
// The dice: dice.act is this attempt's luck; dice.place(key) is chance fixed by where (a cell's
// population): the same key always gives the same draws; dice.note(kind, id, fields) records a draw.
//
// Some state isn't the process's business at all: caches, version counters for redrawing, what the
// screen shows. Live keys ({ has, get, set }) read and write those straight through at the top of the
// view, outside the record. The dice can be one of them (a run that asks for 'rng' gets dice.act).

const DELETED = Symbol('deleted');
const CONSTANT = new Set(['world', 'L']);
const isConstant = p => CONSTANT.has(p.split('.')[0]);
const bare = p => p.replace(/^\+/, '');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlain = x => x !== null && typeof x === 'object' && (Array.isArray(x) || Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const MUTATING = { Set: new Set(['add', 'delete', 'clear']), Map: new Set(['set', 'delete', 'clear']), Grid: new Set(['set', 'fill', 'copyWithin', 'sort', 'reverse']) };
const valueOf = (x, v) => (typeof x === 'function' ? x(v) : x ?? 0);
const isIndex = k => typeof k === 'string' && k.length > 0 && k.charCodeAt(0) >= 48 && k.charCodeAt(0) <= 57;
// A set, map or grid seen through a transaction, as it stands, for reading in a tight loop (a grid read
// cell by cell, thousands of times). Not to be written to.
const BACKING = new WeakMap();
export const readable = x => (x && BACKING.has(x) ? BACKING.get(x)() : x);

// Every path the process declares, without ones already covered by a shorter path.
export function pathsOf(proc) {
  const all = [...new Set([...(proc.reads ?? []), ...(proc.writes ?? [])].map(bare))].sort((a, b) => a.length - b.length);
  return all.filter((p, i) => !all.slice(0, i).some(q => p.startsWith(`${q}.`)));
}

// A state over plain objects: namespaces map names to objects (or to functions giving them, worked out
// once per transaction); derived namespaces ({ ns: { key: () => value } }) are worked out key by key as
// they're asked for, and can't be written. Any other name is looked up on base, whose top-level values
// can be replaced (the clock's hour, say).
export function stateOver(namespaces, derived = {}, base = null) {
  return {
    base,
    isBase: k => !(k in namespaces) && !(k in derived) && !!base,
    has: k => k in namespaces || k in derived || (!!base && k in base),
    root(k) {
      if (k in derived) { // worked out when first asked for, then kept for the run
        const o = {};
        for (const [key, f] of Object.entries(derived[k])) Object.defineProperty(o, key, { get() { const x = f(); Object.defineProperty(o, key, { value: x, enumerable: true }); return x; }, enumerable: true, configurable: true });
        return o;
      }
      if (k in namespaces) return typeof namespaces[k] === 'function' ? namespaces[k]() : namespaces[k];
      return base?.[k];
    },
    get(path) { const [k, ...ks] = path.split('.'); return ks.reduce((a, x) => (a == null ? undefined : a[x]), this.root(k)); },
  };
}

// A deep plain copy of a value as it stands in a transaction (for reports: never put back in the state).
function snap(x, tx, depth = 0, seen = new Map()) {
  if (x === null || typeof x !== 'object') return x;
  if (tx.targetOf.has(x)) return snap(tx.targetOf.get(x), tx, depth, seen);
  if (seen.has(x)) return seen.get(x);
  if (ArrayBuffer.isView(x)) return `(${x.length} cells)`;
  if (depth > 6) return '…';
  const e = tx.over.get(x), back = e?.clone ?? x;
  if (back instanceof Set) return [...back].map(y => snap(y, tx, depth + 1, seen));
  if (back instanceof Map) return Object.fromEntries([...back].map(([k, y]) => [k, snap(y, tx, depth + 1, seen)]));
  if (Array.isArray(x)) { const out = []; seen.set(x, out); const n = tx.read(x, 'length'); for (let i = 0; i < n; i++) out.push(snap(tx.read(x, String(i)), tx, depth + 1, seen)); return out; }
  const out = {}; seen.set(x, out);
  for (const k of tx.keysOf(x)) out[k] = snap(tx.read(x, k), tx, depth + 1, seen);
  return out;
}
// the same, of the state as it was before the transaction
const before = tx => ({ targetOf: tx.targetOf, over: new Map(), read: (o, k) => o[k], keysOf: o => Object.keys(o) });

// Begin a transaction for proc over state. The view is tx.v.
export function begin(proc, state, { live = null } = {}) {
  const declared = pathsOf(proc), writable = (proc.writes ?? []).map(bare), system = { on: false };
  const okRead = new Map(), okWrite = new Map();
  const mayRead = full => { let r = okRead.get(full); if (r === undefined) { r = isConstant(full) || declared.some(p => full === p || full.startsWith(`${p}.`) || p.startsWith(`${full}.`)); okRead.set(full, r); } return r; };
  const mayWrite = full => { let r = okWrite.get(full); if (r === undefined) { r = writable.some(w => full === w || full.startsWith(`${w}.`)); okWrite.set(full, r); } return r; };
  const id = proc.id;
  const tx = {
    over: new Map(), // the state's object → { path, keys: Map(key → value | DELETED), clone (a set, map or grid changed whole) }
    proxies: new Map(), // the state's object → Map(path → its proxy)
    targetOf: new WeakMap(), // proxy → the state's object
    reads: new Map(), // path → plain value read (the first time)
    fresh: new WeakSet(), // things made in this run and put into the state: the run's own, never wrapped (so they stay themselves)
    state, closed: false, system, undo: null,
  };
  const entry = (t, path) => { let e = tx.over.get(t); if (!e) tx.over.set(t, e = { path, keys: new Map(), clone: null }); return e; };
  tx.read = (t, k) => { const e = tx.over.get(t); if (e?.keys.has(k)) { const x = e.keys.get(k); return x === DELETED ? undefined : x; } return t[k]; };
  tx.has = (t, k) => { const e = tx.over.get(t); if (e?.keys.has(k)) return e.keys.get(k) !== DELETED; return k in t; };
  tx.keysOf = t => {
    const e = tx.over.get(t);
    if (Array.isArray(t)) { const n = tx.read(t, 'length'); return Array.from({ length: n }, (_, i) => String(i)).filter(i => tx.has(t, i)); }
    const ks = Object.keys(t).filter(k => !(e?.keys.get(k) === DELETED));
    if (e) for (const [k, x] of e.keys) if (x !== DELETED && !own(t, k) && typeof k === 'string') ks.push(k);
    return ks;
  };
  const unwrap = x => {
    if (x === null || typeof x !== 'object') return x;
    if (tx.targetOf.has(x)) return tx.targetOf.get(x);
    if (!tx.proxies.has(x) && !tx.over.has(x)) tx.fresh.add(x); // new to the state: the run's own
    return x;
  };
  const check = (ok, full, what) => { if (!system.on && !tx.closed && !ok(full)) throw new Error(`${id} ${what} ${full} without declaring it`); };
  const logRead = (full, x) => { if (tx.reads.size < 4000 && !tx.reads.has(full) && (x === null || typeof x !== 'object')) tx.reads.set(full, x); };

  function wrap(x, path) {
    if (x === null || typeof x !== 'object' || tx.targetOf.has(x) || tx.fresh.has(x) || isConstant(path)) return x;
    let byPath = tx.proxies.get(x);
    if (!byPath) tx.proxies.set(x, byPath = new Map());
    let p = byPath.get(path);
    if (p) return p;
    const collection = x instanceof Set || x instanceof Map || ArrayBuffer.isView(x);
    p = new Proxy(x, collection ? whole(x, path) : layered(path));
    if (collection) BACKING.set(p, () => (tx.closed ? x : tx.over.get(x)?.clone ?? x));
    byPath.set(path, p);
    tx.targetOf.set(p, x);
    return p;
  }
  // plain objects and lists: key by key
  function layered(path) {
    const at = k => (path ? `${path}.${String(k)}` : String(k));
    return {
      get(t, k, recv) {
        if (typeof k === 'symbol') return Reflect.get(t, k, recv);
        if (tx.closed) return t[k];
        const mine = tx.over.get(t)?.keys.has(k) || own(t, k);
        if (!mine && (k in Object.prototype || (Array.isArray(t) && k in Array.prototype))) return Reflect.get(t, k, recv); // a method, not a value
        const full = at(k);
        check(mayRead, full, 'read');
        const x = tx.read(t, k);
        if (typeof x === 'function') return x;
        logRead(full, x);
        return wrap(x, full);
      },
      set(t, k, x) {
        if (tx.closed) { t[k] = unwrap(x); return true; }
        const full = at(k);
        if (typeof k !== 'symbol') check(mayWrite, full, 'changed');
        const e = entry(t, path);
        e.keys.set(k, unwrap(x));
        if (Array.isArray(t) && isIndex(k) && Number(k) >= tx.read(t, 'length')) e.keys.set('length', Number(k) + 1);
        return true;
      },
      deleteProperty(t, k) {
        if (tx.closed) { delete t[k]; return true; }
        check(mayWrite, at(k), 'changed');
        entry(t, path).keys.set(k, DELETED);
        return true;
      },
      has: (t, k) => (tx.closed || typeof k === 'symbol' ? k in t : tx.has(t, k)),
      ownKeys(t) { return tx.closed ? Reflect.ownKeys(t) : Array.isArray(t) ? [...tx.keysOf(t), 'length'] : tx.keysOf(t); },
      getOwnPropertyDescriptor(t, k) {
        if (tx.closed) return Reflect.getOwnPropertyDescriptor(t, k);
        const d = Reflect.getOwnPropertyDescriptor(t, k), e = tx.over.get(t);
        if (!e?.keys.has(k)) return d;
        const x = e.keys.get(k);
        if (x === DELETED) return undefined;
        if (d) return { ...d, value: x };
        return { value: x, writable: true, enumerable: true, configurable: true };
      },
      defineProperty(t, k, desc) { return this.set(t, k, desc.value); },
    };
  }
  // sets, maps and grids: changed whole, on a copy made at the first change
  function whole(x, path) {
    const kind = x instanceof Set ? 'Set' : x instanceof Map ? 'Map' : 'Grid';
    const back = t => (tx.closed ? t : tx.over.get(t)?.clone ?? t);
    const mine = t => { const e = entry(t, path); if (!e.clone) e.clone = kind === 'Set' ? new Set(t) : kind === 'Map' ? new Map(t) : t.slice(); return e.clone; };
    return {
      get(t, k) {
        if (k === 'size' || k === 'length') return back(t)[k];
        if (isIndex(k)) return back(t)[k];
        const f = back(t)[k];
        if (typeof f !== 'function') return f;
        if (MUTATING[kind].has(k) && !tx.closed) return (...a) => { check(mayWrite, path, 'changed'); return mine(t)[k](...a.map(unwrap)); };
        return f.bind(back(t));
      },
      set(t, k, v) {
        if (tx.closed) { t[k] = v; return true; }
        check(mayWrite, path, 'changed');
        mine(t)[k] = v;
        return true;
      },
      has: (t, k) => k in back(t),
    };
  }

  // the top of the view: live keys straight through; namespaces and the bound things; the state's own keys
  const roots = new Map();
  tx.v = new Proxy({}, {
    get(_, k) {
      if (typeof k === 'symbol') return undefined;
      if (live?.has(k)) return live.get(k);
      if (isConstant(k)) return state.root(k);
      check(mayRead, k, 'read');
      if (state.isBase(k)) { const x = tx.read(state.base, k); logRead(k, x); return wrap(x, k); }
      if (!roots.has(k)) roots.set(k, state.root(k));
      const x = roots.get(k);
      logRead(k, x);
      return wrap(x, k);
    },
    set(_, k, x) {
      if (live?.has(k)) { live.set(k, x); return true; }
      if (!state.isBase(k)) throw new Error(`${id} can't replace the whole of ${k}`);
      check(mayWrite, k, 'changed');
      entry(state.base, '').keys.set(k, unwrap(x));
      return true;
    },
    has: (_, k) => !!live?.has(k) || state.has(k),
  });

  // Put proxies found in what's being committed back to the things they stand for (a new thing made in
  // the run may hold some): down through new things only, not through the state's own.
  const settle = (x, seen = new Set(), depth = 0) => {
    if (x === null || typeof x !== 'object') return x;
    if (tx.targetOf.has(x)) return tx.targetOf.get(x);
    if (depth > 6 || seen.has(x) || tx.over.has(x) || tx.proxies.has(x) || !isPlain(x)) return x;
    seen.add(x);
    for (const k of Object.keys(x)) { const y = settle(x[k], seen, depth + 1); if (y !== x[k]) x[k] = y; }
    return x;
  };
  const put = (t, values, clone) => {
    if (clone) {
      if (t instanceof Set) { t.clear(); for (const y of clone) t.add(settle(y)); } else if (t instanceof Map) { t.clear(); for (const [k, y] of clone) t.set(k, settle(y)); } else t.set(clone);
      return;
    }
    let len;
    for (const [k, y] of values) { if (Array.isArray(t) && k === 'length') { len = y; continue; } if (y === DELETED) delete t[k]; else t[k] = settle(y); }
    if (len !== undefined) t.length = len === DELETED ? 0 : len;
  };
  // Make the changes, keeping what was there before.
  tx.commit = () => {
    if (tx.closed) throw new Error(`${id}: transaction already over`);
    tx.undo = [...tx.over].map(([t, e]) => ({ t, e,
      was: e.clone ? (t instanceof Set ? new Set(t) : t instanceof Map ? new Map(t) : t.slice()) : new Map([...e.keys.keys()].map(k => [k, own(t, k) ? t[k] : DELETED])) }));
    tx.closed = true;
    for (const { t, e } of tx.undo) put(t, e.keys, e.clone);
    return tx;
  };
  tx.discard = () => { tx.closed = true; return tx; };
  tx.revert = () => { for (const { t, e, was } of [...tx.undo].reverse()) put(t, e.clone ? null : was, e.clone ? was : null); return tx; };
  tx.reapply = () => { for (const { t, e } of tx.undo) put(t, e.keys, e.clone); return tx; };
  tx.system = f => { const was = system.on; system.on = true; try { return f(); } finally { system.on = was; } };

  // What the run changed, as a list: per key of a plain object, per thing added to a list or set, per grid.
  tx.changes = () => {
    const out = [], old = before(tx);
    for (const [t, e] of tx.over) {
      const at = k => (e.path ? `${e.path}.${k}` : k);
      if (e.clone) {
        if (t instanceof Set) { const added = [...e.clone].filter(y => !t.has(y)), removed = [...t].filter(y => !e.clone.has(y)); if (added.length || removed.length) out.push({ path: e.path, added: added.map(y => snap(y, tx)), removed: removed.map(y => snap(y, tx)) }); }
        else if (t instanceof Map) out.push({ path: e.path, from: t.size, to: e.clone.size });
        else { let n = 0; for (let i = 0; i < t.length; i++) if (t[i] !== e.clone[i]) n++; if (n) out.push({ path: e.path, cells: n }); }
        continue;
      }
      if (Array.isArray(t)) {
        const n = tx.read(t, 'length'), now = Array.from({ length: n }, (_, i) => tx.read(t, String(i)));
        if (n >= t.length && t.every((y, i) => y === now[i])) { if (n > t.length) out.push({ path: e.path, added: now.slice(t.length).map(y => snap(y, tx)), removed: [] }); }
        else if (n === t.length) now.forEach((y, i) => { if (y !== t[i]) out.push({ path: at(i), from: snap(t[i], old), to: snap(y, tx) }); });
        else out.push({ path: e.path, from: snap(t, old), to: snap(now, tx) });
        continue;
      }
      for (const [k, y] of e.keys) {
        if (typeof k === 'symbol') continue;
        const was = own(t, k) ? t[k] : undefined, is = y === DELETED ? undefined : y;
        if (was !== is) out.push({ path: at(k), from: snap(was, old), to: snap(is, tx) });
      }
    }
    return out;
  };
  return tx;
}

// Run a process in a transaction on state, with dice: { id, changes, make, use, say, report, draws,
// reads, tx }, nothing yet committed. finish(v, fx) is the game's own machinery for what was made and
// used up and said, run in the same transaction (so undoing the action undoes those too).
export function attempt(proc, state, dice, { live = null, finish = null } = {}) {
  const tx = begin(proc, state, { live }), draws = [];
  const d = { ...dice, note: (kind, id, fields = {}) => { draws.push({ ...fields, kind, id: String(id) }); } };
  let out;
  try { out = proc.run(tx.v, d) ?? {}; } catch (e) { tx.discard(); throw e; }
  const say = (out.say ?? []).map(l => (Array.isArray(l) ? l : [l, 'act']));
  const fx = { id: proc.id, make: out.make ?? [], use: out.use ?? [], say, report: out.report ?? null, draws, tx, reads: tx.reads };
  fx.changes = tx.changes(); // before the machinery's own writes: what the process itself did
  if (finish) tx.system(() => finish(tx.v, fx));
  return fx;
}

export const hoursOf = (proc, v) => valueOf(proc.hours, v);
export const kcalOf = (proc, v) => valueOf(proc.kcal, v) || 150;
export const readyFor = (proc, v) => (proc.ready ? proc.ready(v) : true);
// A look at what a process would read, to check it can be done and how long it takes: a transaction
// that's thrown away.
export function peek(proc, state, f) { const tx = begin(proc, state); try { return f(tx.v); } finally { tx.discard(); } }
