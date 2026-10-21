// mentalmap.js — the character's map: places and landmarks as a graph, distances as walking time.
//
// Nodes are visited sites (known positions) and suspected landmarks (believed positions). Edges come
// from a Delaunay triangulation of the believed positions, so each node links to its neighbours;
// long edges are pruned unless the graph needs them to stay connected (minimum spanning tree edges
// are always kept). An edge's time is what was actually walked, if it was, or else a guess from how
// the land looks along it. Streams are marked on the edges they are believed to cross: crossings
// actually walked, plus where an edge cuts the line through a stream's known points.
// Pure functions; game.js supplies the state.

// ------------------------------------------------------------ triangulation (Bowyer–Watson)

export function delaunayEdges(pts) {
  const n = pts.length;
  if (n < 2) return [];
  if (n === 2) return [[0, 1]];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const d = Math.max(maxX - minX, maxY - minY, 1) * 20, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // tiny deterministic jitter breaks exact collinearity and co-circularity
  const P = [...pts.map((p, i) => ({ x: p.x + 1e-6 * Math.sin(i * 12.9898), y: p.y + 1e-6 * Math.cos(i * 78.233) })),
    { x: cx - d, y: cy - d }, { x: cx + d, y: cy - d }, { x: cx, y: cy + d }];
  const circ = (a, b, c) => {
    const A = P[a], B = P[b], C = P[c];
    const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    if (Math.abs(D) < 1e-12) return { x: 0, y: 0, r2: Infinity };
    const a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y;
    const ux = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / D;
    const uy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / D;
    return { x: ux, y: uy, r2: (A.x - ux) ** 2 + (A.y - uy) ** 2 };
  };
  let tris = [{ v: [n, n + 1, n + 2], c: circ(n, n + 1, n + 2) }];
  for (let i = 0; i < n; i++) {
    const p = P[i];
    const bad = tris.filter(t => (p.x - t.c.x) ** 2 + (p.y - t.c.y) ** 2 < t.c.r2);
    const edges = new Map();
    for (const t of bad) for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]]) {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(k, edges.has(k) ? null : [a, b]);
    }
    tris = tris.filter(t => !bad.includes(t));
    for (const e of edges.values()) if (e) tris.push({ v: [e[0], e[1], i], c: circ(e[0], e[1], i) });
  }
  const out = new Map();
  for (const t of tris) for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]]) {
    if (a >= n || b >= n) continue;
    out.set(a < b ? `${a},${b}` : `${b},${a}`, a < b ? [a, b] : [b, a]);
  }
  return [...out.values()];
}

// Keep the triangulation's local links; drop long ones unless needed to keep the map in one piece.
export function meshEdges(pts, { longFactor = 2 } = {}) {
  const len = ([a, b]) => Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
  let E = delaunayEdges(pts);
  if (!E.length && pts.length > 1) E = pts.slice(1).map((_, i) => [i, i + 1]);
  const sorted = [...E].sort((a, b) => len(a) - len(b));
  const parent = pts.map((_, i) => i), find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const mst = new Set();
  for (const e of sorted) { const a = find(e[0]), b = find(e[1]); if (a !== b) { parent[a] = b; mst.add(e); } }
  const median = sorted.length ? len(sorted[Math.floor(sorted.length / 2)]) : 0;
  return E.filter(e => mst.has(e) || len(e) <= longFactor * median);
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
