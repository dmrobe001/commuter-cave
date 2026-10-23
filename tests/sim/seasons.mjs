// Nothing is described by a part that isn't there this season: for every plant in a few worlds, on a
// day in the middle of the growing season and a day well outside it, the words naming it (field notes'
// naming sentences) mention berries, fruit, nuts, pods or seed heads only while that part shows, and
// leaves only while it's in leaf. Usage: node tests/sim/seasons.mjs
import { generateWorld } from '../../src/generator.js';
import { newMemory, namingSentences } from '../../src/notes.js';
import { groundAt } from '../../src/ground.js';
import { cueShows, fruitShows, plantNow } from '../../src/phenology.js';
import { makeRng } from '../../src/rng.js';
const seeds = process.env.QUICK ? ['gbn2f', 'hmfqm'] : ['c', 'm', 'pig-rock', 'gbn2f', 'hmfqm', 'a', 'b', 'h'];
const FRUIT = /berries|fleshy fruits|stonefruit|nuts|pods|seed heads|dry seeds/;
const fails = [];
let checked = 0, hidden = 0;
for (const seed of seeds) {
  const w = generateWorld(seed, {});
  if (w.environment.seasonality <= 0.35) continue; // no lean season to test against
  const days = Array.from({ length: 365 }, (_, i) => groundAt(w, i + 1));
  const summer = days.find(g => g.phase > 0.75 && g.phase < 0.85), winter = days.find(g => g.phase < 0 && g.leaf < 0.1);
  for (const [when, g] of [['late summer', summer], ['winter', winter]]) {
    if (!g) continue;
    for (const p of w.plants) {
      const text = namingSentences([p], newMemory(), 'n0', null, makeRng('x'), { world: w, g }).join(' ');
      checked++;
      const fruitWords = FRUIT.test(text), showsFruit = p.cues.some(c => FRUIT.test(c) && cueShows(w, p, c, g));
      if (fruitWords && !showsFruit) fails.push(`${seed} ${when}: ${p.name} described by fruit it doesn't have now: ${text}`);
      if (!fruitShows(w, p, g) && p.cues.some(c => FRUIT.test(c))) hidden++;
      if (/leaves|blades/.test(text) && plantNow(w, p, g).leaf < 0.3) fails.push(`${seed} ${when}: ${p.name} described by leaves while bare: ${text}`);
    }
  }
}
console.log(`seasons: ${checked} plant descriptions checked; ${hidden} times a fruiting plant had no fruit to show`);
if (!hidden) fails.push('never found a plant out of fruit: the test checked nothing');
if (fails.length) { console.log('FAIL\n  ' + fails.slice(0, 10).join('\n  ')); process.exit(1); }
console.log('seasons: all passed');
