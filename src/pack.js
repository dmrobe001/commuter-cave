// pack.js — generated data to text and back, keeping what JSON loses: grids (typed arrays, as
// base64), NaN and ±Infinity, keys holding undefined, and things reachable two ways (packed once,
// referred to after). For keeping generated worlds between runs (see checkWorld in game.js). Plain
// objects, lists and grids only: no functions, maps or sets.

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const t = atob(s), b = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return b; };
const GRIDS = { Float32Array, Float64Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray };

export function pack(root) {
  const count = new Map();
  const tally = x => { if (x === null || typeof x !== 'object') return; count.set(x, (count.get(x) ?? 0) + 1); if (count.get(x) > 1 || ArrayBuffer.isView(x)) return; for (const v of Object.values(x)) tally(v); };
  tally(root);
  const ids = new Map();
  const enc = x => {
    if (typeof x === 'number' && !Number.isFinite(x)) return { $n: String(x) };
    if (x === undefined) return { $u: 1 }; // a key that's there but empty stays there
    if (x === null || typeof x !== 'object') return x;
    if (ids.has(x)) return { $ref: ids.get(x) };
    let v;
    if (count.get(x) > 1) ids.set(x, ids.size);
    if (ArrayBuffer.isView(x)) v = { $t: x.constructor.name, d: b64(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)) };
    else if (Array.isArray(x)) v = x.map(enc);
    else { v = {}; for (const [k, y] of Object.entries(x)) v[k] = enc(y); }
    return ids.has(x) ? { $def: ids.get(x), v } : v;
  };
  return JSON.stringify(enc(root));
}

export function unpack(text) {
  const defs = [];
  const dec = x => {
    if (x === null || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(dec);
    if ('$n' in x) return Number(x.$n);
    if ('$u' in x) return undefined;
    if ('$ref' in x) return defs[x.$ref];
    if ('$t' in x) { const b = unb64(x.d); return new GRIDS[x.$t](b.buffer, 0, b.byteLength / GRIDS[x.$t].BYTES_PER_ELEMENT); }
    if ('$def' in x) { // made before its insides, so a thing that holds itself (or holds one that holds it) comes back whole
      const v = x.v, out = Array.isArray(v) ? [] : ('$t' in v ? null : {});
      if (out === null) { defs[x.$def] = dec(v); return defs[x.$def]; }
      defs[x.$def] = out;
      if (Array.isArray(v)) for (const y of v) out.push(dec(y)); else for (const [k, y] of Object.entries(v)) out[k] = dec(y);
      return out;
    }
    const o = {};
    for (const [k, y] of Object.entries(x)) o[k] = dec(y);
    return o;
  };
  return dec(JSON.parse(text));
}
