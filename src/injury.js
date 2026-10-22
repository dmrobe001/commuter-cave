// injury.js — the risk of getting hurt on the move.
//
// A hazard rate (injuries per hour of walking), the product of independent factors:
//   ground: steepness, and what's underfoot (scree, rock, wet clay, wading a stream bed, deadfall);
//   light: by day nothing extra; in deep twilight several times the risk; in a moonless night, ten;
//   weather: wet rock and mud, snow, fog;
//   body: tiredness, hunger, sickness, a limp already;
//   familiarity: ground I've walked before is half the risk (I know where the holes are).
// Calibration is judgement, aimed at: one minor injury in about 300 hours of walking easy, familiar
// ground by day, rested; about one in 40 on unfamiliar rough ground; one in an hour or two crossing
// scree at night with no moon. What happens depends on where (a twisted ankle on rock and slopes, a
// gash from a branch in thick woods, a slip into the water in a stream bed) and how badly (lognormal).
import { clamp } from './rng.js';
import { seeingNear } from './sky.js';

const BASE = 1 / 150; // per hour, easy unfamiliar ground by day, rested
const UNDERFOOT = { scree: 3, outcrop: 2, deadfall: 1.8, streambed: 1.8, claybank: 1.6, pond: 1.5, spring: 1.3, woodland: 1.2, edge: 1.1, streambank: 1.2, glade: 1, lake: 1 };
const WEATHER = { rain: 1.6, storm: 2, snow: 2, blizzard: 3, fog: 1.2 };

// injuries per hour on this cell. env: { lux, weather } (sky.js); body: { fatigue, energy, sick, limp };
// familiar: walked this cell before.
export function hazard(L, c, env, body, familiar) {
  const micro = L.micro[c];
  const ground = (1 + 12 * Math.max(0, L.slope[c] - 0.08)) * (UNDERFOOT[micro] ?? 1) * (L.chan[c] >= 3 ? 1.5 : 1);
  const light = 1 + 9 * Math.pow(1 - seeingNear(env.lux * (1 - 0.75 * L.veg[c])), 1.5);
  const weather = (WEATHER[env.weather] ?? 1) * (['rain', 'storm'].includes(env.weather) && ['scree', 'outcrop', 'claybank', 'streambed'].includes(micro) ? 1.4 : 1);
  const b = (1 + 1.5 * body.fatigue ** 2) * (1 + 2 * Math.max(0, 0.3 - body.energy) / 0.3) * (1 + 1.5 * body.sick) * (1 + (body.limp ?? 0));
  return BASE * ground * light * weather * b * (familiar ? 0.5 : 1);
}

// What kind of hurt, given where it happened (a cell) and a random stream.
export function injuryAt(L, c, rng) {
  const micro = L.micro[c], steep = L.slope[c] > 0.2 || ['scree', 'outcrop'].includes(micro);
  const sev = clamp(rng.logNormal(0.25, 0.6), 0.05, 0.9);
  let kind;
  if (L.chan[c] >= 2 || micro === 'streambed') kind = rng.chance(0.6) ? 'slip' : 'ankle';
  else if (steep) kind = rng.chance(0.6) ? 'ankle' : 'fall';
  else if (L.veg[c] > 0.55 || micro === 'deadfall') kind = rng.chance(0.5) ? 'cut' : 'ankle';
  else kind = rng.chance(0.7) ? 'ankle' : 'fall';
  return { kind, sev };
}
