// Two features of the world: crossings and eggs.
// Crossings (a ford, a tree down across the water, a rockfall) sit on stream and river cells, never
// within five cells of each other, and getting over the water there takes about a minute instead of
// about five. Egg-laying animals (ground birds, songbirds, lizards) have eggs worth eating: about 10%
// fat and 13% protein, germs on the shell that cooking kills, listed in the world's tables.
// Usage: node tests/sim/crossings-eggs.mjs
import { generateWorld } from '../../src/generator.js';
import { generateLandscape, N } from '../../src/landscape.js';
import { stepHours } from '../../src/geo.js';
import { expose, nutrients, PREP } from '../../src/food.js';
import { toLong } from '../../src/tables.js';
const seeds = process.env.QUICK ? ['m', 'gbn2f'] : ['m', 'gbn2f', 'hmfqm', 'pig-rock', 'c', 'h', 'adzsb', 'wgxdd'];
const fails = [], kinds = {};
let eggLayers = 0;
for (const seed of seeds) {
  const w = generateWorld(seed, {}), L = generateLandscape(w);
  for (const q of L.features.crossings) {
    const c = q.y * N + q.x;
    kinds[q.kind] = (kinds[q.kind] ?? 0) + 1;
    if (L.chan[c] < 2 || L.lake[c]) fails.push(`${seed}: a ${q.kind} at ${q.x},${q.y} isn't on a stream or river`);
    if (L.features.crossings.some(o => o !== q && Math.max(Math.abs(o.x - q.x), Math.abs(o.y - q.y)) < 5)) fails.push(`${seed}: two crossings within five cells at ${q.x},${q.y}`);
    // stepping onto it, against stepping onto the same water without it
    const from = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: q.x + dx, y: q.y + dy })).find(p => p.x >= 0 && p.y >= 0 && p.x < N && p.y < N && !L.chan[p.y * N + p.x]);
    if (!from) continue;
    const withIt = stepHours(L, from, q); L.crossing[c] = 0; const without = stepHours(L, from, q); L.crossing[c] = { ford: 1, deadfall: 2, rockfall: 3 }[q.kind];
    if (!(without - withIt > 0.05)) fails.push(`${seed}: the ${q.kind} at ${q.x},${q.y} saves only ${((without - withIt) * 60).toFixed(1)} min`);
  }
  const rows = toLong(w);
  for (const a of w.animals.filter(a => a.eggs)) {
    eggLayers++;
    const e = a.eggs.chem, raw = nutrients(e, 0.1), cooked = expose(e, PREP.boil);
    if (e.cls !== 'egg' || e.fat < 0.08 || e.protein < 0.11) fails.push(`${seed}: ${a.name} eggs have an odd make-up: ${JSON.stringify(e)}`);
    if (!(nutrients(cooked, 0.1).protein > raw.protein)) fails.push(`${seed}: cooking ${a.name} eggs doesn't make their protein easier to get at`);
    if ((cooked.compounds.parasites ?? 0) >= (e.compounds.parasites ?? 0) && e.compounds.parasites) fails.push(`${seed}: cooking ${a.name} eggs doesn't kill their germs`);
    if (!rows.some(r => r.entity === a.id && r.part === 'eggs' && r.property === 'raw')) fails.push(`${seed}: ${a.name} eggs aren't in the tables`);
  }
}
console.log(`crossings-eggs: crossings ${JSON.stringify(kinds)}; ${eggLayers} egg-laying species over ${seeds.length} worlds`);
if (!eggLayers) fails.push('no egg-laying animals in any world');
if (fails.length) { console.log('FAIL\n  ' + fails.slice(0, 10).join('\n  ')); process.exit(1); }
console.log('crossings-eggs: all passed');
