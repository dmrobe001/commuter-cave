// mentalmap.js — the character's map: places and landmarks as a graph, distances as walking time.
//
// The links come from experience, not from geometry. Three kinds:
//   trails     legs actually walked, between the places they passed (game.js splits a walk at every
//              known place it comes close to), timed as walked
//   shortcuts  guessed links between visited places
// Both follow one rule (a greedy spanner): a link goes down only where the map's best route between
// its two places is more than `detour` times the link's own time. Routes are compared in guessed
// times throughout, so a trail that happened to be slow going doesn't earn a shortcut beside it
// over the same ground. Trails are considered first, then shortcuts, quickest first within each; a link that would cross one already down waits until the
// end and goes down only if its places are still not joined.
//   sightings  each landmark not yet reached hangs off the place it was best seen from; each stretch
//              of unexplored ground off the nearest visited place; failing that (the link would
//              cross the map), off the nearest place it can reach without crossing
// Streams are marked on the links they are believed to cross: crossings actually walked, plus where a
// link cuts the line through a stream's known points.
// Pure functions; game.js supplies the state.

// ------------------------------------------------------------ trails and shortcuts

// Do segments p1-p2 and q1-q2 cross at a point inside both? (Touching at an end doesn't count.)
function properCross(p1, p2, q1, q2) {
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
}

// Quickest time from `from` to `to` over adjacency lists, giving up (Infinity) beyond `limit`.
function boundedTime(adj, from, to, limit) {
  const dist = new Map([[from, 0]]), heap = [[0, from]];
  const push = x => { heap.push(x); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (u === to) return d;
    if (d > limit) return Infinity;
    if (d > dist.get(u)) continue;
    for (const [v, w] of adj[u]) if (d + w < (dist.get(v) ?? Infinity)) { dist.set(v, d + w); push([d + w, v]); }
  }
  return Infinity;
}

// pts: visited places {x, y}; trails: [{ a, b, hours }] walked legs between them; guess(a, b): the guessed walking time along the straight line. Returns [{ a, b, hours, walked }].
export function trailGraph(pts, trails, guess, { detour = 1.5 } = {}) {
  const n = pts.length, adj = Array.from({ length: n }, () => []), have = new Set(), out = [];
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const add = (a, b, hours, walked) => { const g = guess(a, b); have.add(key(a, b)); adj[a].push([b, g]); adj[b].push([a, g]); out.push({ a, b, hours, walked }); };
  const crosses = (a, b) => out.some(e => e.a !== a && e.a !== b && e.b !== a && e.b !== b && properCross(pts[a], pts[b], pts[e.a], pts[e.b]));
  const joined = (a, b) => Number.isFinite(boundedTime(adj, a, b, Infinity));
  const held = [];
  const consider = (a, b, h, walked) => {
    const g = guess(a, b);
    if (a === b || have.has(key(a, b)) || boundedTime(adj, a, b, detour * g) <= detour * g) return;
    if (crosses(a, b)) held.push([a, b, h, walked]); else add(a, b, h, walked);
  };
  for (const e of [...trails].sort((p, q) => guess(p.a, p.b) - guess(q.a, q.b))) consider(e.a, e.b, e.hours, true);
  const pairs = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pairs.push([a, b, guess(a, b)]);
  for (const [a, b, g] of pairs.sort((p, q) => p[2] - q[2])) consider(a, b, g, false);
  for (const [a, b, h, w] of held) if (!have.has(key(a, b)) && !joined(a, b)) add(a, b, h, w);
  return out;
}

// Which of `candidates` (points, in order of preference) can be linked to p without crossing any of
// `segments` ([[P, Q], ...])? The first that can, or else the first.
export function firstClear(p, candidates, segments) {
  const ok = c => !segments.some(([P, Q]) => P !== c && Q !== c && properCross(c, p, P, Q));
  return candidates.find(ok) ?? candidates[0];
}

// ------------------------------------------------------------ label placement

// Where each label goes: tried at eight spots around its marker, in the order cartographers usually
// prefer (right, left, above right, below right, above left, below left, above, below), and put at the
// cheapest. Cost: overlap with labels already placed and with `boxes` (heavily), any part outside
// `bounds` (the edge of the view; as heavily), markers in `discs`, lines in `segs` it would sit on,
// and a little for each step down the order of preference.
// Labels go in the order given, so the important ones get first pick.
// labels: [{ x, y, r, w, h }] (marker centre and radius, label size); returns [{ x0, y0, x1, y1 }].
const SPOTS = [[1, 0], [-1, 0], [1, -1], [1, 1], [-1, -1], [-1, 1], [0, -1], [0, 1]];
function overlap(a, b) { return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)); }
function segHitsBox(a, b, box) { // Liang–Barsky: does segment a-b pass through the box?
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.x0], [dx, box.x1 - a.x], [-dy, a.y - box.y0], [dy, box.y1 - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}
export function placeLabels(labels, { boxes = [], segs = [], discs = [], bounds = null } = {}) {
  const placed = [...boxes];
  return labels.map(L => {
    let best = null;
    SPOTS.forEach(([dx, dy], rank) => {
      const gap = L.r + 0.25 * L.h, lift = dx && dy ? 0.35 : 1; // diagonal spots tuck in closer vertically
      const x0 = dx > 0 ? L.x + gap : dx < 0 ? L.x - gap - L.w : L.x - L.w / 2;
      const y0 = dy < 0 ? L.y - lift * gap - L.h : dy > 0 ? L.y + lift * gap : L.y - L.h / 2;
      const box = { x0, y0, x1: x0 + L.w, y1: y0 + L.h }, unit = L.h * L.h;
      let cost = 0.05 * rank * unit;
      for (const b of placed) cost += 10 * overlap(box, b);
      if (bounds) cost += 10 * (L.w * L.h - overlap(box, bounds));
      for (const d of discs) if (d.x !== L.x || d.y !== L.y) cost += 6 * overlap(box, { x0: d.x - d.r, y0: d.y - d.r, x1: d.x + d.r, y1: d.y + d.r });
      for (const [a, b] of segs) if (segHitsBox(a, b, box)) cost += 0.4 * unit;
      if (!best || cost < best.cost) best = { cost, box };
    });
    placed.push(best.box);
    return best.box;
  });
}

// ------------------------------------------------------------ streams on edges

function segCross(p1, p2, q1, q2) { // intersection point of two segments, or null
  const d = (p2.x - p1.x) * (q2.y - q1.y) - (p2.y - p1.y) * (q2.x - q1.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((q1.x - p1.x) * (q2.y - q1.y) - (q1.y - p1.y) * (q2.x - q1.x)) / d;
  const u = ((q1.x - p1.x) * (p2.y - p1.y) - (q1.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) } : null;
}
// The believed course of a stream: its known points ordered along their main axis.
export function streamLine(points) {
  if (points.length < 2) return [];
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length, my = points.reduce((s, p) => s + p.y, 0) / points.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
  return [...points].sort((a, b) => (a.x - mx) * ux + (a.y - my) * uy - ((b.x - mx) * ux + (b.y - my) * uy));
}
export function suspectedCrossings(a, b, streams) { // streams: [{ key, name, line }]
  const out = [];
  for (const s of streams) for (let i = 1; i < s.line.length; i++) {
    const x = segCross(a, b, s.line[i - 1], s.line[i]);
    if (x) { out.push({ key: s.key, name: s.name, at: x }); break; }
  }
  return out;
}

// ------------------------------------------------------------ routes

// All quickest routes from one node at once (Dijkstra over adjacency lists).
export function shortestFrom(n, edges, from) {
  const adj = Array.from({ length: n }, () => []);
  for (const e of edges) { const w = Number.isFinite(e.hours) ? e.hours : 3; adj[e.a].push([e.b, w]); adj[e.b].push([e.a, w]); }
  const dist = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = Array(n).fill(false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
  }
  const route = to => { if (!Number.isFinite(dist[to])) return null; const path = [to]; while (path[0] !== from) path.unshift(prev[path[0]]); return { path, hours: dist[to] }; };
  return { dist, route };
}
export function shortestPath(n, edges, from, to) { return shortestFrom(n, edges, from).route(to); }
// ------------------------------------------------------------ words

// Walking time in words. certainty: 'known' (walked), 'guess' (looked at), 'unknown' (heard only).
export function timeWords(h, certainty = 'guess') {
  if (certainty === 'unknown' || !Number.isFinite(h)) return '?';
  const t = h < 0.12 ? 'a few minutes' : h < 0.9 ? `${Math.max(5, Math.round(h * 12) * 5)} min` : h < 1.25 ? (certainty === 'known' ? 'an hour' : 'about an hour')
    : h < 4 ? `${Math.round(h * 2) / 2} h` : h < 10 ? `${Math.round(h)} h` : 'most of a day';
  return certainty === 'known' || /few|hour|day/.test(t) ? t : `~${t}`;
}
// "about 2 h away", "a few minutes away"
export const awayWords = (h, certainty) => { const t = timeWords(h, certainty); return t === '?' ? 'how far, I can’t say' : `${t.replace(/^~/, 'about ')} away`; };

// ------------------------------------------------------------ why a walk took longer or shorter

// path: cells walked; predicted: the hours I expected; actual: the hours it took.
// believedDist / trueDist: distance to where I thought the target was, and to where it really was.
export function explainTrip(L, path, predicted, actual, { believedDist = null, trueDist = null, idx, CELL } = {}) {
  if (!Number.isFinite(predicted) || predicted <= 0 || path.length < 3) return null;
  const ratio = actual / predicted;
  if (Math.abs(actual - predicted) < Math.max(0.25, 0.35 * predicted)) return null;
  const longer = ratio > 1;
  let walked = 0, veg = 0, climb = 0, lakeSide = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    walked += Math.hypot(b.x - a.x, b.y - a.y);
    veg += L.veg[idx(b.x, b.y)];
    climb += Math.max(0, L.elev[idx(b.x, b.y)] - L.elev[idx(a.x, a.y)]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (L.lake[idx(Math.max(0, Math.min(127, b.x + dx)), Math.max(0, Math.min(127, b.y + dy)))]) { lakeSide++; break; }
  }
  const straight = Math.hypot(path[path.length - 1].x - path[0].x, path[path.length - 1].y - path[0].y) || 1;
  veg /= path.length - 1;
  const reasons = [];
  if (longer) {
    if (believedDist && trueDist && trueDist > 1.3 * believedDist) reasons.push([trueDist / believedDist - 1, 'it was farther than it looked']);
    reasons.push([walked / straight - 1.15, 'I kept drifting off line and had to correct']);
    reasons.push([(veg - 0.45) * 2, 'thick brush most of the way']);
    reasons.push([climb / 200, `a lot of climbing (${Math.round(climb / 10) * 10} m up, all told)`]);
    reasons.push([lakeSide / path.length * 3, 'water in the way; I had to go round']);
  } else {
    if (believedDist && trueDist && trueDist < 0.75 * believedDist) reasons.push([1 - trueDist / believedDist, 'it was closer than it looked']);
    reasons.push([(0.35 - veg) * 2, 'open ground; easy going']);
    reasons.push([0.2 - climb / 400, 'mostly downhill or level']);
  }
  const best = reasons.sort((a, b) => b[0] - a[0])[0];
  const why = best && best[0] > 0 ? best[1] : longer ? 'harder going than I guessed' : 'easier going than I guessed';
  return `${longer ? 'Took longer' : 'Quicker'} than I expected (${timeWords(actual, 'known')}, not ${timeWords(predicted, 'known')}): ${why}.`;
}
