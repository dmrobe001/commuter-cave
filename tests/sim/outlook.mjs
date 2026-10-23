// Start-screen outlook across worlds (outlook.js): the nearest water, the best food rate and the fire
// estimate, each a yearly average with a "seasonal" mark when the months differ widely. Prints each
// world's line and its month-by-month numbers; fails on a number that isn't one, or a "seasonal" mark
// the months don't bear out. Plus a check on the panorama: one percept per source, never more.
import { generateWorld } from '../../src/generator.js';
import { generateLandscape } from '../../src/landscape.js';
import { chooseSpawn, hear } from '../../src/geo.js';
import { estimateFire } from '../../src/craft.js';
import { outlook } from '../../src/outlook.js';
const seeds = ['pig-rock', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', ...Array.from({ length: 20 }, (_, i) => `s${i}`)].slice(0, process.env.QUICK ? 8 : 30); // QUICK=1: 8 worlds
const fails = [], f1 = x => (x == null ? '—' : Number.isFinite(x) ? x.toFixed(1) : '∞');
let dupes = 0, seasonal = { water: 0, food: 0, fire: 0 };
for (const seed of seeds) {
  const w = generateWorld(seed, { mcSamples: 40 });
  const L = generateLandscape(w);
  const sp = chooseSpawn(L, seed);
  const o = outlook(w, L, sp, estimateFire(w), seed);
  const heard = hear(L, sp, { boost: 1.6 });
  if (new Set(heard.map(c => c.key)).size !== heard.length) dupes++;
  console.log(`${seed.padEnd(9)}${sp.fallback ? ' (fallback)' : ''} ${Object.values(o.text).join('; ')}`);
  console.log(`          water h by month: ${o.water.months.map(f1).join(' ')}`);
  if (o.food.best) console.log(`          food kcal/h by month (${o.food.best.name}${o.food.best.safe ? '' : ', cooked'}): ${o.food.best.months.map(x => Math.round(x)).join(' ')}`);
  console.log(`          fire days by month: ${o.fire.months.map(f1).join(' ')}`);
  if (Number.isNaN(o.water.hours) || Number.isNaN(o.food.perHour) || Number.isNaN(o.fire.median ?? 0)) fails.push(`${seed}: a number that isn't one: ${JSON.stringify({ water: o.water.hours, food: o.food.perHour, fire: o.fire.median })}`);
  if (/NaN|undefined/.test(Object.values(o.text).join(' '))) fails.push(`${seed}: ${Object.values(o.text).join('; ')}`);
  const m = o.food.source?.months;
  if (m && o.food.seasonal !== (Math.max(...m) - Math.min(...m) > o.food.perHour)) fails.push(`${seed}: food marked ${o.food.seasonal ? '' : 'not '}seasonal against its months`);
  for (const k of ['water', 'food', 'fire']) if (o[k].seasonal) seasonal[k]++;
}
console.log(`\nmarked seasonal: water in ${seasonal.water}, food in ${seasonal.food}, fire in ${seasonal.fire} of ${seeds.length} worlds`);
console.log(`worlds with a source heard twice in one scan: ${dupes} (want 0)`);
if (dupes) fails.push(`${dupes} worlds heard a source twice in one scan`);
if (fails.length) { console.log('FAIL\n  ' + fails.slice(0, 10).join('\n  ')); process.exit(1); }
console.log('outlook: all passed');
