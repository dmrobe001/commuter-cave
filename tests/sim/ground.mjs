// The land through the year (ground.js), the plants' seasons (phenology.js) and sleep (body.js).
// Checks:
// - snow builds through a cold world's winter and is gone by midsummer; a warm world never has any;
// - streams run fuller after a wet spell than a dry one; in a monsoon world brooks go dry in the dry
//   season; in a cold winter brooks freeze (and frozen isn't dry);
// - crossing: deeper and faster water takes longer; a log above the water is quick whatever the water;
//   a ford is easier than wading the same water; in flood the current takes a walker downstream;
// - leaf litter peaks after the leaves fall in a deciduous world, and none shows under snow;
// - the plants: late-season fruit only late in the growing season, early flowers early, herbs died
//   back outside it;
// - sleep: colder is worse; a hut, a bed and a fire each help; rain on me and wet clothes hurt; a mild
//   summer night in the open is fair, a freezing one wretched, and a hut with a bed sleeps warm at 0 °C;
// - the ground is the same however it's asked for.
// Usage: node tests/sim/ground.mjs
import { generateWorld } from '../../src/generator.js';
import { generateLandscape, N } from '../../src/landscape.js';
import { walk } from '../../src/geo.js';
import { groundAt, waterAt, crossingNow, snowCm, litterAt, deciduousShare } from '../../src/ground.js';
import { partNow, plantNow } from '../../src/phenology.js';
import { sleepHour, SHELTERS } from '../../src/body.js';
import * as sky from '../../src/sky.js';
const fails = [], say = [];
const dayFor = (w, doy) => 1 + ((doy - sky.calendar(w).doy0 + 730) % 365);
const year = (w, f) => Array.from({ length: 365 }, (_, i) => f(groundAt(w, i + 1), i + 1));

// snow and ice
{
  const cold = generateWorld('g1', { preset: 'cool-forest' }), warm = generateWorld('g2', { preset: 'warm-savanna' });
  const midwinter = groundAt(cold, dayFor(cold, 40)), midsummer = groundAt(cold, dayFor(cold, 200));
  say.push(`cool forest: snow ${midwinter.snow.toFixed(0)} mm water in early February, ${midsummer.snow.toFixed(0)} in July; brooks frozen ${year(cold, g => g.frozen).filter(Boolean).length} days a year`);
  if (!(midwinter.snow > 20)) fails.push('no snow in a cool forest\'s winter');
  if (midsummer.snow > 0) fails.push('snow lying in a cool forest\'s midsummer');
  if (year(warm, g => g.snow).some(x => x > 0)) fails.push('snow in a warm savanna');
  const L = generateLandscape(cold), brook = L.chan.findIndex((v, c) => v === 1 && !L.lake[c]);
  const iced = year(cold, g => g).find(g => g.frozen);
  if (!iced) fails.push('a cool forest\'s brooks never freeze');
  else { const w = waterAt(L, iced, brook); if (!w.frozen || w.dry) fails.push('a frozen brook reads as dry, or not frozen'); }
}
// stream flow
{
  const w = generateWorld('g3', { preset: 'temperate-woodland' }), gs = year(w, g => g);
  const wettest = gs.reduce((a, b) => (b.soak > a.soak ? b : a)), driest = gs.reduce((a, b) => (b.soak < a.soak ? b : a));
  say.push(`temperate woodland: flow ${driest.flow.toFixed(2)} after the driest spell, ${wettest.flow.toFixed(2)} after the wettest`);
  if (!(wettest.flow > 2 * driest.flow)) fails.push('streams don\'t run fuller after rain');
  const mon = generateWorld('g4', { preset: 'warm-savanna' }), mg = year(mon, g => g), L = generateLandscape(mon);
  const brook = L.chan.findIndex((v, c) => v === 1 && !L.lake[c]);
  const dryInDry = mg.filter(g => sky.seasonOf(mon, g.doy) === 'dry season' && waterAt(L, g, brook).dry).length, dryInWet = mg.filter(g => sky.seasonOf(mon, g.doy) === 'wet season' && waterAt(L, g, brook).dry).length;
  say.push(`savanna brook: dry ${dryInDry} days of the dry season, ${dryInWet} of the wet`);
  if (!(dryInDry > 2 * dryInWet + 10)) fails.push('a savanna brook isn\'t dry mostly in the dry season');
}
// crossing
{
  const w = generateWorld('m'), L = generateLandscape(w);
  const river = L.chan.findIndex((v, c) => v >= 2 && !L.lake[c] && L.slope[c] > 0.01);
  const at = flow => crossingNow(L, { flow, frozen: false }, river);
  const low = at(0.5), mid = at(1), high = at(3), flood = at(7);
  say.push(`crossing a ${['', 'brook', 'stream', 'river'][L.chan[river]]}: ${low.hours.toFixed(2)} h at half flow, ${mid.hours.toFixed(2)} at average, ${high.hours.toFixed(2)} at triple${high.swept ? ' (swept)' : ''}, ${flood.hours.toFixed(2)} in flood${flood.swept ? ` (swept ${flood.swept} cells)` : ''}`);
  if (!(low.hours < mid.hours && mid.hours < high.hours)) fails.push('crossing doesn\'t get harder as the water rises');
  if (!flood.swept) fails.push('a flood doesn\'t sweep a walker away');
  const log = crossingNow(L, { flow: 1, frozen: false }, river, { kind: 'deadfall', height: 1.0 });
  if (!(log.hours < mid.hours) || log.swept) fails.push('a log above the water isn\'t the easy way over');
  const ford = crossingNow(L, { flow: 3, frozen: false }, river, { kind: 'ford', height: 0 });
  if (!(ford.hours < high.hours)) fails.push('a ford isn\'t easier than wading');
  // a walk across that river in flood is carried downstream
  L.dyn = { cross: c => crossingNow(L, { flow: 7, frozen: false }, c), slow: () => 1, sound: () => 1 };
  const x = river % N, y = Math.floor(river / N);
  let swept = 0;
  for (const [dx, dy] of [[-3, 0], [0, -3], [-3, -3], [3, 0], [0, 3]]) {
    const from = { x: Math.max(0, x + dx), y: Math.max(0, y + dy) }, to = { x: Math.min(N - 1, x - dx), y: Math.min(N - 1, y - dy) };
    if (L.chan[from.y * N + from.x] || L.lake[from.y * N + from.x]) continue;
    const t = walk(L, from, to, { rng: { normal: () => 0, next: () => 0.5 }, maxHours: 2 });
    swept += t.sweeps.length;
  }
  if (!swept) fails.push('no walk across a flooding river got swept');
  delete L.dyn;
}
// litter and the plants' seasons
{
  const w = generateWorld('gbn2f'), L = generateLandscape(w), gs = year(w, g => g);
  const peak = gs.reduce((a, b) => (b.litter > a.litter ? b : a));
  say.push(`gbn2f (deciduous share ${deciduousShare(w).toFixed(2)}): litter peaks on day of year ${Math.round(peak.doy % 365)} at ${peak.litter.toFixed(2)}`);
  const woods = L.veg.findIndex(v => v > 0.7);
  const snowy = gs.find(g => snowCm(L, g, woods) > 5);
  if (snowy && litterAt(w, L, snowy, woods) > 0) fails.push('leaf litter showing through snow');
  if (!(peak.phase === -1 || peak.phase > 0.8)) fails.push(`litter peaks at season phase ${peak.phase.toFixed(2)}, not after leaf fall`);
  const fruiter = w.plants.find(p => p.parts.some(x => /^late growing season/.test(x.season ?? '') && /fruit|berr/.test(x.part)));
  const flowerer = w.plants.find(p => p.parts.some(x => x.part === 'flowers' && /^early/.test(x.season ?? '')));
  const herb = w.plants.find(p => p.form === 'herb');
  const fruitPart = fruiter.parts.find(x => /fruit|berr/.test(x.part)).part;
  const fruitDays = gs.filter(g => partNow(w, fruiter, fruitPart, g) > 0.5), flowerDays = gs.filter(g => partNow(w, flowerer, 'flowers', g) > 0.5);
  say.push(`${fruiter.name} ${fruitPart} out ${fruitDays.length} days, at season phase ${Math.min(...fruitDays.map(g => g.phase)).toFixed(2)}–${Math.max(...fruitDays.map(g => g.phase)).toFixed(2)}; ${flowerer.name} flowers ${flowerDays.length} days, phase ${Math.min(...flowerDays.map(g => g.phase)).toFixed(2)}–${Math.max(...flowerDays.map(g => g.phase)).toFixed(2)}`);
  if (!fruitDays.length || fruitDays.some(g => g.phase < 0.45)) fails.push(`${fruiter.name}'s ${fruitPart} out early in the season`);
  if (!flowerDays.length || flowerDays.some(g => g.phase > 0.5)) fails.push(`${flowerer.name}'s flowers out late in the season`);
  if (gs.filter(g => g.phase < 0).some(g => plantNow(w, herb, g).leaf > 0.2)) fails.push(`${herb.name} in leaf outside the growing season`);
}
// sleep
{
  const cl = { clo: 1, wet: 0 }, body = { energy: 0.6, hyd: 0.7, limp: 0 };
  const night = (T, shelter, bed = null, fireC = 0, extra = {}) => sleepHour({ env: { tempC: T, windMs: 3, precip: null, groundWet: 0.3, snowCm: 0, biters: false, ...extra.env }, shelter, bed, clothes: extra.clothes ?? cl, fireC, body }).quality;
  const open15 = night(15, SHELTERS.open), open0 = night(0, SHELTERS.open), hutBed0 = night(0, SHELTERS.hut, { clo: 1, wet: 0 });
  say.push(`sleep quality: open ground at 15 °C ${open15.toFixed(2)}, at 0 °C ${open0.toFixed(2)}; hut and bed at 0 °C ${hutBed0.toFixed(2)}; open at 10 °C in rain with wet clothes ${night(10, SHELTERS.open, null, 0, { env: { precip: 'rain' }, clothes: { clo: 1, wet: 0.8 } }).toFixed(2)}`);
  if (open15 < 0.35 || open15 > 0.75) fails.push(`a mild night in the open: quality ${open15.toFixed(2)}, not fair`);
  if (open0 > 0.35) fails.push(`a freezing night in the open: quality ${open0.toFixed(2)}, not wretched`);
  if (hutBed0 < 0.9) fails.push(`a hut with a bed at 0 °C: quality ${hutBed0.toFixed(2)}, not warm`);
  for (const T of [15, 5, -5]) {
    if (!(night(T, SHELTERS.open) <= night(T + 5, SHELTERS.open))) fails.push('a colder night sleeps better');
    if (!(night(T, SHELTERS.open, { clo: 1, wet: 0 }) > night(T, SHELTERS.open))) fails.push(`a bed doesn't help at ${T} °C`);
    if (!(night(T, SHELTERS.open, null, 5) > night(T, SHELTERS.open))) fails.push(`a fire doesn't help at ${T} °C`);
    if (!(night(T, SHELTERS.open, null, 0, { clothes: { clo: 1, wet: 0.8 } }) < night(T, SHELTERS.open))) fails.push(`wet clothes don't hurt at ${T} °C`);
    if (!(night(T, SHELTERS.open, null, 0, { env: { precip: 'rain' } }) < night(T, SHELTERS.open))) fails.push(`rain doesn't hurt at ${T} °C`);
  }
}
// determinism
{
  const a = generateWorld('g5', { preset: 'cool-forest' }), b = generateWorld('g5', { preset: 'cool-forest' });
  const late = groundAt(a, 120);
  if (JSON.stringify(groundAt(b, 120)) !== JSON.stringify(late)) fails.push('the ground depends on the order it was asked for');
}
console.log('ground:\n  ' + say.join('\n  '));
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('ground: all passed');
