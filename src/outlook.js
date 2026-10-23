// outlook.js — the start screen's blurb on water, food and fire near where I wake.
//
// Each is the best source within reach, averaged over the year (the middle day of each month), and
// marked "seasonal" when the months differ widely. These are rates and distances from what's there,
// not a simulation of a beginner finding it:
//   water  the walk to the nearest water that's running (or standing) that month, from the spawn: the
//          straight line, at 3 km/h, with 40% added for the way round. Brooks and streams that dry up
//          don't count while they're dry; ice does (it can be broken). Seasonal when the worst month
//          is over twice the best and a quarter-hour more, or has no water within 3 km.
//   food   for each food a bare-handed beginner can take (a plant part gathered by hand, a slow
//          creature caught by hand), in each microhabitat it lives in near the spawn (within 1.5 km):
//            kcal per hour = how often a stop finds it  ×  kcal from gathering it there
//                            ÷  hours per stop (the walk to the next patch of that ground, a survey, a
//                               half hour's gathering)
//          where a stop finds it with the game's own presence chance at its usual abundance, and its
//          kcal is the net energy of a half hour's gathering eaten raw (food.js). That month's rate
//          is the year's rate times how much of it there is (phenology.js; animals: about or not).
//          The best yearly average among those safe to eat raw, and the best overall, if better
//          but only once cooked. Seasonal when the swing between months is bigger than the average.
//   fire   the closed-form fire estimate (craft.js estimateFire), its median day, with each month's
//          dampness (wood left out takes the air's dampness: the climate's usual, moved by how much
//          wetter or drier the month's weather runs than the year's, as the game reckons dampness);
//          the year's average over the months it can be done at all. Seasonal when the
//          worst month is over twice the best, or out of reach.

import { CELL, N } from './landscape.js';
import { nutrients, harm } from './food.js';
import { groundAt, waterAt } from './ground.js';
import { partNow } from './phenology.js';
import { animalNow } from './life.js';
import { estimateFire } from './craft.js';
import { clamp } from './rng.js';
import { skyAt } from './sky.js';

const idx = (x, y) => y * N + x;
const MONTHS = Array.from({ length: 12 }, (_, m) => Math.round(15 + m * 30.42)); // the middle day of each month
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

// ------------------------------------------------------------ water

const WATER_R = 38; // cells: about 3 km
export function estimateWater(world, L, spawn) {
  const lakes = [], chans = [];
  for (let dy = -WATER_R; dy <= WATER_R; dy++) for (let dx = -WATER_R; dx <= WATER_R; dx++) {
    const x = spawn.x + dx, y = spawn.y + dy;
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const c = idx(x, y), d = Math.hypot(dx, dy);
    if (L.lake[c]) lakes.push(d); else if (L.chan[c]) chans.push({ c, d });
  }
  const nearLake = lakes.length ? Math.min(...lakes) : Infinity;
  const months = MONTHS.map(day => {
    const g = groundAt(world, day);
    let d = nearLake;
    for (const { c, d: dc } of chans) if (dc < d && !waterAt(L, g, c).dry) d = dc;
    return Number.isFinite(d) ? (d * CELL / 1000 / 3) * 1.4 : Infinity; // hours
  });
  const finite = months.filter(Number.isFinite), best = Math.min(...months), worst = Math.max(...months);
  return { hours: finite.length ? mean(finite) : Infinity, months, seasonal: worst === Infinity ? finite.length > 0 : worst > 2 * best + 0.25 };
}

// ------------------------------------------------------------ food

const NEAR = 19; // cells: about 1.5 km
const WALK_KMH = 2.5, SURVEY = 0.75, GATHER = 0.5; // a forager's pace between patches; hours to look over a patch and to gather
export function estimateFood(world, L, spawn) {
  // the ground around the spawn: each microhabitat's share of it
  const share = {}; let n = 0;
  for (let dy = -NEAR; dy <= NEAR; dy++) for (let dx = -NEAR; dx <= NEAR; dx++) {
    const x = spawn.x + dx, y = spawn.y + dy;
    if (x < 0 || y < 0 || x >= N || y >= N || dx * dx + dy * dy > NEAR * NEAR) continue;
    const m = L.micro[idx(x, y)] === 'lake' ? 'pond' : L.micro[idx(x, y)];
    share[m] = (share[m] ?? 0) + 1; n++;
  }
  // foods a beginner can take bare-handed: { name, kind, chem, habitats, now(g) → 0..1 }
  const sources = [
    ...world.plants.flatMap(p => p.parts.filter(x => x.food && x.chem && /^hands/.test(x.collect ?? '')).map(x => ({ name: `${p.name} ${x.part}`, kind: x.chem.cls, chem: x.chem, habitats: p.habitats, now: g => partNow(world, p, x.part, g) }))),
    ...world.animals.filter(a => a.cls === 'invertebrate' && a.chem && /^easy/.test(a.catch ?? '')).map(a => ({ name: a.name, kind: 'small creatures', chem: a.chem, habitats: a.habitats, now: g => animalNow(a, { doy: g.doy, meanC: g.meanC, weather: 'cloudy', wet: false }).here })),
  ];
  const grounds = MONTHS.map(day => groundAt(world, day));
  const rated = [];
  for (const s of sources) {
    const kcal = nutrients(s.chem, s.chem.gather).net, safe = harm(s.chem) < 0.12 && !(s.chem.compounds.parasites > 0.3);
    if (kcal <= 0) continue;
    let rate = 0; // kcal per hour, at full season, in the best ground for it near here
    for (const h of s.habitats) {
      const f = (share[h.micro] ?? 0) / n;
      if (!f) continue;
      const found = 1 - Math.exp(-(h.perInstance ?? h.pieces ?? 0) / 2); // the game's presence chance, at its usual abundance
      const walk = (CELL / Math.sqrt(f)) / 1000 / WALK_KMH; // patches of this ground lie about 1/√share cells apart
      rate = Math.max(rate, found * kcal / (walk + SURVEY + GATHER));
    }
    if (!rate) continue;
    const months = grounds.map(g => rate * clamp(s.now(g)));
    rated.push({ name: s.name, kind: s.kind, safe, kcal, months, perHour: mean(months) });
  }
  const best = list => list.sort((a, b) => b.perHour - a.perHour)[0] ?? null;
  const raw = best(rated.filter(r => r.safe)), any = best([...rated]);
  const pick = raw ?? any, seasonalOf = r => r && Math.max(...r.months) - Math.min(...r.months) > r.perHour;
  return {
    perHour: raw?.perHour ?? 0, source: raw, seasonal: seasonalOf(raw),
    cooked: any && any !== raw && any.perHour > 1.3 * (raw?.perHour ?? 0) ? { perHour: any.perHour, source: any, seasonal: seasonalOf(any) } : null,
    best: pick,
  };
}

// ------------------------------------------------------------ fire

// How damp wood left out gets, as the game has it (game.js ambient): the climate's usual, wetter in
// rain, snow and fog, drier on a clear afternoon. The fire estimate was fitted (against simulated play)
// at the climate's usual, so a month is that plus how much wetter or drier its weather runs than the
// year's: the year's average stays where the fit was made, and the months swing about it.
const WEATHER_DAMP = { rain: 0.15, storm: 0.25, fog: 0.12, snow: 0.08, blizzard: 0.12 };
export function estimateFireYear(world) {
  const base = clamp(0.05 + 0.07 * world.environment.water, 0.05, 0.35);
  const damp = MONTHS.map(day => {
    let sum = 0, n = 0;
    for (let k = -14; k <= 15; k++) for (const t of [1.5, 7.5, 13.5, 19.5]) {
      const w = skyAt(world, day + k, t);
      sum += WEATHER_DAMP[w.weather] ?? (w.weather === 'clear' && w.sunAlt > 20 ? -0.03 : 0); n++;
    }
    return sum / n;
  });
  const year = mean(damp), ambient = damp.map(d => clamp(base + d - year, 0.05, 0.45));
  const months = ambient.map(a => { const est = estimateFire(world, { ambient: a }); return est.blocked ? null : est.median; }); // null: not within the month
  const days = months.filter(d => d != null), best = Math.min(...days), any = days.length;
  return { median: any ? mean(days) : null, months, ambient, seasonal: any > 0 && (any < 12 || Math.max(...days) > 2 * best) };
}

// ------------------------------------------------------------ words

const minutesWords = h => (!Number.isFinite(h) ? 'none within 3 km' : h < 0.2 ? 'close by' : h < 0.75 ? `about ${Math.max(5, Math.round(h * 12) * 5)} min away` : h < 1.25 ? 'about an hour away' : `about ${Math.round(h * 2) / 2} h away`);
const kcalWords = k => `about ${k < 100 ? Math.max(10, Math.round(k / 10) * 10) : Math.round(k / 50) * 50} kcal an hour of foraging`;
const KIND = { fruit: 'fruit', nut: 'nuts', seed: 'seeds', grain: 'grain', pod: 'pods', storage: 'roots and tubers', root: 'roots', leaf: 'greens', stem: 'greens', flower: 'flowers', innerBark: 'inner bark', mushroom: 'mushrooms', lichen: 'lichen' };
export const daysWords = d => (d == null ? 'more than a month' : d <= 1 ? 'about a day' : `about ${Math.round(d)} days`);
const seasonalWord = x => (x ? ' (seasonal)' : '');

export function outlook(world, L, spawn, fireEst, seed) {
  const water = estimateWater(world, L, spawn), food = estimateFood(world, L, spawn), fire = estimateFireYear(world);
  const kindOf = r => KIND[r.kind] ?? r.kind;
  const foodText = food.source && food.perHour >= 10
    ? `food ${kcalWords(food.perHour)} (${kindOf(food.source)})${seasonalWord(food.seasonal)}${food.cooked ? `, more once cooked (${kindOf(food.cooked.source)})` : ''}`
    : food.cooked ? `food mostly needs cooking: ${kcalWords(food.cooked.perHour)} (${kindOf(food.cooked.source)})${seasonalWord(food.cooked.seasonal)}` : 'little food to be had';
  return {
    water, food, fire, fireNow: fireEst, seed,
    text: {
      water: `water ${minutesWords(water.hours)}${seasonalWord(water.seasonal)}`,
      food: foodText,
      fire: fireEst.blocked ? `fire looks out of reach (${fireEst.blocked})` : `fire in ${daysWords(fire.median)}${seasonalWord(fire.seasonal)}`,
    },
  };
}
