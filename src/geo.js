// geo.js — perceiving and moving through the landscape.
//
//   sight     line of sight over the terrain; canopy attenuates light roughly exponentially with
//             depth of foliage crossed (Beer–Lambert); features must also be big enough at their distance
//   sound     each water source has an audible range, shortened by vegetation, lengthened at dawn,
//             dusk and night; what is heard is an acoustic panorama (loudness by direction), whose
//             peaks are the percepts; nearby water masks the rest
//   lookouts  open high ground; the viewshed from there reveals lakes, river traces, hills, cliffs
//   walking   greedy steps toward a believed target with accumulating heading error; Tobler's hiking
//             function for speed against slope, slowed by vegetation; lakes are walked around
//   spawn     chosen so that a lookout is findable from it and water is visible from the lookout

import { makeRng, clamp } from './rng.js';
import { N, CELL } from './landscape.js';

const idx = (x, y) => y * N + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const bearingWord = deg => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
export const bearing = (a, b) => ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI + 360) % 360; // 0 = north
export const distM = (a, b) => Math.hypot(b.x - a.x, b.y - a.y) * CELL;
const CANOPY_H = 18; // metres of canopy at full vegetation

// ------------------------------------------------------------ sight

// Fraction of light reaching the target: 0 if terrain blocks, reduced by canopy along the way.
// `fromEdge`: looking out from the edge of my own cell (as at a shore), so its trees don't count.
export function sightline(L, a, b, eyeH = 1.7, targetH = 2, { fromEdge = false } = {}) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(2, Math.ceil(d * 2));
  const e0 = L.elev[idx(a.x, a.y)] + eyeH + CANOPY_H * 0.15 * L.veg[idx(a.x, a.y)] * 0; // eye height above ground
  const e1 = L.elev[idx(b.x, b.y)] + targetH;
  let trans = 1;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const c = idx(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t));
    const line = e0 + (e1 - e0) * t;
    if (L.elev[c] > line) return 0;
    if (fromEdge && c === idx(a.x, a.y)) continue;
    if (!L.lake[c] && L.elev[c] + CANOPY_H * L.veg[c] > line) trans *= Math.exp(-1.2 * L.veg[c] * (CELL / 2) / 40); // no trees on open water
    if (trans < 0.01) return 0;
  }
  return trans;
}

// Visual and audible landmarks, extracted once per landscape.
export function landmarks(L) {
  if (L._landmarks) return L._landmarks;
  const V = [], A = [];
  L.features.hills.forEach((h, i) => V.push({ key: `hill-${i}`, kind: 'hill', x: h.x, y: h.y, size: h.prominence, targetH: 2 }));
  L.features.escarpments.forEach((e, i) => V.push({ key: `cliff-${i}`, kind: 'cliff', x: e.x, y: e.y, size: 20 + e.cells, targetH: 2 }));
  // lakes: every few cells, so a lake is seen if any part is in view
  const lakeId = labelComponents(L, c => L.lake[c] === 1);
  for (let c = 0; c < N * N; c++) if (L.lake[c] && (c % 3 === 0)) V.push({ key: `lake-${lakeId[c]}`, kind: 'lake', x: c % N, y: (c / N) | 0, size: 40, targetH: 0.5, needHeight: true });
  const riverId = labelComponents(L, c => L.chan[c] >= 2);
  for (let c = 0; c < N * N; c++) if (L.chan[c] >= 2 && c % 4 === 0) V.push({ key: `river-${riverId[c]}`, kind: 'river trace', x: c % N, y: (c / N) | 0, size: 25, targetH: 6, needHeight: true });
  // small watercourses show as a green line where the land around them is dry and open
  const brookId = labelComponents(L, c => L.chan[c] === 1);
  for (let c = 0; c < N * N; c++) {
    if (L.chan[c] !== 1 || c % 3 !== 0) continue;
    const x = c % N, y = (c / N) | 0;
    let around = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (inside(x + dx, y + dy)) { around += L.veg[idx(x + dx, y + dy)]; n++; }
    if (around / n < 0.35) V.push({ key: `wash-${brookId[c]}`, kind: 'river trace', x, y, size: 18, targetH: 3, needHeight: true });
  }
  // sound sources (ranges in metres; rough orders of magnitude for tuning)
  L.features.waterfalls.forEach((w, i) => A.push({ key: `falls-${i}`, kind: w.kind, x: w.x, y: w.y, range: w.kind === 'falls' ? 2000 : 700 }));
  for (let c = 0; c < N * N; c++) {
    if (L.chan[c] === 3) A.push({ key: `river-${riverId[c]}`, kind: L.slope[c] > 0.04 ? 'rapids' : 'river', x: c % N, y: (c / N) | 0, range: L.slope[c] > 0.04 ? 900 : 400 });
    else if (L.chan[c] === 2 && c % 2 === 0) A.push({ key: `stream-${riverId[c]}`, kind: 'stream', x: c % N, y: (c / N) | 0, range: 200 });
    else if (L.chan[c] === 1 && c % 2 === 0) A.push({ key: `brook-${brookId[c]}`, kind: 'brook', x: c % N, y: (c / N) | 0, range: 70 });
  }
  for (let c = 0; c < N * N; c++) if (L.lake[c] && c % 7 === 0) A.push({ key: `lake-${lakeId[c]}`, kind: 'waterfowl', x: c % N, y: (c / N) | 0, range: 700, birds: true });
  return (L._landmarks = { V, A, lakeId, riverId, brookId });
}

// Which body of water a cell (or a landmark key) belongs to, for naming: every crossing of one
// connected stream system shares a name. Streams and rivers share a system; brooks are their own.
export function waterKeyAt(L, x, y) {
  const { lakeId, riverId, brookId } = landmarks(L), c = idx(x, y);
  if (L.lake[c]) return `lake-${lakeId[c]}`;
  if (L.chan[c] >= 2) return `river-${riverId[c]}`;
  if (L.chan[c] === 1) return `brook-${brookId[c]}`;
  return null;
}
export const waterKeyOf = key => key.replace(/^stream-/, 'river-').replace(/^wash-/, 'brook-');

// The character's guess at walking time along a straight line, from how the land looks along it.
export function lineHours(L, a, b) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  let h = 0, prev = { x: Math.round(a.x), y: Math.round(a.y) };
  for (let i = 1; i <= n; i++) {
    const q = { x: Math.round(a.x + (b.x - a.x) * i / n), y: Math.round(a.y + (b.y - a.y) * i / n) };
    if (!inside(q.x, q.y)) break;
    if (q.x === prev.x && q.y === prev.y) continue;
    h += stepHours(L, prev, q) * (L.lake[idx(q.x, q.y)] ? 1.6 : 1); // a lake in the way means going round
    prev = q;
  }
  return h;
}

// A cell is a lookout if it stands clear of its surroundings and isn't buried in forest.
export function lookoutScore(L, x, y) {
  let sum = 0, n = 0;
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { if (!inside(x + dx, y + dy)) continue; sum += L.elev[idx(x + dx, y + dy)]; n++; }
  const rise = L.elev[idx(x, y)] - sum / n;
  return rise / Math.max(20, 0.25 * L.A) - 0.8 * L.veg[idx(x, y)] + (L.features.hills.some(h => Math.abs(h.x - x) <= 1 && Math.abs(h.y - y) <= 1) ? 0.5 : 0);
}
export const isLookout = (L, x, y) => L.features.hills.some(h => Math.abs(h.x - x) <= 1 && Math.abs(h.y - y) <= 1) || lookoutScore(L, x, y) > 0.55;
// At a lookout you stand on rock or climb a tree: your eye is above the local canopy.
export const lookoutEye = (L, p) => Math.max(3, CANOPY_H * L.veg[idx(p.x, p.y)] + 2);

// ------------------------------------------------------------ perception

// What reaches an observer: [{ key, kind, channel, trueBearing, trueDist, strength }]
// `sky`: { far: how well shapes can be made out by this light (0..1), visibility: how far one sees
// through the air (m), hearing: what rain or wind leaves of hearing (0..1) } (sky.js); none: clear day.
export function perceive(L, pos, { time = 'day', lookout = false, boost = 1, sky = null } = {}) {
  const { V, A } = landmarks(L);
  const out = new Map();
  const eye = lookout ? lookoutEye(L, pos) : 1.7;
  const maxSight = lookout ? 7000 : 4000;
  for (const f of V) {
    const d = distM(pos, f);
    if (d < 1 || d > maxSight) continue; // everything but my own cell: a hill next door is seen next door
    // lakes and river traces need a view from above, except close by in open country
    const openHere = L.veg[idx(pos.x, pos.y)] < 0.4;
    if (f.needHeight && !lookout && !(d < 600 && openHere)) continue;
    const angular = f.size / d;
    if (angular < 0.004) continue;
    const t = sightline(L, pos, f, eye, f.targetH);
    const s = t * clamp(angular / 0.012) * Math.exp(-d / (lookout ? 12000 : 7000)) * (sky ? sky.far * Math.exp(-3 * d / sky.visibility) : 1); // haze; the light; fog, rain or snow in the air
    if (s > 0.12 / boost && (!out.has(f.key) || out.get(f.key).strength < s)) out.set(f.key, { key: f.key, kind: f.kind, channel: 'sight', trueBearing: bearing(pos, f), trueDist: d, strength: s, x: f.x, y: f.y });
  }
  for (const c of hear(L, pos, { time, boost: boost * (sky?.hearing ?? 1) })) if (!out.has(c.key) || out.get(c.key).strength < c.strength) out.set(c.key, c);
  return [...out.values()];
}

// ------------------------------------------------------------ hearing: the acoustic panorama
//
// What reaches the ear is not a list of sources but loudness as a function of direction. Each source's
// audible range R sets its level: received intensity relative to the hearing threshold is (R/d)^2
// (spherical spreading), so a lone source is heard exactly out to R, as before. Intensities go into
// 10-degree azimuth bins, separately for broadband water noise and for bird calls (different enough in
// character to be heard apart). A long river is one source: within a bin it counts once, at its nearest
// cell. The panorama is blurred by a Gaussian of about 15 degrees (localization blur), so sources closer
// together than roughly 30 degrees fuse into one wider sound. Each peak above threshold is one percept,
// named after the source that contributes most to it. Water within about 120 m raises the threshold
// for everything else fourfold (6 dB): you hear the brook you are standing by, not the far river.
const BIN = 10, NBIN = 36, BLUR_SD = 1.5; // bins
const BLUR = Array.from({ length: NBIN }, (_, k) => { const o = Math.min(k, NBIN - k); return Math.exp(-(o * o) / (2 * BLUR_SD * BLUR_SD)); });
export function hear(L, pos, { time = 'day', boost = 1 } = {}) {
  const { A } = landmarks(L);
  const quiet = time === 'day' ? 1 : 1.3;
  const vegHere = L.veg[idx(pos.x, pos.y)];
  const panes = { noise: new Map(), birds: new Map() }; // class -> key -> { bins: Map(bin -> { I, a, d }) }
  let closeKey = null;
  for (const a of A) {
    if (a.birds && time === 'night') continue;
    const R = a.range * quiet * boost * (1 - 0.35 * vegHere) * (a.birds ? (time === 'day' ? 0.45 : 1) : 1);
    const d = Math.max(30, distM(pos, a));
    if (d > 3 * R) continue; // under a ninth of threshold: negligible even when summed
    if (!a.birds && d < 120) closeKey = a.key;
    const pane = panes[a.birds ? 'birds' : 'noise'];
    const b = Math.floor(bearing(pos, a) / BIN) % NBIN, I = (R / d) ** 2;
    if (!pane.has(a.key)) pane.set(a.key, new Map());
    const kb = pane.get(a.key), prev = kb.get(b);
    if (!prev || prev.I < I) kb.set(b, { I, a, d });
  }
  const floor = closeKey ? 4 : 1;
  const out = [];
  for (const pane of Object.values(panes)) {
    const contrib = new Map(); // key -> blurred intensity per bin
    const total = new Float64Array(NBIN);
    for (const [key, kb] of pane) {
      const row = new Float64Array(NBIN);
      for (const [b, v] of kb) for (let k = 0; k < NBIN; k++) row[k] += v.I * BLUR[(k - b + NBIN) % NBIN];
      contrib.set(key, row);
      for (let k = 0; k < NBIN; k++) total[k] += row[k];
    }
    const best = new Map(); // one percept per dominant source: its strongest peak
    for (let k = 0; k < NBIN; k++) {
      const I = total[k];
      if (I < 1 || !(I > total[(k + NBIN - 1) % NBIN] && I >= total[(k + 1) % NBIN])) continue;
      let top = null, topI = 0, parts = 0;
      for (const [key, row] of contrib) { if (row[k] > topI) { topI = row[k]; top = key; } if (row[k] > 0.25 * I) parts++; }
      if (I < floor && top !== closeKey) continue;
      const src = [...pane.get(top).values()].reduce((a, b) => (b.I > a.I ? b : a));
      if (!best.has(top) || best.get(top).level < 10 * Math.log10(I)) best.set(top, { key: top, kind: src.a.kind, channel: 'sound', trueBearing: bearing(pos, src.a), trueDist: src.d, level: 10 * Math.log10(I), strength: clamp(1 - 1 / Math.sqrt(I)), fused: parts, x: src.a.x, y: src.a.y });
    }
    out.push(...best.values());
  }
  return out;
}

// Turn a perception into a noisy, character-level suspicion: bearing and rough distance.
// Within about 120 m (the next cell), I can see exactly where it is.
export function suspicionFrom(cue, pos, rng) {
  const bSd = cue.channel === 'sight' ? 6 : 25, dSd = cue.channel === 'sight' ? 0.2 : 0.45;
  const b = cue.trueBearing + rng.normal(0, bSd);
  const d = cue.trueDist * Math.exp(rng.normal(0, dSd));
  const rad = (b * Math.PI) / 180;
  if (cue.trueDist <= 1.5 * CELL && cue.x != null) return { bearing: cue.trueBearing, dist: cue.trueDist, est: { x: cue.x, y: cue.y } };
  return { bearing: b, dist: d, est: { x: clamp(Math.round(pos.x + (Math.sin(rad) * d) / CELL), 0, N - 1), y: clamp(Math.round(pos.y - (Math.cos(rad) * d) / CELL), 0, N - 1) } };
}

export const CUE_WORDS = {
  falls: 'the roar of falling water', cascade: 'water tumbling over rocks', rapids: 'the rush of a river over rocks', river: 'the low rush of a big stream',
  stream: 'a stream running nearby', brook: 'water trickling close by', waterfowl: 'waterbirds calling',
  hill: 'a hill', cliff: 'a long cliff line', lake: 'a lake glinting', 'river trace': 'a line of thicker trees snaking across the land, likely a river',
};
// How loud a sound is (dB above the hearing threshold). Loudness, not distance, is what the ear reports:
// a big falls far off and a cascade nearby can sound alike.
export const loudWords = level => (level < 6 ? 'faint' : level < 14 ? 'clear' : 'loud');
export const distWords = (d, channel) => (channel === 'sound'
  ? (d < 250 ? 'close' : d < 900 ? 'some way off' : 'faint and far')
  : (d < 1000 ? 'under a kilometre' : `about ${Math.round(d / 1000)} km`));

// ------------------------------------------------------------ walking

// Tobler's hiking function (km/h) slowed by vegetation; uphill and steep ground are slow.
// getting over a stream or river: about five minutes of wading, a minute at a ford, log or boulders
export const crossHours = (L, c) => (L.chan[c] >= 2 ? (L.crossing?.[c] ? 0.015 : 0.08) : 0);
export function stepHours(L, a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y) * CELL;
  const slope = (L.elev[idx(b.x, b.y)] - L.elev[idx(a.x, a.y)]) / d;
  const kmh = 6 * Math.exp(-3.5 * Math.abs(slope + 0.05)) * (1 - 0.5 * L.veg[idx(b.x, b.y)]);
  return d / 1000 / Math.max(kmh, 0.6) + crossHours(L, idx(b.x, b.y));
}

// Walk toward a believed target. Heading error accumulates (path integration) unless `resense`
// returns a fresh estimate (it is asked every few steps; with `force`, it must answer now). Stops when
// `arrived(p)` says I'm there, on reaching the believed spot when nothing sensed says it's further,
// at maxHours, or (if stopAtWater) at the first water.
// Walking distance to a point over dry ground, a cliff cell counting as CLIFF_COST ordinary ones (so
// the way goes round a cliff where it can, and up it only where it can't): Dijkstra with a binary
// heap on the 8-neighbour grid. An aim on a lake is reached at its shore; `shoreWeight` says how much
// it matters which part of the shore: a little when the lake is where I'm going, a lot when it's
// only in the way of something beyond (then the walk goes round to the shore nearest the aim). The
// search covers the ground between here and there with room to go round things, and the whole map if
// that isn't enough.
export const CLIFF_SLOPE = 0.35, CLIFF_COST = 8;
const blocks = (L, c) => !!L.lake[c];
function goalField(L, aim, from, M = 25, shoreWeight = 0.2) {
  const start = idx(from.x, from.y);
  const x0 = M >= N ? 0 : Math.max(0, Math.min(aim.x, from.x) - M), x1 = M >= N ? N - 1 : Math.min(N - 1, Math.max(aim.x, from.x) + M);
  const y0 = M >= N ? 0 : Math.max(0, Math.min(aim.y, from.y) - M), y1 = M >= N ? N - 1 : Math.min(N - 1, Math.max(aim.y, from.y) + M);
  const D = new Float64Array(N * N).fill(Infinity), heap = [];
  const push = (c, d) => { heap.push([d, c]); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  const ax = Math.max(0, Math.min(N - 1, Math.round(aim.x))), ay = Math.max(0, Math.min(N - 1, Math.round(aim.y)));
  if (!blocks(L, idx(ax, ay))) { D[idx(ax, ay)] = 0; push(idx(ax, ay), 0); }
  else { // the shore of the lake the aim is on
    const same = c => !!L.lake[c];
    const seen = new Set([idx(ax, ay)]), q = [idx(ax, ay)];
    while (q.length) {
      const c = q.pop(), x = c % N, y = (c / N) | 0;
      for (const [dx, dy] of NB) {
        const nx = x + dx, ny = y + dy, n = idx(nx, ny);
        if (!inside(nx, ny) || seen.has(n)) continue;
        seen.add(n);
        if (same(n)) q.push(n); else if (!blocks(L, n) && nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1) { const d = Math.hypot(nx - ax, ny - ay) * shoreWeight; if (d < D[n]) { D[n] = d; push(n, d); } }
      }
    }
  }
  while (heap.length) {
    const [d, c] = pop();
    if (d > D[c]) continue;
    const x = c % N, y = (c / N) | 0;
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy; if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      const n = idx(nx, ny); if (blocks(L, n) && n !== start) continue;
      const nd = d + Math.hypot(dx, dy) * (L.slope[n] > CLIFF_SLOPE ? CLIFF_COST : 1);
      if (nd < D[n]) { D[n] = nd; push(n, nd); }
    }
  }
  if (!Number.isFinite(D[start]) && M < N) return goalField(L, aim, from, N, shoreWeight); // no way round inside the window
  D.onLake = !!L.lake[idx(ax, ay)];
  return D;
}

// `toWater`: the lake an aim lies on is where I'm going (stop at its nearest shore); otherwise a lake in
// the way is skirted, to the far side nearest the aim. Cliffs are skirted where possible (goalField).
export function walk(L, from, target, { maxHours = 3, rng, resense = null, arrived = null, stopAtWater = false, driftSd = 2.5, toWater = false } = {}) {
  let p = { ...from }, hours = 0, drift = 0;
  const path = [p], crossings = [];
  let aim = { ...target };
  // Cells already trodden on this walk count against stepping there again. Without this, greedy
  // steps get trapped in a bay of a lake (or any concave obstacle), shuttling between two cells until
  // the time runs out; with it, the walker works its way round the shore.
  const trod = new Map([[idx(p.x, p.y), 1]]);
  // The way round what can be seen to be in the way: steps are scored half by heading (with its
  // drift) and half by walking distance to the aim through passable ground.
  const shoreWeight = toWater ? 0.2 : 3;
  let field = goalField(L, aim, p, 25, shoreWeight), fieldFor = `${Math.round(aim.x)},${Math.round(aim.y)}`;
  for (let steps = 0; steps < 400 && hours < maxHours; steps++) {
    if (Math.hypot(aim.x - p.x, aim.y - p.y) <= 1.5) { // at the believed spot: still sensing it further on? then home in on that
      const fresh = resense ? resense(p, true) : null;
      if (fresh && Math.hypot(fresh.x - p.x, fresh.y - p.y) > 1.5) { aim = fresh; drift = 0; }
      else { // finish on the spot itself: where I now sense it, if I do (close by, that's exact), else where I thought
        const spot = fresh ?? aim;
        if ((spot.x !== p.x || spot.y !== p.y) && !blocks(L, idx(spot.x, spot.y))) { hours += stepHours(L, p, spot); p = { x: spot.x, y: spot.y }; path.push(p); }
        break;
      }
    }
    drift += rng.normal(0, driftSd); // a known landmark in view keeps the heading true (small driftSd)
    if (resense) { const fresh = resense(p); if (fresh) { aim = fresh; drift *= 0.3; } }
    if (`${Math.round(aim.x)},${Math.round(aim.y)}` !== fieldFor) { field = goalField(L, aim, p, 25, shoreWeight); fieldFor = `${Math.round(aim.x)},${Math.round(aim.y)}`; }
    // the aim is in a lake: stop where no step gets nearer (any shore will do when the lake is where I'm going)
    const better = NB.some(([dx, dy]) => inside(p.x + dx, p.y + dy) && field[idx(p.x + dx, p.y + dy)] < field[idx(p.x, p.y)] - (toWater ? 0.5 : 0.05));
    if (blocks(L, idx(Math.round(aim.x), Math.round(aim.y))) && !better && (!toWater || NB.some(([dx, dy]) => inside(p.x + dx, p.y + dy) && L.lake[idx(p.x + dx, p.y + dy)]))) break;
    const want = ((bearing(p, aim) + drift) * Math.PI) / 180;
    let best = null, bestScore = Infinity;
    for (const [dx, dy] of NB) {
      const nx = p.x + dx, ny = p.y + dy;
      if (!inside(nx, ny) || blocks(L, idx(nx, ny))) continue;
      const along = dx * Math.sin(want) - dy * Math.cos(want);
      const len = Math.hypot(dx, dy), fd = field[idx(nx, ny)] - field[idx(p.x, p.y)], gain = Number.isFinite(fd) ? fd / len : -along / len; // -1 straight toward the aim
      const score = -0.5 * along / len + 0.5 * gain + 0.15 * rng.next() + 0.9 * (trod.get(idx(nx, ny)) ?? 0);
      if (score < bestScore) { bestScore = score; best = { x: nx, y: ny }; }
    }
    if (!best) break;
    hours += stepHours(L, p, best);
    p = best;
    path.push(p);
    trod.set(idx(p.x, p.y), (trod.get(idx(p.x, p.y)) ?? 0) + 1);
    const ch = L.chan[idx(p.x, p.y)];
    if (ch && (!crossings.length || Math.hypot(crossings[crossings.length - 1].x - p.x, crossings[crossings.length - 1].y - p.y) > 3)) {
      crossings.push({ ...p, size: ch });
      if (stopAtWater) break;
    }
    if (arrived && arrived(p)) break;
  }
  return { end: p, hours, path, crossings };
}

// Follow water downstream or up the largest feeder (from a lake shore, up an inflowing stream).
// One stage of following a stream: along it from `from` (on or beside the channel), downstream, or
// upstream starting at the inflow cell `branch` and then up the biggest feeder, for about `maxHours`
// or until something worth stopping for: where streams join (a fork), a waterfall or cascade, a
// spring, a lake (going down), where it leaves a lake (going up), the stream's source, or the edge of
// the land; each on its own cell. `why` says which; null means time.
export function followStage(L, from, dir, { branch = null, maxHours = 0.25 } = {}) {
  let p = { ...from }, hours = 0;
  const path = [p];
  const inflows = c => NB.map(([dx, dy]) => ({ x: (c % N) + dx, y: ((c / N) | 0) + dy })).filter(q => inside(q.x, q.y) && L.chan[idx(q.x, q.y)] && !L.lake[idx(q.x, q.y)] && L.down[idx(q.x, q.y)] === c);
  const near = (list, q, r) => list.some(f => Math.abs(f.x - q.x) <= r && Math.abs(f.y - q.y) <= r);
  const fromLake = c => NB.some(([dx, dy]) => { const x = (c % N) + dx, y = ((c / N) | 0) + dy; return inside(x, y) && L.lake[idx(x, y)] && L.down[idx(x, y)] === c; });
  if (!L.chan[idx(p.x, p.y)]) { // step into the water first
    const q = NB.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).find(q => inside(q.x, q.y) && L.chan[idx(q.x, q.y)] && !L.lake[idx(q.x, q.y)]);
    if (!q) return { end: p, hours: 0, path, why: 'no stream here' };
    hours += stepHours(L, p, q); p = q; path.push(p);
  }
  for (let steps = 0; steps < 60; steps++) {
    const c = idx(p.x, p.y);
    let next;
    if (dir === 'down') {
      const d = L.down[c];
      if (d < 0) return { end: p, hours, path, why: 'edge' };
      next = { x: d % N, y: (d / N) | 0 };
    } else {
      if (fromLake(c)) return { end: p, hours, path, why: 'outlet' }; // upstream of here is the lake
      const ins = inflows(c);
      if (steps === 0 && branch && !ins.some(q => q.x === branch.x && q.y === branch.y)) return { end: p, hours: 0, path, why: 'no stream here' }; // not a branch that feeds this spot
      next = steps === 0 && branch ? branch : ins.sort((a, b) => L.acc[idx(b.x, b.y)] - L.acc[idx(a.x, a.y)])[0];
      if (!next) return { end: p, hours, path, why: 'source' };
    }
    if (L.lake[idx(next.x, next.y)]) return { end: p, hours, path, why: 'lake' };
    // picking a way along the bank (no wading across, so none of stepHours's crossing time)
    hours += (stepHours(L, p, next) - crossHours(L, idx(next.x, next.y))) * 1.15;
    p = next;
    path.push(p);
    const n = idx(p.x, p.y);
    if (inflows(n).length >= 2) return { end: p, hours, path, why: 'fork' };
    // a waterfall or spring stops me when I come to it, not the one I'm setting off from
    if (near(L.features.waterfalls, p, 0)) return { end: p, hours, path, why: 'falls' };
    if (near(L.features.springs, p, 0)) return { end: p, hours, path, why: 'spring' };
    if (dir === 'up' && fromLake(n)) return { end: p, hours, path, why: 'outlet' };
    if (hours >= maxHours) break;
  }
  return { end: p, hours, path, why: null };
}

// Walk a lake's shore a stage: from shore cell to shore cell (dry land next to the lake), keeping the
// water on one side ('left' or 'right' as I walk), going back over a cell walked this stage only out of a dead end. Stops
// after about a quarter of an hour, or early where a stream runs in (a mouth), where one leaves (an
// outlet), back where I started (all the way round), or where the shore can't be followed (the edge of
// the land, or a corner with nowhere new to go).
export function shoreStage(L, from, side, { maxHours = 0.25 } = {}) {
  const path = [{ ...from }];
  const start = NB.map(([dx, dy]) => ({ x: from.x + dx, y: from.y + dy })).find(q => inside(q.x, q.y) && L.lake[idx(q.x, q.y)]);
  if (!start) return { end: from, hours: 0, path, why: 'no lake here' };
  const mine = new Uint8Array(N * N), st = [idx(start.x, start.y)]; // this lake's cells
  mine[st[0]] = 1;
  while (st.length) { const c = st.pop(); for (const [dx, dy] of NB) { const x = (c % N) + dx, y = ((c / N) | 0) + dy; if (inside(x, y) && L.lake[idx(x, y)] && !mine[idx(x, y)]) { mine[idx(x, y)] = 1; st.push(idx(x, y)); } } }
  const wet = (x, y) => NB.filter(([dx, dy]) => inside(x + dx, y + dy) && mine[idx(x + dx, y + dy)]).map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
  // the shore: dry cells sharing an edge with the lake (a ring walkable in steps of eight directions)
  const isShore = (x, y) => inside(x, y) && !L.lake[idx(x, y)] && NB.slice(0, 4).some(([dx, dy]) => inside(x + dx, y + dy) && mine[idx(x + dx, y + dy)]);
  const fromLake = (x, y) => L.chan[idx(x, y)] > 0 && NB.some(([dx, dy]) => inside(x + dx, y + dy) && mine[idx(x + dx, y + dy)] && L.down[idx(x + dx, y + dy)] === idx(x, y));
  const isMouth = (x, y) => L.chan[idx(x, y)] > 0 && L.down[idx(x, y)] >= 0 && mine[L.down[idx(x, y)]] === 1;
  const sign = side === 'left' ? 1 : -1, walked = new Map([[idx(from.x, from.y), 1]]);
  let p = { ...from }, hours = 0;
  for (let steps = 0; steps < 60; steps++) {
    let best = null;
    for (const [dx, dy] of NB) {
      const q = { x: p.x + dx, y: p.y + dy };
      if (!isShore(q.x, q.y)) continue;
      const home = steps > 2 && q.x === from.x && q.y === from.y, again = home ? 0 : walked.get(idx(q.x, q.y)) ?? 0; // back over a cell only out of a dead end (a spit of land)
      // which side of the step the water lies: + left, - right (y runs south, so left of (vx, vy) is (vy, -vx))
      const w = [...wet(p.x, p.y), ...wet(q.x, q.y)].reduce((a, c) => ({ x: a.x + c.x - (p.x + q.x) / 2, y: a.y + c.y - (p.y + q.y) / 2 }), { x: 0, y: 0 });
      const lean = sign * (dy * w.x - dx * w.y) / (Math.hypot(w.x, w.y) || 1) / Math.hypot(dx, dy);
      const score = lean + 0.15 * wet(q.x, q.y).length - (dx && dy ? 0.05 : 0) - 3 * again; // keep the water on my side, hug the shore
      if (!best || score > best.score) best = { q, score };
    }
    if (!best || best.score < -7) return { end: p, hours, path, why: steps ? 'blocked' : 'no shore' };
    hours += stepHours(L, p, best.q);
    p = best.q; path.push(p); walked.set(idx(p.x, p.y), (walked.get(idx(p.x, p.y)) ?? 0) + 1);
    if (p.x === from.x && p.y === from.y) return { end: p, hours, path, why: 'round' };
    if (isMouth(p.x, p.y)) return { end: p, hours, path, why: 'mouth' };
    if (fromLake(p.x, p.y)) return { end: p, hours, path, why: 'outlet' };
    if (p.x === 0 || p.y === 0 || p.x === N - 1 || p.y === N - 1) return { end: p, hours, path, why: 'edge' };
    if (hours >= maxHours) break;
  }
  return { end: p, hours, path, why: null };
}

// ------------------------------------------------------------ spawn: a survivable start

// From the spawn, a lookout must be findable (visible, or close); from the lookout,
// a lake or a river trace must be visible.
export function chooseSpawn(L, seed) {
  const rng = makeRng(`${seed}/spawn2`);
  const { V } = landmarks(L);
  const waterView = new Map();
  const lookouts = L.features.hills;
  for (const h of lookouts) { // the same perception the game uses from a lookout
    const seen = perceive(L, h, { lookout: true }).filter(c => c.kind === 'lake' || c.kind === 'river trace');
    waterView.set(h, seen.length);
  }
  const good = lookouts.filter(h => waterView.get(h) >= 1);
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 3000 && good.length; t++) {
    const x = 25 + Math.floor(rng.next() * (N - 50)), y = 25 + Math.floor(rng.next() * (N - 50));
    const c = idx(x, y);
    if (L.lake[c] || L.chan[c] >= 2) continue;
    const reach = good.filter(h => { const d = distM({ x, y }, h); return d < 2500 && (d < 700 || sightline(L, { x, y }, h, 1.7, 2) > 0.15); });
    if (!reach.length) continue;
    const score = Math.hypot(x - N / 2, y - N / 2) + rng.next() * 8;
    if (score < bestScore) { bestScore = score; best = { x, y, lookout: reach[0], waterM: Math.round(L.waterDist[c] * CELL) }; }
  }
  return best ?? (L.spawn ? { ...L.spawn, lookout: null, fallback: true } : { x: N / 2, y: N / 2, lookout: null, fallback: true });
}

function labelComponents(L, test) {
  const lab = new Int32Array(N * N).fill(-1);
  let k = 0;
  for (let c = 0; c < N * N; c++) {
    if (lab[c] >= 0 || !test(c)) continue;
    const st = [c]; lab[c] = k;
    while (st.length) {
      const q = st.pop();
      for (const [dx, dy] of NB) { const nx = (q % N) + dx, ny = ((q / N) | 0) + dy; if (!inside(nx, ny)) continue; const n = idx(nx, ny); if (lab[n] < 0 && test(n)) { lab[n] = k; st.push(n); } }
    }
    k++;
  }
  return lab;
}
