// landscape.js — a 10 km square of real geography, generated from the seed.
//
//   elevation  layered value noise × relief, a regional tilt, and (in rugged worlds) escarpment steps
//   drainage   priority-flood depression filling → lakes; steepest-descent routing; flow accumulation
//   streams    where upslope area exceeds a threshold set by the water balance (brook / stream / river)
//   wetness    topographic wetness index, ln(upslope area / slope)
//   vegetation tree cover × wetness × noise, thinned on steep ground, thickened along water
//   features   hills (by prominence), escarpments, waterfalls and cascades (one per steep run), lakes, spring heads
//   micro      every cell gets a microhabitat from its position
//   spawn      a land cell near the middle, within reach of fresh water

import { makeRng, clamp } from './rng.js';

export const N = 128;          // cells per side
export const CELL = 10000 / N; // metres per cell (~78 m)
const idx = (x, y) => y * N + x;
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIST = NB.map(([dx, dy]) => Math.hypot(dx, dy) * CELL);

// ------------------------------------------------------------ noise

function makeNoise(rng) {
  const P = 512, perm = new Uint16Array(P * 2), val = new Float32Array(P);
  for (let i = 0; i < P; i++) { perm[i] = i; val[i] = rng.next(); }
  for (let i = P - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < P; i++) perm[i + P] = perm[i];
  const lat = (x, y) => val[perm[(perm[x & (P - 1)] + y) & (P - 1)]];
  const s = t => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = s(x - x0), fy = s(y - y0);
    const a = lat(x0, y0), b = lat(x0 + 1, y0), c = lat(x0, y0 + 1), d = lat(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y, oct = 5) => {
    let sum = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { sum += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; }
    return sum / norm;
  };
}

// ------------------------------------------------------------ priority queue (min-heap)

class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], last = k.length - 1;
    k[0] = k[last]; v[0] = v[last]; k.pop(); v.pop();
    let i = 0;
    for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r;
      if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; }
    return top;
  }
  get size() { return this.k.length; }
}

// ------------------------------------------------------------ generation

export function generateLandscape(world) {
  const env = world.environment;
  const rng = makeRng(`${world.seed}/landscape`);
  const fbm = makeNoise(rng.fork('elev')), fbm2 = makeNoise(rng.fork('step')), fbmV = makeNoise(rng.fork('veg'));
  const relief = env.relief;
  const A = 30 + 380 * relief ** 1.5;                 // local relief, metres
  const tilt = rng.uniform(0, 2 * Math.PI), tiltAmt = 0.25 * A;

  // elevation
  const elev = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let e = A * fbm(x / 45, y / 45, 6);
    // short-wavelength ridged relief, stronger in rugged country (hills and valleys at the 1 km scale)
    const rdg = 1 - Math.abs(2 * fbm2(x / 14 + 50, y / 14 + 50, 4) - 1);
    e += A * 0.45 * relief * rdg * rdg;
    if (relief > 0.4) { // escarpments: a sharp step where a second noise field crosses its midline
      const t = fbm2(x / 60, y / 60, 3);
      e += A * 0.6 * (relief - 0.3) / 0.7 / (1 + Math.exp(-(t - 0.5) * 90));
    }
    e += tiltAmt * ((x / N - 0.5) * Math.cos(tilt) + (y / N - 0.5) * Math.sin(tilt));
    elev[idx(x, y)] = e;
  }

  // priority-flood: fill depressions (water exits at the edges); remember how deep each fill is
  const filled = new Float32Array(elev), done = new Uint8Array(N * N), heap = new Heap();
  for (let x = 0; x < N; x++) for (const y of [0, N - 1]) { heap.push(elev[idx(x, y)], idx(x, y)); done[idx(x, y)] = 1; }
  for (let y = 1; y < N - 1; y++) for (const x of [0, N - 1]) { heap.push(elev[idx(x, y)], idx(x, y)); done[idx(x, y)] = 1; }
  const order = [];
  while (heap.size) {
    const c = heap.pop(); order.push(c);
    const cx = c % N, cy = (c / N) | 0;
    for (const [dx, dy] of NB) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = idx(nx, ny);
      if (done[n]) continue;
      done[n] = 1;
      filled[n] = Math.max(elev[n], filled[c] + 1e-3); // tiny gradient across flats so water still moves
      heap.push(filled[n], n);
    }
  }

  // routing: each cell drains to its steepest downhill neighbour on the filled surface
  const down = new Int32Array(N * N).fill(-1), slope = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = idx(x, y); let best = 0, bi = -1, maxDrop = 0;
    NB.forEach(([dx, dy], k) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) return;
      const n = idx(nx, ny);
      const g = (filled[c] - filled[n]) / DIST[k];
      if (g > best) { best = g; bi = n; }
      maxDrop = Math.max(maxDrop, Math.abs(elev[c] - elev[n]) / DIST[k]);
    });
    down[c] = bi; slope[c] = maxDrop;
  }
  // flow accumulation: process from highest to lowest filled elevation
  const acc = new Float32Array(N * N).fill(1);
  for (let i = order.length - 1; i >= 0; i--) { const c = order[i]; if (down[c] >= 0) acc[down[c]] += acc[c]; }

  // lakes: depressions filled deeper than a threshold (dry climates keep only deep ones)
  // Raw noise terrain is pocked with closed basins that running water would long since have breached,
  // so only large, deep depressions hold lakes (and dry climates keep very few).
  const lakeDepth = env.water < 0.6 ? 0.2 * A : 4 + 0.06 * A;
  const lake = new Uint8Array(N * N);
  for (let c = 0; c < N * N; c++) if (filled[c] - elev[c] > lakeDepth) lake[c] = 1;
  const keep = new Uint8Array(N * N); // drop small basins
  { const seen = new Uint8Array(N * N);
    for (let c = 0; c < N * N; c++) { if (seen[c] || !lake[c]) continue; const g = [], st = [c]; seen[c] = 1;
      while (st.length) { const k = st.pop(); g.push(k); for (const [dx, dy] of NB) { const nx = (k % N) + dx, ny = ((k / N) | 0) + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue; const n = idx(nx, ny); if (!seen[n] && lake[n]) { seen[n] = 1; st.push(n); } } }
      if (g.length >= 10) for (const k of g) keep[k] = 1; } }
  lake.set(keep);

  // channels: upslope area over a threshold set by the water balance
  const Acrit = 160 / clamp(env.water, 0.3, 2); // ~1 km² of catchment in a temperate climate
  const chan = new Uint8Array(N * N); // 0 none, 1 brook, 2 stream, 3 river
  for (let c = 0; c < N * N; c++) {
    if (lake[c] || acc[c] < Acrit) continue;
    chan[c] = acc[c] < 5 * Acrit ? 1 : acc[c] < 40 * Acrit ? 2 : 3;
  }

  // wetness index and vegetation
  const twi = new Float32Array(N * N);
  let tmin = Infinity, tmax = -Infinity;
  for (let c = 0; c < N * N; c++) { twi[c] = Math.log((acc[c] * CELL) / Math.max(slope[c], 0.002)); tmin = Math.min(tmin, twi[c]); tmax = Math.max(tmax, twi[c]); }
  const nearWater = distanceField(c => chan[c] > 0 || lake[c]);
  const veg = new Float32Array(N * N), wet = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = idx(x, y);
    wet[c] = (twi[c] - tmin) / (tmax - tmin);
    const riparian = nearWater[c] < 2 ? 0.2 : 0;
    veg[c] = clamp(env.treeCover * 1.15 + 0.35 * (wet[c] - 0.45) + 0.35 * (fbmV(x / 20, y / 20, 4) - 0.5) - 1.5 * Math.max(0, slope[c] - 0.2) + riparian);
  }

  // features
  const features = { hills: [], waterfalls: [], springs: [], lakes: [], escarpments: [] };
  const steep = new Uint8Array(N * N);
  for (let y = 4; y < N - 4; y++) for (let x = 4; x < N - 4; x++) { // hills: local maxima with prominence
    const c = idx(x, y); let isMax = true, lo = Infinity;
    for (let dy = -7; dy <= 7 && isMax; dy++) for (let dx = -7; dx <= 7; dx++) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const e = elev[idx(nx, ny)];
      if (e > elev[c]) { isMax = false; break; }
      lo = Math.min(lo, e);
    }
    const prom = elev[c] - lo;
    if (isMax && prom > Math.max(12, 0.15 * A)) features.hills.push({ x, y, elev: elev[c], prominence: prom });
  }
  for (let c = 0; c < N * N; c++) {
    if (chan[c] && down[c] >= 0 && chan[c] >= 2 && elev[c] - elev[down[c]] > 8) steep[c] = 1; // a steep drop along the channel
    if (chan[c]) { // spring heads: channel cells with no channel draining into them, on sloping ground
      const cx = c % N, cy = (c / N) | 0;
      const fed = NB.some(([dx, dy]) => { const nx = cx + dx, ny = cy + dy; return nx >= 0 && ny >= 0 && nx < N && ny < N && down[idx(nx, ny)] === c && (chan[idx(nx, ny)] || lake[idx(nx, ny)]); }); // fed by a stream, or by a lake (an outlet, not a spring)
      if (!fed && slope[c] > 0.04) features.springs.push({ x: cx, y: cy });
    }
  }
  // A run of adjacent steep channel cells is one feature, placed at its steepest cell. At ~78 m cells a
  // true waterfall is sub-grid, so only a large single-cell drop counts as falls; the rest are cascades.
  features.waterfalls = components(c => steep[c] === 1).map(g => {
    const drops = g.map(p => { const c = idx(p.x, p.y); return { ...p, drop: elev[c] - elev[down[c]], size: chan[c] }; });
    const top = drops.reduce((a, b) => (b.drop > a.drop ? b : a));
    return { x: top.x, y: top.y, drop: Math.round(top.drop * 10) / 10, totalDrop: Math.round(drops.reduce((a, b) => a + b.drop, 0)), cells: g.length, size: top.size, kind: top.drop > 20 ? 'falls' : 'cascade' };
  });
  features.lakes = components(c => lake[c] === 1).filter(g => g.length >= 3).map(g => ({ cells: g.length, x: avg(g, 'x'), y: avg(g, 'y'), areaHa: Math.round(g.length * CELL * CELL / 1e4) }));
  features.escarpments = components(c => slope[c] > 0.35).filter(g => g.length >= 6).map(g => ({ cells: g.length, x: avg(g, 'x'), y: avg(g, 'y') }));

  // microhabitat for every cell
  const micro = new Array(N * N);
  const springSet = new Set(features.springs.map(s => idx(s.x, s.y)));
  const nearLake = distanceField(c => lake[c] === 1);
  const bigChan = distanceField(c => chan[c] >= 2);
  const nearChanBig = c => bigChan[c] <= 1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = idx(x, y);
    let m;
    if (lake[c]) m = 'lake';
    else if (springSet.has(c) && env.relief > 0.2) m = 'spring';
    else if (chan[c] >= 2) m = 'streambed';
    else if (chan[c] === 1 || (nearWater[c] <= 1 && nearChanBig(c))) m = env.clayPresent && slope[c] > 0.12 ? 'claybank' : 'streambank';
    else if (nearLake[c] <= 1) m = 'pond';
    else if (slope[c] > 0.35) m = relief > 0.45 ? 'scree' : 'outcrop';
    else if (slope[c] > 0.22) m = 'outcrop';
    else m = veg[c] > 0.5 ? 'woodland' : veg[c] > 0.28 ? 'edge' : 'glade';
    micro[c] = m;
  }

  // spawn: near the middle, on land, within ~1 km of fresh water (accessible early game)
  const waterDist = distanceField(c => chan[c] > 0 || lake[c] === 1 || springSet.has(c));
  let spawn = null, bestScore = Infinity;
  const srng = rng.fork('spawn');
  for (let tries = 0; tries < 4000; tries++) {
    const x = 20 + Math.floor(srng.next() * (N - 40)), y = 20 + Math.floor(srng.next() * (N - 40));
    const c = idx(x, y);
    if (lake[c] || chan[c] >= 2) continue;
    const dW = waterDist[c] * CELL;
    if (dW > 1000 || dW < 100) continue;
    const score = Math.hypot(x - N / 2, y - N / 2) + srng.next() * 10;
    if (score < bestScore) { bestScore = score; spawn = { x, y, waterM: Math.round(dW) }; }
  }

  return { N, CELL, A, elev, filled, acc, down, slope, chan, lake, wet, veg, micro, features, spawn, waterDist };

  // --- helpers (closures over the grids above)
  function distanceField(isSource) { // breadth-first distance in cells
    const d = new Float32Array(N * N).fill(Infinity), q = [];
    for (let c = 0; c < N * N; c++) if (isSource(c)) { d[c] = 0; q.push(c); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % N, cy = (c / N) | 0;
      for (const [dx, dy] of NB) {
        const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const n = idx(nx, ny); const nd = d[c] + Math.hypot(dx, dy);
        if (nd < d[n]) { d[n] = nd; q.push(n); }
      }
    }
    return d;
  }
  function components(test) {
    const seen = new Uint8Array(N * N), out = [];
    for (let c = 0; c < N * N; c++) {
      if (seen[c] || !test(c)) continue;
      const g = [], st = [c]; seen[c] = 1;
      while (st.length) {
        const k = st.pop(); g.push({ x: k % N, y: (k / N) | 0 });
        for (const [dx, dy] of NB) {
          const nx = (k % N) + dx, ny = ((k / N) | 0) + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const n = idx(nx, ny); if (!seen[n] && test(n)) { seen[n] = 1; st.push(n); }
        }
      }
      out.push(g);
    }
    return out;
  }
}
const avg = (g, k) => Math.round(g.reduce((s, p) => s + p[k], 0) / g.length);

// Microhabitat shares over the whole square, for comparison with the environment's expectations.
export function microShares(L) {
  const counts = {};
  for (const m of L.micro) counts[m] = (counts[m] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(1000 * v / (N * N)) / 10]));
}
