// The shape of the mental map after a fixed sequence of hikes: how many links per node, how many
// links cross, and how roundabout the map's routes between visited places are. Reads the drawn SVG,
// so it measures what the player sees. Fails if the map falls into pieces.
// Usage: node tests/ui/map-shape.cjs [seed ...]
const { JSDOM } = require('jsdom');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['pig-rock', 'c', 'm', 'wgxdd'];
const CHECKPOINTS = [6, 12, 20];

function cross(p1, p2, q1, q2) { // proper crossing of two segments that share no endpoint
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
}
function measure(d) {
  const svg = d.querySelector('.mapsvg');
  if (!svg) return null;
  const nodes = [...svg.querySelectorAll('.node')].map(g => { const c = g.querySelector('circle'); return { x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), site: g.classList.contains('site'), sus: g.classList.contains('sus') }; });
  // nodes by position: markers, plus link ends at places drawn without a marker (by a stream)
  const at = (x, y) => { let i = nodes.findIndex(v => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6); if (i < 0) { nodes.push({ x, y, site: false }); i = nodes.length - 1; } return i; };
  const edges = [...svg.querySelectorAll('line.edge')].map(l => ({ a: at(+l.getAttribute('x1'), +l.getAttribute('y1')), b: at(+l.getAttribute('x2'), +l.getAttribute('y2')), kind: l.dataset.link }));
  const kind = e => e.kind;
  let crossings = 0; const byKind = {};
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const e = edges[i], f = edges[j];
    if ([e.a, e.b].some(v => v === f.a || v === f.b)) continue;
    if (cross(nodes[e.a], nodes[e.b], nodes[f.a], nodes[f.b])) { crossings++; const k = [kind(e), kind(f)].sort().join('×'); byKind[k] = (byKind[k] ?? 0) + 1; }
  }
  // worst detour among visited places: map route length over straight distance (Floyd–Warshall)
  const n = nodes.length, D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  const len = (a, b) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
  for (const e of edges) D[e.a][e.b] = D[e.b][e.a] = Math.min(D[e.a][e.b], len(e.a, e.b));
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (D[i][k] + D[k][j] < D[i][j]) D[i][j] = D[i][k] + D[k][j];
  let worst = 1, unreachable = 0;
  const sites = nodes.map((v, i) => (v.site ? i : -1)).filter(i => i >= 0);
  for (const i of nodes.keys()) for (const j of nodes.keys()) if (i < j && !Number.isFinite(D[i][j])) unreachable++;
  for (const i of sites) for (const j of sites) if (i < j && len(i, j) > 2) worst = Math.max(worst, D[i][j] / len(i, j));
  // a pair of places within ~250 m of each other that both link to the same third node
  let closePairs = 0;
  for (const i of nodes.keys()) for (const j of nodes.keys()) {
    if (i >= j || len(i, j) > 3.2) continue;
    const ni = new Set(edges.filter(e => e.a === i || e.b === i).map(e => (e.a === i ? e.b : e.a)));
    if (edges.some(e => (e.a === j || e.b === j) && ni.has(e.a === j ? e.b : e.a))) closePairs++;
  }
  return { nodes: n, sites: sites.length, edges: edges.length, walked: edges.filter(e => e.kind === 'trail').length, perNode: (2 * edges.length / n).toFixed(2), crossings, byKind, worst: worst.toFixed(2), unreachable, closePairs };
}

(async () => {
  let errors = 0;
  for (const seed of seeds) {
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window, d = w.document, errs = [];
    w.addEventListener('error', e => errs.push(e.message));
    await wait(50);
    d.querySelector('#seed').value = seed; d.querySelector('#check').click();
    for (let k = 0; k < 50 && !d.querySelector('#begin'); k++) await wait(100);
    d.querySelector('#begin').click();
    const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const scan = d.querySelector('[data-here="scan"]:not([disabled])'); if (scan) click(scan);
    // a fixed itinerary: out to landmarks and unexplored ground, now and then back to a known place
    for (let move = 1; move <= CHECKPOINTS[CHECKPOINTS.length - 1]; move++) {
      const opts = [...d.querySelectorAll('[data-hike]')];
      const pick = move % 4 === 0 ? opts.filter(g => g.classList.contains('site')) : opts.filter(g => !g.classList.contains('site'));
      const pool = pick.length ? pick : opts;
      if (!pool.length) break;
      click(pool[(move * 7) % pool.length]);
      const s = d.querySelector('[data-here="scan"]:not([disabled])'); if (s && move % 2) click(s);
      if (!CHECKPOINTS.includes(move)) continue;
      const m = measure(d);
      console.log(`${seed.padEnd(9)} move ${String(move).padStart(2)}: ${JSON.stringify(m)}`);
      if (m.unreachable) errs.push(`move ${move}: the map is in pieces (${m.unreachable} pairs unjoined)`);
    }
    if (errs.length) { errors++; console.log(`${seed}: errors`, errs); }
  }
  if (errors) process.exit(1);
})();
