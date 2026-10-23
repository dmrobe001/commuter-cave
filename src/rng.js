// rng.js — seeded, forkable random streams.
//
// Every subsystem draws from its own named substream (rng.fork('plants/P3')),
// so adding or changing one part of the generator does not reshuffle the
// random numbers seen by unrelated parts. Same seed + same version = same world.

export function hashString(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  const label = String(seed);
  let state = hashString(label);

  function next() { // mulberry32
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const rng = {
    seed: label,
    next,
    uniform: (a = 0, b = 1) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor((b - a + 1) * next()),
    normal(mu = 0, sd = 1) {
      let u = next();
      while (u <= 1e-12) u = next();
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    logNormal: (median, spread) => median * Math.exp(spread * rng.normal()),
    chance: p => next() < p,
    pick: arr => arr[Math.floor(next() * arr.length)],
    weighted(pairs) {
      const total = pairs.reduce((s, [, w]) => s + Math.max(0, w), 0);
      let r = next() * total;
      for (const [v, w] of pairs) {
        r -= Math.max(0, w);
        if (r <= 0) return v;
      }
      return pairs[pairs.length - 1][0];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    fork: sub => makeRng(`${label}/${sub}`),
    copy() { const r = makeRng(label); r.restore(state); return r; }, // the same stream from here on: draws exactly as this one would
    restore(s) { state = s; },
  };
  return rng;
}

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
