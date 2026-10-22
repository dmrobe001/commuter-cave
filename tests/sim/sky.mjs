// The sky and the seasons (sky.js), against what's known about the real ones, plus the animals'
// response (life.js animalNow, notes.js). Checks:
// - day length: about 12 h at the equinoxes everywhere; longer in summer than winter away from the
//   equator, more so further from it; a world at 48° gets 15–16.5 h at midsummer;
// - the moon: full at half its cycle, the cycle 29.53 days; a high full moon lights a clear night to
//   about a tenth of a lux, a moonless one to thousandths; a clear noon to tens of thousands;
// - weather: rainier climates rain more; snow only when it's cold; fog only between midnight and late
//   morning; monsoon climates rain more in the wet season than the dry; the same world gives the same
//   weather whatever order it's asked in;
// - animals: dormant species aren't seen in the cold; breeding birds and frogs give their season's call,
//   which is new to someone who knows only the everyday call ("Something calling"), and it isn't
//   heard out of season.
// Usage: node tests/sim/sky.mjs
import { generateWorld } from '../../src/generator.js';
import { newMemory, observeSite } from '../../src/notes.js';
import { animalNow } from '../../src/life.js';
import * as sky from '../../src/sky.js';
const fails = [], say = [];
const worldAt = (seed, opts = {}) => generateWorld(seed, opts);
const dayFor = (w, doy) => 1 + ((doy - sky.calendar(w).doy0 + 365 * 2) % 365);

// day length
for (const [seed, preset] of [['a', 'warm-savanna'], ['b', 'temperate-woodland'], ['c', 'cool-forest']]) {
  const w = worldAt(seed, { preset }), lat = sky.calendar(w).lat;
  const eq = sky.dayLength(w, dayFor(w, 80)), mid = sky.dayLength(w, dayFor(w, 172)), win = sky.dayLength(w, dayFor(w, 355));
  say.push(`${preset} (lat ${lat.toFixed(0)}°): equinox ${eq.toFixed(1)} h, midsummer ${mid.toFixed(1)} h, midwinter ${win.toFixed(1)} h`);
  if (Math.abs(eq - 12) > 0.4) fails.push(`${preset}: ${eq.toFixed(1)} h at the equinox`);
  if (!(mid > win)) fails.push(`${preset}: summer days no longer than winter ones`);
  if (lat > 45 && lat < 51 && (mid < 15 || mid > 16.5)) fails.push(`${preset}: ${mid.toFixed(1)} h at midsummer at ${lat.toFixed(0)}°`);
}
// moon and light
{
  const w = worldAt('moon', { preset: 'temperate-woodland' });
  let full = null;
  for (let d = 1; d <= 30 && !full; d++) if (sky.moonAt(w, d, 0).illum > 0.98) full = d;
  const later = sky.moonAt(w, full + 29.53, 0);
  if (!full || later.illum < 0.95) fails.push('the moon doesn\'t come round full again after 29.53 days');
  const noonLux = sky.skyAt(w, 10, 12).lux;
  // a clear night with the full moon high, and a clear moonless one
  let fullLux = null, darkLux = null;
  for (let d = 1; d <= 60; d++) for (const t of [22, 23, 0, 1, 2]) {
    const k = sky.skyAt(w, d, t);
    if (k.weather !== 'clear' || k.sunAlt > -18) continue;
    if (k.moon.illum > 0.95 && k.moon.alt > 30) fullLux ??= k.lux;
    if (k.moon.alt < 0) darkLux ??= k.lux;
  }
  say.push(`light: clear-ish noon ${noonLux.toFixed(0)} lux; high full moon ${fullLux?.toFixed(3)} lux; moonless ${darkLux?.toFixed(4)} lux`);
  if (!(noonLux > 2000)) fails.push(`noon is only ${noonLux.toFixed(0)} lux`);
  if (fullLux == null || fullLux < 0.05 || fullLux > 0.4) fails.push(`a high full moon gives ${fullLux} lux`);
  if (darkLux == null || darkLux > 0.01) fails.push(`a moonless clear night gives ${darkLux} lux`);
}
// weather
{
  const share = (w, test) => { let n = 0, k = 0; for (let d = 1; d <= 365; d++) for (let t = 1.5; t < 24; t += 3) { n++; if (test(sky.weatherAt(w, d, t), d, t)) k++; } return k / n; };
  const wet = s => ['rain', 'storm', 'snow', 'blizzard'].includes(s);
  const dry = worldAt('w1', { preset: 'dry-scrub' }), damp = worldAt('w2', { preset: 'cool-forest' });
  const a = share(dry, wet), b = share(damp, wet);
  say.push(`weather: wet ${(100 * a).toFixed(0)}% of the time in dry scrub (${dry.environment.precipMm} mm), ${(100 * b).toFixed(0)}% in cool forest (${damp.environment.precipMm} mm)`);
  if (!(b > a)) fails.push('the wetter climate doesn\'t rain more');
  for (const w of [dry, damp]) {
    for (let d = 1; d <= 365; d++) for (let t = 1.5; t < 24; t += 3) {
      const s = sky.weatherAt(w, d, t);
      if ((s === 'snow' || s === 'blizzard') && sky.temperature(w, d, t, 'cloudy') > 1) { fails.push(`${w.seed}: snow at ${sky.temperature(w, d, t, 'cloudy').toFixed(1)} °C`); d = 999; break; }
      if (s === 'fog' && (t < 1 || t > 10.5)) { fails.push(`${w.seed}: fog at ${t} h`); d = 999; break; }
    }
  }
  const mon = worldAt('w3', { preset: 'warm-savanna' });
  const inSeason = name => share(mon, (s, d) => wet(s) && sky.seasonOf(mon, sky.dayOfYear(mon, d)) === name) / share(mon, (s, d) => sky.seasonOf(mon, sky.dayOfYear(mon, d)) === name);
  say.push(`monsoon: wet ${(100 * inSeason('wet season')).toFixed(0)}% of the wet season, ${(100 * inSeason('dry season')).toFixed(0)}% of the dry`);
  if (!(inSeason('wet season') > 2 * inSeason('dry season'))) fails.push('the wet season isn\'t much wetter than the dry');
  // the same weather whichever order it's asked for
  const x = worldAt('w2', { preset: 'cool-forest' }), y = worldAt('w2', { preset: 'cool-forest' });
  const late = sky.weatherAt(x, 40, 13.5);
  for (let d = 1; d <= 40; d++) sky.weatherAt(y, d, 1.5);
  if (sky.weatherAt(y, 40, 13.5) !== late) fails.push('the weather depends on the order it was asked for');
}
// animals through the year
{
  let calls = 0, newCalls = 0, offSeason = 0, coldSeen = 0, checked = 0;
  for (const seed of ['gbn2f', 'm', 'pig-rock', 'c', 'h', 'q']) {
    const w = worldAt(seed);
    const singers = w.animals.filter(a => a.behaviour?.breedCall && a.behaviour.breed && ['songbird', 'groundbird', 'frog'].includes(a.traits.key));
    for (const a of singers) {
      const micro = a.habitats[0].micro, inside = (a.behaviour.breed[0] + a.behaviour.breed[1]) / 2, outside = (a.behaviour.breed[1] + 100) % 365;
      // someone who knows the everyday call well: it's in memory and linked to the bird
      const mem = newMemory();
      mem.signs[`call:${a.signs.call}`] = { channel: 'call', desc: a.signs.call, count: 5, linked: a.id };
      mem.noveltyAware = true;
      for (let i = 0; i < 40; i++) {
        const out = observeSite(w, mem, { site: `s${i}`, micro, time: 'dawn', cond: { doy: inside, meanC: 15, weather: 'clear', wet: false, light: 1, hearing: 1 } });
        if (out.text.includes(a.behaviour.breedCall)) { calls++; if (/Something calling|New call|Heard something new|A call from somewhere close/.test(out.text)) newCalls++; }
      }
      const mem2 = newMemory();
      for (let i = 0; i < 40; i++) if (observeSite(w, mem2, { site: `o${i}`, micro, time: 'dawn', cond: { doy: outside, meanC: 15, weather: 'clear', wet: false, light: 1, hearing: 1 } }).text.includes(a.behaviour.breedCall)) offSeason++;
    }
    for (const a of w.animals.filter(a => a.behaviour?.dormant != null)) {
      const cold = { doy: 20, meanC: a.behaviour.dormant - 5, weather: 'clear', wet: false, light: 1, hearing: 1 };
      if (animalNow(a, cold).here) fails.push(`${seed}: ${a.name} is about at ${cold.meanC} °C, below its dormancy at ${a.behaviour.dormant} °C`);
      const mem = newMemory();
      for (let i = 0; i < 20; i++) { checked++; if (observeSite(w, mem, { site: `c${i}`, micro: a.habitats[0].micro, time: 'day', cond: cold }).noticed.includes(a.id)) coldSeen++; }
    }
  }
  say.push(`animals: the season's calls heard ${calls} times in season (${newCalls} of them as a new sound), ${offSeason} out of season; dormant animals noticed ${coldSeen} times in ${checked} cold visits`);
  if (!calls) fails.push('no season\'s call heard in season');
  if (newCalls < calls * 0.5) fails.push('the season\'s call isn\'t usually reported as a new sound');
  if (offSeason) fails.push('the season\'s call heard out of season');
  if (coldSeen) fails.push('dormant animals noticed in the cold');
}
console.log('sky:\n  ' + say.join('\n  '));
if (fails.length) { console.log('FAIL\n  ' + fails.slice(0, 12).join('\n  ')); process.exit(1); }
console.log('sky: all passed');
