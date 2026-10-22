// Shared by the UI tests: the walked stretches of streams as drawn on the map, checked for tidiness.
// A stretch I followed has a fix on every cell, drawn as a smooth curve through the ones that matter
// and one cell in ten between, so: the points a solid line passes through are never more than about
// fifteen cells apart (no jumps), and where solid lines meet (three or more ends at one point) is a
// fork I stood on, marked there; and a line is smooth: at each point it passes through, it arrives
// and leaves the same way (no kinks). (A fork with only one of its branches followed is a marker on a plain line.)
function knownLines(d) {
  // the points each line passes through: its start, and the end of each curve piece
  return [...d.querySelectorAll('.mapsvg .stream path.flow.known')].map(p => p.getAttribute('d').match(/[MLC][^MLC]+/g).map(t => t.slice(1).trim().split(/\s+/).map(Number).slice(-2)));
}
// kinks in any stream line: points where the curve arriving and the curve leaving point different ways
function kinks(d) {
  const out = [];
  for (const p of d.querySelectorAll('.mapsvg .stream path.flow')) {
    const cmds = p.getAttribute('d').match(/[MC][^MC]+/g).map(t => t.slice(1).trim().split(/\s+/).map(Number));
    for (let k = 1; k < cmds.length - 1; k++) {
      const [, , ix, iy, bx, by] = cmds[k], [ox, oy] = cmds[k + 1];
      const a = Math.atan2(by - iy, bx - ix), b = Math.atan2(oy - by, ox - bx), turn = Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (turn > 0.02) out.push(`the line turns ${Math.round(turn * 180 / Math.PI)}° at ${bx},${by}`);
    }
  }
  return out;
}
function tidiness(d) {
  const lines = knownLines(d), bad = kinks(d), deg = new Map();
  const key = ([x, y]) => `${x},${y}`;
  const bump = (p, n) => deg.set(key(p), (deg.get(key(p)) ?? 0) + n);
  for (const pts of lines) {
    pts.forEach((p, k) => { if (k) { const q = pts[k - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 15 * Math.SQRT2) bad.push(`a solid line jumps from ${key(q)} to ${key(p)}`); } });
    pts.forEach((p, k) => bump(p, k === 0 || k === pts.length - 1 ? 1 : 2));
  }
  const forks = [...d.querySelectorAll('.mapsvg .node.site.fork')].map(g => { const c = g.querySelector('circle'); return `${c.getAttribute('cx')},${c.getAttribute('cy')}`; });
  for (const [p, n] of deg) if (n >= 3 && !forks.includes(p)) bad.push(`solid lines meet at ${p}, with no fork marked there`);
  return { lines, deg, bad };
}
module.exports = { knownLines, kinks, tidiness };
