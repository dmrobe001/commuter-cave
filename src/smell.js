// smell.js — what can be smelled, and from where.
//
// Smell travels with the wind. A source is smelled at long range when it lies upwind, at short range
// across the wind, and hardly at all downwind; odour arrives in patches, so even an upwind source is
// only caught some of the time. The nose gives a direction (the way the wind is coming from) but
// almost no sense of distance.
//
// Distant sources: carcasses (from the large animals; each lies about four days before it is picked
// clean, so they come and go), marshy lakes (anoxic mud smells of rotten eggs), sulfur springs on
// volcanic ground, and the den of a musk animal if the world has one. Local smells (resin, onion,
// mint, ripe fruit, mushrooms, droppings) are noticed in a survey; see game.js.

import { makeRng } from './rng.js';
import { N, CELL } from './landscape.js';
import { waterKeyAt } from './geo.js';

const idx = (x, y) => y * N + x;
const distM = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * CELL;
const bearing = (a, b) => (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI + 360) % 360;

// The wind for a given day: a prevailing direction for the world, with a daily swing.
export function windFor(world, day) {
  const base = makeRng(`${world.seed}/wind`).uniform(0, 360);
  const r = makeRng(`${world.seed}/wind/${day}`);
  return { from: (base + r.normal(0, 45) + 360) % 360, strength: Math.max(0.15, Math.min(1, r.logNormal(0.45, 0.5))) };
}

const CARCASS_DAYS = 4;
export function smellSources(world, L, day) {
  const out = [];
  const env = world.environment;
  // marshy lakes: about half the lakes have mucky, stagnant margins
  L.features.lakes.forEach((l, i) => {
    if (!makeRng(`${world.seed}/marsh/${i}`).chance(0.5)) return;
    const wk = waterKeyAt(L, l.x, l.y) ?? `lake-x${i}`;
    out.push({ key: `marsh-${i}`, kind: 'marsh', x: l.x, y: l.y, range: 1200, words: 'a swampy, rotten-egg smell', waterKey: wk });
  });
  // a sulfur spring, on volcanic ground
  if (env.bedrock === 'volcanic' && L.features.springs.length && makeRng(`${world.seed}/sulfur`).chance(0.6)) {
    const sp = L.features.springs[0];
    out.push({ key: 'sulfur-0', kind: 'sulfur', x: sp.x, y: sp.y, range: 1500, words: 'a sharp whiff of sulfur' });
  }
  // musk animal dens
  const musk = world.animals.find(a => a.traits.key === 'stinker');
  if (musk) {
    const r = makeRng(`${world.seed}/musk`);
    for (let i = 0; i < 2; i++) {
      const p = landCell(L, r, musk.habitats.map(h => h.micro));
      if (p) out.push({ key: `musk-${i}`, kind: 'musk', x: p.x, y: p.y, range: 1000, words: musk.smell, animal: musk.id });
    }
  }
  // carcasses: deaths among the large animals over a few days (density × 100 km² × days / lifespan)
  const epoch = Math.floor((day - 1) / CARCASS_DAYS);
  const big = world.animals.filter(a => a.cls === 'large' && a.perKm2 && !a.signs?.distant);
  const r = makeRng(`${world.seed}/carcass/${epoch}`);
  for (const a of big) {
    const mean = a.perKm2 * 100 * CARCASS_DAYS / (8 * 365) + 0.4; // plus the odd animal dead of something else
    let n = 0, Lp = Math.exp(-mean), p = 1;
    do { n++; p *= r.next(); } while (p > Lp && n < 6);
    for (let i = 0; i < n - 1; i++) {
      const c = landCell(L, r, a.habitats.map(h => h.micro));
      if (c) out.push({ key: `carcass-${epoch}-${a.id}-${i}`, kind: 'carcass', x: c.x, y: c.y, range: 2000, words: 'the sweet, heavy stink of something dead', animal: a.id, epoch });
    }
  }
  return out;
}
function landCell(L, r, micros) {
  for (let k = 0; k < 200; k++) {
    const x = r.int(2, N - 3), y = r.int(2, N - 3);
    const m = L.micro[idx(x, y)];
    if (!L.lake[idx(x, y)] && (!micros.length || micros.includes(m))) return { x, y };
  }
  return null;
}

// What reaches the nose at pos: [{ key, kind, channel: 'smell', words, trueDist, trueBearing, x, y, strength }]
export function smellAt(sources, pos, wind, rng) {
  const out = [];
  for (const s of sources) {
    const d = Math.max(30, distM(pos, s)), b = bearing(pos, s);
    const off = Math.abs(((b - wind.from + 540) % 360) - 180); // 0 when the source lies straight upwind
    const up = Math.max(0, Math.cos(off * Math.PI / 180));
    const reach = s.range * (0.5 + wind.strength) * (0.12 + 0.88 * up * up);
    if (d > reach || !rng.chance(0.75)) continue; // odour comes in patches
    out.push({ key: s.key, kind: s.kind, channel: 'smell', words: s.words, trueDist: d, trueBearing: b, x: s.x, y: s.y, strength: 1 - d / reach, source: s });
  }
  return out;
}
