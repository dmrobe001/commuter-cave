// phenology.js — when each part of each plant is there to be had: leaves, flowers, fruits, seeds.
//
// Every plant part already says when it's in season, in words ("growing season", "early growing
// season", "late growing season", "late growing season and the winter", "year-round", "after rain,
// mostly late in the growing season"). Those words are read against where the growing season stands
// (ground.js phase: 0 at its start, 1 at its end, −1 outside it), with a per-species shift (some berries
// ripen a few weeks before others) and a per-species length for fruiting. The result is how much of the
// part there is now, 0..1. A state read, not an event: foraging, noticing and anything later (animals
// following the fruit, say) read it.
import { makeRng, clamp } from './rng.js';

// a species' own timing: a shift of up to a tenth of the season either way, and how long its fruit lasts
export function plantClock(world, plant) {
  plant._clock ??= (() => { const r = makeRng(`${world.seed}/phenology/${plant.id}`); return { shift: r.uniform(-0.1, 0.1), fruit: r.uniform(0.2, 0.4) }; })();
  return plant._clock;
}
// a smooth window [a, b] on the season's phase, ramping over w at each end
const window = (x, a, b, w = 0.05) => clamp(Math.min((x - a + w) / w, (b + w - x) / w));

// How much of this part is there now (0..1). g: ground.js state for the day (phase, soak, growing).
export function partNow(world, plant, partName, g) {
  const part = plant.parts.find(p => p.part === partName);
  const words = part?.season ?? 'year-round';
  if (/^year-round|peels best/.test(words)) return 1;
  const { shift, fruit } = plantClock(world, plant), x = g.phase - shift, out = g.phase < 0;
  if (/after rain/.test(words)) { const wet = g.soak > (world.environment.precipMm / 365) * 4; return out ? 0.05 : (wet ? 1 : 0.15) * (0.5 + 0.5 * clamp(x / 0.6)); }
  if (/late growing season (and|through) the winter/.test(words)) return out ? 1 : window(x, 0.65, 1.2);
  if (/^early growing season/.test(words)) return out ? 0 : window(x, 0.03, 0.35);
  if (/^late growing season/.test(words)) return out ? 0 : window(x, 0.6, 0.6 + fruit);
  if (/^growing season/.test(words)) return out ? 0 : window(x, 0.04, 0.97);
  return 1;
}
// How a plant looks now: in leaf or bare (or died back, for herbs and grasses), flowering, fruiting.
// notice: how much easier or harder it is to spot than usual (flowers and fruit catch the eye; a
// died-back herb is hard to find).
export function plantNow(world, plant, g) {
  const has = re => plant.parts.filter(p => re.test(p.part)).reduce((m, p) => Math.max(m, partNow(world, plant, p.part, g)), 0);
  const woody = ['tree', 'shrub'].includes(plant.form);
  const leaf = woody ? (plant.traits.deciduous ? g.leaf : 1) : ['herb', 'grass'].includes(plant.form) ? Math.max(has(/^(leaves|blades)$/), 0.15) : 1;
  const flowering = has(/^flowers$/) > 0.5, fruiting = has(/^(fruits|berries|nuts|pods|seeds|seed heads|caps)$/) > 0.5;
  const notice = (['herb', 'grass'].includes(plant.form) ? 0.3 + 0.7 * leaf : 1) * (flowering ? 1.3 : 1) * (fruiting ? 1.15 : 1) * (plant.form === 'mushroom' ? has(/.*/) : 1);
  return { leaf, flowering, fruiting, notice };
}
