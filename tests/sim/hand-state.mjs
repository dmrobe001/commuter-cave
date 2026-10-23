// hand-state.mjs — a small hand-made game state for running processes (acts.js) headless: a world,
// a body, a site in woodland, and the conditions here, each overridable. game(over) → { S, state(binding) }:
// S holds the state's own objects (to look at after a run); state(binding) is the act.js state over
// them, with the bound things. dice(i): this attempt's luck from stream i, the place's as the world has it.
import { generateWorld } from '../../src/generator.js';
import { makeRng } from '../../src/rng.js';
import { newCharacter } from '../../src/craft.js';
import { newMemory } from '../../src/notes.js';
import { siteFactors } from '../../src/variation.js';
import { skyAt } from '../../src/sky.js';
import { groundAt } from '../../src/ground.js';
import { SHELTERS } from '../../src/body.js';
import { stateOver } from '../../src/act.js';

export const world = generateWorld('acts', { preset: 'temperate-woodland' });
export function game(over = {}) {
  const sky = skyAt(world, 1, 10), g = groundAt(world, 1), micro = world.environment.microhabitats.find(m => m.id === 'woodland');
  const S = {
    body: { ...newCharacter(), germs: 0.3, hyd: 0.5, energy: 0.7, sick: 0, pendingSick: [], gut: 0, macro: { p: 0, f: 0, c: 0 }, chill: 0, limp: 0, wound: null, clothes: { clo: 1, wet: 0 } },
    site: { key: 's1', micro: 'woodland', known: new Set(), x: 10, y: 10 },
    mem: newMemory(), lore: {}, mind: { moonNoted: null }, milestones: {}, inv: [],
  };
  const here = {
    water: { name: 'stream water', pathogen: 0.25 }, fire: false, dark: false, shelter: SHELTERS.open, wind: { strength: 0.3, ms: 3 }, ambient: 0.15,
    waterTempC: { running: 10, still: 14 }, factors: siteFactors(world.seed, 's1', micro), marsh: false, seeing: null,
    cond: { doy: sky.doy, meanC: sky.meanC, weather: sky.weather, wet: sky.wet, light: 1, hearing: 1, g, snowCm: 0, litter: 0, freshSnow: false },
    ...over.here,
  };
  Object.assign(S, over.S ?? {});
  return { S, state: b => stateOver({ ...S, sky, ground: g, world, clock: { day: 1, t: 10, now: 10 }, ...b }, { here: Object.fromEntries(Object.entries(here).map(([k, x]) => [k, () => x])) }) };
}
export const dice = i => ({ act: makeRng(`acts/${i}`), place: key => makeRng(`${world.seed}/${key}`) });
