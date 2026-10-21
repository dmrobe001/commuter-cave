// Walks that use up their time without arriving, on random trips of 0.6–2 km across 8 worlds. Trips to a
// point on a lake (they end at the shore) and starts in pockets cut off by water are left out. Want 0.
const QUICK = !!process.env.QUICK; // QUICK=1: a smaller batch for the inner development loop
import { generateWorld } from '../../src/generator.js';
import { generateLandscape, N } from '../../src/landscape.js';
import { walk } from '../../src/geo.js';
import { makeRng } from '../../src/rng.js';
let stuck = 0, total = 0, ex = null, pockets = 0;
for (const seed of (QUICK ? ['pig-rock', 'c', 'm'] : ['pig-rock', 'c', 'm', 'h', 'a', 'b', 'n7', 'q'])) {
  const w = generateWorld(seed, { mcSamples: 5 }), L = generateLandscape(w), r = makeRng('t' + seed);
  for (let k = 0; k < (QUICK ? 120 : 300); k++) {
    const from = { x: r.int(5, N - 6), y: r.int(5, N - 6) };
    if (L.lake[from.y * N + from.x]) continue;
    const a = r.uniform(0, 6.28), d = r.uniform(8, 25);
    const to = { x: Math.round(from.x + d * Math.sin(a)), y: Math.round(from.y - d * Math.cos(a)) };
    if (to.x < 1 || to.y < 1 || to.x > N - 2 || to.y > N - 2) continue;
    total++;
    const t = walk(L, from, to, { rng: r, maxHours: 3 });
    const moved = Math.hypot(t.end.x - from.x, t.end.y - from.y);
    // islands and pockets cut off by lakes: no dry way out
    const seen = new Set([from.y * N + from.x]), q = [from.y * N + from.x];
    while (q.length && seen.size < 400) { const c = q.pop(); for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) { const x = c % N + dx, y = (c / N | 0) + dy; const n = y * N + x; if (x >= 0 && y >= 0 && x < N && y < N && !L.lake[n] && !seen.has(n)) { seen.add(n); q.push(n); } } }
    const pocket = seen.size < 400;
    if (pocket) { pockets = (pockets ?? 0) + 1; continue; }
    if (L.lake[to.y * N + to.x]) continue; // aims on a lake end at the shore
    if (t.hours >= 2.9 && Math.hypot(t.end.x - to.x, t.end.y - to.y) > 3) {
      stuck++;
      if (!ex || moved < ex.moved) ex = { seed, from, to, moved, steps: t.path.length, hours: t.hours, path: t.path.slice(0, 40).map(p => `${p.x},${p.y}`).join(' ') };
    }
  }
}
console.log({ total, stuck, pockets, slowButMoving: 0 }, ex && { ...ex, path: ex.path.slice(0, 200) });
