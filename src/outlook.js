// outlook.js — the start screen's survivability blurb: water in x hours, food in x hours, fire in x days.
//
// These are indicative, not rigorous. Each is a plausible outcome for a sensible beginner, from a cheap
// stand-in for play that reuses the game's own perception and walking models:
//   water  a handful of quick trial runs of the opening: scan; walk toward the loudest or nearest water
//          cue; failing that climb to the lookout and look; failing that strike out in a random direction.
//          Report the median.
//   food   a back-of-envelope: each attempt is a short walk, a survey and a gathering, at a site drawn from
//          the microhabitats around the spawn; it succeeds if a meal-sized food that is safe raw is there
//          and the beginner happens to try it rather than an unsafe one. Report the median wait.
//   fire   the closed-form fire estimate (craft.js `estimateFire`), median day.

import { makeRng } from './rng.js';
import { perceive, suspicionFrom, walk, isLookout } from './geo.js';
import { N, CELL } from './landscape.js';
import { nutrients, harm, expose, PREP } from './food.js';

const idx = (x, y) => y * N + x;
const WATER = ['falls', 'cascade', 'rapids', 'river', 'stream', 'brook', 'river trace', 'lake', 'waterfowl'];
const BUDGET = 12; // hours; past this the answer is just "a long time"

// Water within ~200 m is noticed on arrival (as in the game's `arrive`). Returns metres, or null.
function waterNear(L, p) {
  let best = null;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = p.x + dx, y = p.y + dy;
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const c = idx(x, y);
    if ((L.chan[c] || L.lake[c]) && (best === null || Math.hypot(dx, dy) < best)) best = Math.hypot(dx, dy);
  }
  return best === null ? null : best * CELL;
}

function waterTrial(L, spawn, rng) {
  let p = { x: spawn.x, y: spawn.y }, hours = 0, lookedOut = false;
  const reached = () => { const m = waterNear(L, p); return m === null ? null : hours + m / 3000; }; // last stretch at 3 km/h
  for (let leg = 0; leg < 8 && hours < BUDGET; leg++) {
    if (leg > 0) { const done = reached(); if (done !== null) return done; } // on waking, nothing is noticed for free
    const atLookout = isLookout(L, p.x, p.y);
    hours += 0.5; // scan, or look out from high ground
    const cues = perceive(L, p, { time: hours < 1.5 ? 'dawn' : 'day', lookout: atLookout, boost: atLookout ? 1 : 1.6 }).filter(c => WATER.includes(c.kind));
    let target = null, resense = null;
    if (cues.length) {
      const c = cues.reduce((a, b) => (b.strength > a.strength ? b : a));
      target = suspicionFrom(c, p, rng).est;
      let n = 0;
      resense = q => { if (++n % 6) return null; const k = perceive(L, q, {}).find(x => x.key === c.key); return k ? suspicionFrom(k, q, rng).est : null; };
    } else if (spawn.lookout && !lookedOut) { target = spawn.lookout; lookedOut = true; }
    else { // strike out in some direction, about 1.5 km
      const a = rng.uniform(0, 2 * Math.PI);
      target = { x: Math.max(0, Math.min(N - 1, Math.round(p.x + 20 * Math.sin(a)))), y: Math.max(0, Math.min(N - 1, Math.round(p.y - 20 * Math.cos(a)))) };
    }
    const trip = walk(L, p, target, { rng, maxHours: 3, resense, stopAtWater: true });
    hours += trip.hours;
    p = trip.end;
    if (trip.crossings.length) return hours;
  }
  return reached() ?? Infinity;
}

export function estimateWater(L, spawn, seed, trials = 9) {
  const rng = makeRng(`${seed}/outlook/water`);
  const t = Array.from({ length: trials }, () => waterTrial(L, spawn, rng)).sort((a, b) => a - b);
  return { hours: t[Math.floor(trials / 2)], trials: t };
}

const MEAL = 250; // kcal: worth calling food
const ATTEMPT = 1.75; // hours: short walk, survey, gather

export function estimateFood(world, L, spawn) {
  // what can be had with bare hands, and whether it is safe raw (no fire yet)
  // net energy of half an hour's gathering, eaten raw (no fire yet), from each food's make-up
  const raw = chem => ({ kcal: nutrients(chem, chem.gather).net, safe: harm(chem) < 0.12 && !(chem.compounds.parasites > 0.3) });
  const options = [
    ...world.plants.flatMap(p => p.parts.filter(x => x.food && x.chem && !/cutting edge|digging stick/.test(x.collect ?? '')).map(x => ({ ...raw(x.chem), habitats: p.habitats }))),
    ...world.animals.filter(a => a.cls === 'invertebrate' && a.chem && /^easy/.test(a.catch ?? '')).map(a => ({ ...raw(a.chem), habitats: a.habitats })),
  ].filter(o => o.kcal >= MEAL);
  // microhabitats within ~1.5 km of the spawn
  const share = {}; let n = 0;
  for (let dy = -19; dy <= 19; dy++) for (let dx = -19; dx <= 19; dx++) {
    const x = spawn.x + dx, y = spawn.y + dy;
    if (x < 0 || y < 0 || x >= N || y >= N || dx * dx + dy * dy > 361) continue;
    const m = L.micro[idx(x, y)] === 'lake' ? 'pond' : L.micro[idx(x, y)];
    share[m] = (share[m] ?? 0) + 1; n++;
  }
  let q = 0, cookedOnly = false;
  for (const [m, k] of Object.entries(share)) {
    let pNone = 1, safeW = 0, allW = 0;
    for (const o of options) {
      const h = o.habitats.find(z => z.micro === m); if (!h) continue;
      const occ = 1 - Math.exp(-(h.perInstance ?? h.pieces ?? 0) / 2); // as in the game's presence rule, at median abundance
      allW += occ; if (o.safe) { safeW += occ; pNone *= 1 - occ; } else cookedOnly = true;
    }
    if (allW) q += (k / n) * (1 - pNone) * (safeW / allW); // present, and the one tried is the safe one
  }
  if (q <= 0) return { hours: Infinity, cookedOnly };
  const attempts = Math.max(1, Math.ceil(Math.log(0.5) / Math.log(1 - Math.min(q, 0.999))));
  return { hours: attempts * ATTEMPT, q, cookedOnly };
}

export const hoursWords = h => (!Number.isFinite(h) || h > BUDGET * 2 ? 'more than a day'
  : h < 0.75 ? 'under an hour' : h < 1.5 ? 'about an hour' : h < 10 ? `about ${Math.round(h)} hours` : `about ${Math.round(h / 2) * 2} hours`);
export const daysWords = d => (d == null ? 'more than a month' : d <= 1 ? 'about a day' : `about ${Math.round(d)} days`);

export function outlook(world, L, spawn, fireEst, seed) {
  const water = estimateWater(L, spawn, seed);
  const food = estimateFood(world, L, spawn);
  return {
    water, food, fire: fireEst,
    text: {
      water: `water in ${water.hours > BUDGET ? 'more than half a day' : hoursWords(water.hours)}`,
      food: Number.isFinite(food.hours) ? `food in ${hoursWords(food.hours)}` : food.cookedOnly ? 'food only once you have fire' : 'little food to be had',
      fire: fireEst.blocked ? `fire looks out of reach (${fireEst.blocked})` : `fire in ${daysWords(fireEst.median)}`,
    },
  };
}
