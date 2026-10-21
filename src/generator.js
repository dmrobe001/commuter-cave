// generator.js — entry point. Pure ES modules with no Node dependencies,
// so the same code runs in the browser game, headless in Node, and in tools.

import { makeRng } from './rng.js';
import { generateEnvironment, generateStones, generateClay, generateWater, PRESETS } from './environment.js';
import { generatePlants, generateAnimals, starterCheck } from './life.js';
import { siteFactors, sampleVarying, sig, FACTORS } from './variation.js';
import { makeNamer } from './names.js';

export const VERSION = '0.2.0';
export { PRESETS };

// opts: preset, meanTempC, precipMm, seasonality, bedrock, relief,
//       mcSamples (Monte Carlo samples per archetype for the summaries; default 1000)
export function generateWorld(seed = 'demo', opts = {}) {
  const options = { ...(opts.preset ? PRESETS[opts.preset] : {}), ...opts };
  const mc = options.mcSamples ?? 1000;
  const s = String(seed);
  const rng = makeRng(s);
  const namer = makeNamer(rng.fork('names'));
  const environment = generateEnvironment(rng.fork('env'), options);
  const stones = generateStones(rng.fork('stones'), environment, s, namer, mc);
  const clay = generateClay(rng.fork('clay'), environment);
  const water = generateWater(rng.fork('water'), environment);
  const plants = generatePlants(rng.fork('plants'), environment, s, namer, mc);
  const animals = generateAnimals(rng.fork('animals'), environment, s, namer, mc);
  const world = { seed: s, version: VERSION, options, environment, stones, clay, water, plants, animals };
  for (const e of [...world.stones, ...world.plants, ...world.animals]) { // the familiar part of each name, and whether it was made up
    const i = namer.info[e.name];
    e.nameBase ??= i?.base ?? e.name;
    e.coined ??= i?.coined ?? false;
  }
  world.starter = starterCheck(world);
  return world;
}

// Lazy patch lookup: the varying traits of one entity at one site (map node).
// Pure function of (seed, site, entity): call it whenever the player first notices
// something there, and you get the same answer every time, in any order.
export function samplePatch(world, entityId, siteKey, microId) {
  const e = [...world.stones, ...world.plants, ...world.animals].find(x => x.id === entityId);
  if (!e) throw new Error(`No entity ${entityId}`);
  const micro = world.environment.microhabitats.find(m => m.id === (microId ?? e.habitats[0]?.micro));
  const f = siteFactors(world.seed, siteKey, micro);
  const v = sampleVarying(world.seed, entityId, siteKey, e.varying, f);
  return {
    entity: entityId, name: e.name, site: siteKey, micro: micro?.id ?? null,
    factors: Object.fromEntries(FACTORS.map(k => [k, sig(f[k], 2)])),
    traits: Object.fromEntries(e.varying.map(t => [t.id, sig(v[t.id], 3)])),
  };
}
