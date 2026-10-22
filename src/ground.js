// ground.js — the state of the land as the weather leaves it, day by day: snow, rain soaked in, how
// full the streams run, leaves on the trees and on the ground, and where the growing season stands.
//
// A state layer, not an event system. Each variable is a pure function of the world and the day,
// integrated from the sky (sky.js) from well before day 1 (on the climate's averages) and then on the
// day's actual weather, so it's the same however the player spent the days. Anything that cares reads
// it: walking and crossing read the water, foraging and tracking read the snow and the litter, the
// plants read the growing season, sleep reads the ground's wetness and snow. Nothing here calls them.
//
//   snow: snow water equivalent (mm) at the land's middling height: snowfall adds, a degree-day melt
//     (3 mm per °C of daily mean above freezing) takes away. melt: what melted today (mm).
//   rain: rain that fell today (mm); soak: an antecedent precipitation index (rain and melt, fading
//     15% a day), the usual hydrologist's proxy for how wet the ground is and how much runs off.
//   flow: how full the streams run against their average (1): a seasonal baseflow (high in spring,
//     low in late summer; in monsoon climates, following the rains a month behind) plus quickflow
//     from the soak. frozen: a week's mean below −4 °C: brooks and streams iced over.
//   growing: inside the growing season (temperate: the climate's mean daily temperature above 6 °C;
//     monsoon: the wet season and a month after), and phase: how far through it (0 at the start, 1 at
//     the end; −1 outside). From the climate, not the day's weather: plants follow the year.
//   leaf: deciduous canopy in leaf (0 bare .. 1 full): leafing out over three weeks of growing season,
//     falling over four weeks after. litter: fallen leaves on the ground (0..1+, a full leaf fall adds
//     1), rotting and flattening at about 0.5% a day.
// Numbers are judgement, to be tuned, not measurements.
import { clamp } from './rng.js';
import { weatherAt, temperature, dailyMeanTemp, dayOfYear, calendar, rainFactor } from './sky.js';

const SPIN = 150; // days run on the climate's averages before day 1
const DD = 3; // snowmelt, mm per °C·day
const DECAY = 0.85; // the soak keeps 85% a day
const AMOUNT = { rain: 1, storm: 3, snow: 1, blizzard: 2.2 }; // relative to a wet three-hour spell
const wrap = d => ((d % 365) + 365) % 365;

// the growing season from the climate: [start, end] days of the year (or null: always growing)
export function growingSeason(world) {
  if (world._growing !== undefined) return world._growing;
  const cal = calendar(world);
  let out = null;
  if (cal.monsoon) {
    const wet = d => rainFactor(world, d) > 1;
    let start = 0; while (start < 365 && !(wet(start) && !wet(start - 1))) start++;
    let end = start; while (end < start + 365 && wet(end)) end++;
    out = [wrap(start), wrap(end + 30)];
  } else {
    const mean = d => world.environment.meanTempC - cal.tempAmp * Math.cos(2 * Math.PI * (d - 15) / 365);
    const grows = d => mean(d) > 6;
    if (!grows(15)) { // a cold season: from the first warm day after midwinter to the last
      let start = 15; while (start < 380 && !grows(start)) start++;
      let end = start; while (end < start + 365 && grows(end)) end++;
      out = start >= 380 ? [200, 200] : [wrap(start), wrap(end)];
    }
  }
  return (world._growing = out);
}
export function seasonPhase(world, doy) { // −1 outside the growing season, else 0..1 through it
  const g = growingSeason(world);
  if (!g) return wrap(doy) / 365;
  const len = wrap(g[1] - g[0]) || 365, into = wrap(doy - g[0]);
  return into <= len ? into / len : -1;
}

function stepDay(world, prev, day, actual) {
  const doy = dayOfYear(world, day), P = world.environment.precipMm, share = clamp(P / 8000, 0.015, 0.4);
  const unit = P / (365 * 8 * share); // mm in a wet three-hour spell, so a year's spells add up to the rainfall
  let rain = 0, snowfall = 0;
  const meanC = actual ? [1.5, 4.5, 7.5, 10.5, 13.5, 16.5, 19.5, 22.5].reduce((a, t) => a + temperature(world, day, t), 0) / 8 : dailyMeanTemp(world, day);
  if (actual) for (let k = 0; k < 8; k++) {
    const w = weatherAt(world, day, k * 3 + 1.5), mm = (AMOUNT[w] ?? 0) * unit;
    if (w === 'snow' || w === 'blizzard') snowfall += mm; else rain += mm;
  } else { const mm = (P / 365) * rainFactor(world, doy); if (meanC < 0.5) snowfall = mm; else rain = mm; }
  const melt = Math.min(prev.snow + snowfall, DD * Math.max(0, meanC) + (prev.snow > 0 ? 0.1 * rain : 0));
  const snow = prev.snow + snowfall - melt;
  const soak = prev.soak * DECAY + rain + melt;
  const week = prev.week * 6 / 7 + meanC / 7;
  const frozen = week < -4;
  const cal = calendar(world), meanSoak = (P / 365) / (1 - DECAY);
  const base = cal.monsoon ? 0.4 + 0.6 * rainFactor(world, doy - 30) : 1 + 0.35 * Math.cos(2 * Math.PI * (doy - 75) / 365);
  const flow = clamp((0.35 * base + 0.65 * soak / meanSoak) * (frozen ? 0.4 : 1), 0, 8);
  const phase = seasonPhase(world, doy), growing = phase >= 0;
  const leaf = clamp(prev.leaf + (growing && phase < 0.9 ? 1 / 21 : -1 / 28));
  const litter = prev.litter * 0.995 + Math.max(0, prev.leaf - leaf);
  return { day, doy, meanC, snow, snowfall, melt, rain, soak, week, frozen, flow, phase, growing, leaf, litter };
}

// The ground on a day (from day 1; earlier days are the spin-up on averages).
export function groundAt(world, day) {
  const cache = (world._ground ??= []);
  const i = Math.max(0, Math.floor(day) + SPIN);
  if (!cache.length) {
    const d0 = 1 - SPIN, phase = seasonPhase(world, dayOfYear(world, d0)), m = dailyMeanTemp(world, d0);
    cache.push(stepDay(world, { snow: m < 0 ? 40 : 0, soak: (world.environment.precipMm / 365) / (1 - DECAY), week: m, leaf: phase >= 0 && phase < 0.9 ? 1 : 0, litter: 0.3 }, d0, false));
  }
  for (let k = cache.length; k <= i; k++) { const day = k - SPIN; cache.push(stepDay(world, cache[k - 1], day, day >= 1)); }
  return cache[i];
}

// ------------------------------------------------------------ per cell
// How much of the canopy here is deciduous: the share of the world's trees and bushes that drop leaves.
export function deciduousShare(world) {
  if (world._decid !== undefined) return world._decid;
  const woody = world.plants.filter(p => ['tree', 'shrub'].includes(p.form));
  return (world._decid = woody.length ? woody.filter(p => p.traits.deciduous).length / woody.length : 0);
}
const refElev = L => (L._refElev ??= L.elev.reduce((a, e) => a + e, 0) / L.elev.length);
// snow lying on a cell, in cm: more higher up, less under trees (the canopy catches some)
export function snowCm(L, g, c) {
  if (!g.snow || L.lake[c]) return 0;
  const swe = g.snow * clamp(1 + 0.004 * (L.elev[c] - refElev(L)), 0.2, 2.5) * (1 - 0.35 * L.veg[c]);
  return swe / 10 / 0.35; // settled snow about a third as dense as water
}
// fallen leaves on a cell: 0 none .. 1 a thick fresh layer (none showing under snow)
export const litterAt = (world, L, g, c) => (snowCm(L, g, c) > 3 ? 0 : clamp(g.litter * L.veg[c] * deciduousShare(world) * 1.6));

// ------------------------------------------------------------ water in a channel cell
// Depth and speed at average flow, by size (brook, stream, river), steeper channels running faster;
// with more or less water, depth goes as flow^0.4 and speed as flow^0.25 (Leopold and Maddock's
// hydraulic geometry, roughly). Brooks dry up below 40% of their average flow, streams below 15%;
// rivers don't.
const DEPTH = [0, 0.15, 0.4, 0.9], DRY = [0, 0.4, 0.15, 0], SPEED = [0, 0.6, 0.9, 1.1];
export function waterAt(L, g, c) {
  const size = L.chan[c];
  if (!size || L.lake[c]) return null;
  const frozen = g.frozen && size < 3, dry = !frozen && g.flow < DRY[size]; // ice isn't a dry bed
  const depth = dry ? 0 : DEPTH[size] * Math.pow(g.flow, 0.4);
  const speed = dry ? 0 : clamp(0.3 + 3.5 * L.slope[c], 0.2, 2.2) * SPEED[size] * Math.pow(g.flow, 0.25);
  return { size, depth, speed, dry, frozen, flood: g.flow > 2.2 };
}
// What it takes to get over the water at this cell, as hours on top of the walking, and whether the
// current carries me off. A crossing above the water (a log, boulders) or a dry bed or ice is a
// minute's scramble; a ford spreads the water thin (40% of the depth); otherwise wading time grows with
// depth and speed, and past about 0.6 m²/s of depth × speed (where people are knocked off their feet)
// or 1.3 m of depth, the current takes me downstream: `swept`, the number of cells.
export function crossingNow(L, g, c, crossing = null) {
  const w = waterAt(L, g, c);
  if (!w) return { hours: 0, swept: 0, how: null };
  if (w.dry) return { hours: 0.01, swept: 0, how: 'dry' };
  if (w.frozen) return { hours: 0.02, swept: 0, how: 'ice' };
  if (crossing && crossing.height > w.depth + 0.05) return { hours: 0.015, swept: 0, how: crossing.kind };
  const d = w.depth * (crossing?.kind === 'ford' ? 0.4 : 1), ds = d * w.speed;
  const swept = ds > 0.6 || d > 1.3 ? Math.round(clamp(2 + 6 * (ds - 0.6), 2, 10)) : 0;
  return { hours: 0.02 + 0.094 * d * (1 + w.speed) + (swept ? 0.25 : 0), swept, how: crossing?.kind === 'ford' ? 'ford' : swept ? 'swept' : 'wade', depth: d, speed: w.speed };
}
