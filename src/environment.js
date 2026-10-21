// environment.js — level 1 of the generative graph.
//
// A few latent drivers (climate, bedrock, relief) are sampled; everything else
// (water balance, fire, tree cover, microhabitats, stone, clay, water quality)
// is derived from them plus noise. Coherence comes from shared causes.

import { clamp, round } from './rng.js';
import { makeVarying, summarize } from './variation.js';

// Patch-varying stone traits. Fracture quality has no site prior: it is driven by the
// geological bed (the lineage factor), so whether colour tone predicts quality differs by world.
const STONE_VARYING = [
  { id: 'colorTone', label: 'colour tone (0 light, 1 dark)', kind: 'visible', scale: '01', sd: 0.8, median: () => 0.5, prior: {} },
  { id: 'rind', label: d => (d.hidden.type === 'flint' || d.hidden.type === 'chert' ? 'rind thickness' : 'weathered crust'), kind: 'visible', scale: 'log', unit: 'mm', sd: 0.4, median: () => 4, prior: { moisture: 1, exposure: 1 } },
  { id: 'fracture', label: 'fracture quality', kind: 'useful', scale: '01', sd: 0.5, median: d => d.hidden.fracture, prior: {} },
  { id: 'flawRate', label: 'flaw rate', kind: 'useful', scale: '01', sd: 0.5, median: d => d.hidden.flawRate, prior: { moisture: 1, exposure: 1 } },
  { id: 'pieceSize', label: 'typical piece size', kind: 'useful', scale: 'log', unit: 'cm', sd: 0.4, median: d => (d.habitats[0].micro === 'streambed' ? 8 : 20), prior: {} },
];

// Stone types. `fracture` ~ how cleanly and predictably it breaks (knappability).
export const STONES = {
  flint:         { fracture: 0.9,  hardness: 7,   luster: 'waxy',    colors: ['grey', 'black', 'honey-brown'], translucent: true,  form: 'knobbly nodules with a chalky white rind', heatTreatable: true,  porosity: 0.05 },
  chert:         { fracture: 0.8,  hardness: 7,   luster: 'waxy',    colors: ['grey', 'tan', 'reddish'],       translucent: true,  form: 'lumps and bands within the bedrock',      heatTreatable: true,  porosity: 0.08 },
  obsidian:      { fracture: 0.97, hardness: 5.5, luster: 'glassy',  colors: ['black', 'smoky brown'],         translucent: true,  form: 'glassy lumps and broken flow fragments',  heatTreatable: false, porosity: 0.01 },
  basalt:        { fracture: 0.4,  hardness: 6,   luster: 'dull',    colors: ['dark grey', 'black'],           translucent: false, form: 'dense, dark blocks',                      heatTreatable: false, porosity: 0.12 },
  pumice:        { fracture: 0.03, hardness: 6,   luster: 'frothy',  colors: ['pale grey'],                    translucent: false, form: 'light, bubbly lumps',                     heatTreatable: false, porosity: 0.9 },
  granite:       { fracture: 0.1,  hardness: 6,   luster: 'sparkly', colors: ['pink-speckled', 'grey-speckled'], translucent: false, form: 'rounded blocks of coarse crystals',     heatTreatable: false, porosity: 0.05 },
  'vein quartz': { fracture: 0.5,  hardness: 7,   luster: 'glassy',  colors: ['milky white'],                  translucent: true,  form: 'white veins and chunks',                  heatTreatable: false, porosity: 0.02 },
  quartzite:     { fracture: 0.6,  hardness: 7,   luster: 'sugary',  colors: ['white', 'pinkish', 'grey'],     translucent: false, form: 'tough, fine-grained blocks',              heatTreatable: false, porosity: 0.03 },
  sandstone:     { fracture: 0.1,  hardness: 5,   luster: 'gritty',  colors: ['buff', 'reddish'],              translucent: false, form: 'gritty, layered blocks',                  heatTreatable: false, porosity: 0.3 },
  limestone:     { fracture: 0.15, hardness: 3,   luster: 'dull',    colors: ['pale grey', 'cream'],           translucent: false, form: 'pale blocks, some with shell fossils',    heatTreatable: false, porosity: 0.25 },
  shale:         { fracture: 0.05, hardness: 3,   luster: 'dull',    colors: ['dark grey'],                    translucent: false, form: 'thin, crumbly layers',                    heatTreatable: false, porosity: 0.3 },
  ironstone:     { fracture: 0.2,  hardness: 5,   luster: 'earthy',  colors: ['rust-red', 'ochre-yellow'],     translucent: false, form: 'heavy, rusty nodules',                    heatTreatable: false, porosity: 0.2, pigment: true },
  slate:         { fracture: 0.1,  hardness: 4,   luster: 'satiny',  colors: ['blue-grey'],                    translucent: false, form: 'flat slabs that split cleanly',           heatTreatable: false, porosity: 0.05 },
};

// Bedrock decides which stones exist locally and what soil forms.
export const BEDROCKS = {
  chalk:       { label: 'chalk',              soil: 'thin, pale, alkaline soil', stones: ['flint', 'limestone'],                clay: 0.4 },
  limestone:   { label: 'limestone',          soil: 'alkaline loam',             stones: ['limestone', 'chert'],                clay: 0.5 },
  volcanic:    { label: 'volcanic rock',      soil: 'dark, fertile loam',        stones: ['basalt', 'obsidian', 'pumice'],      clay: 0.5 },
  granite:     { label: 'granite',            soil: 'acidic, sandy soil',        stones: ['granite', 'vein quartz'],            clay: 0.3 },
  sandstone:   { label: 'sandstone',          soil: 'sandy, free-draining soil', stones: ['sandstone', 'quartzite'],            clay: 0.3 },
  shale:       { label: 'shale and mudstone', soil: 'heavy clay soil',           stones: ['shale', 'ironstone'],                clay: 0.9 },
  metamorphic: { label: 'metamorphic rock',   soil: 'stony loam',                stones: ['slate', 'quartzite', 'vein quartz'], clay: 0.4 },
};

export const PRESETS = {
  'temperate-woodland': { meanTempC: 12, precipMm: 850, seasonality: 0.55, relief: 0.45 },
  'warm-savanna':       { meanTempC: 22, precipMm: 750, seasonality: 0.8,  relief: 0.3 },
  'cool-forest':        { meanTempC: 5,  precipMm: 1100, seasonality: 0.7, relief: 0.6 },
  'dry-scrub':          { meanTempC: 18, precipMm: 380, seasonality: 0.6,  relief: 0.5 },
};

// Microhabitats: each has an environmental vector (moisture, light, rockiness)
// used to match organisms, and a frequency derived from the environment.
const MICROHABITATS = [
  { id: 'woodland',   name: 'woodland interior',         unit: 'hectare patch',   vector: { moisture: 0.55, light: 0.25, rock: 0.1 },  freq: e => 8 * e.treeCover },
  { id: 'edge',       name: 'woodland edge and thicket', unit: 'stretch of edge', vector: { moisture: 0.5,  light: 0.6,  rock: 0.15 }, freq: e => 24 * e.treeCover * (1 - e.treeCover) },
  { id: 'glade',      name: 'open grassy ground',        unit: 'clearing',        vector: { moisture: 0.4,  light: 0.95, rock: 0.1 },  freq: e => 8 * (1 - e.treeCover) + 1 },
  { id: 'deadfall',   name: 'fallen tree',               unit: 'fallen trunk',    vector: { moisture: 0.6,  light: 0.4,  rock: 0 },    freq: e => 40 * e.treeCover, landmark: true },
  { id: 'streambank', name: 'stream bank',               unit: '100 m stretch',   vector: { moisture: 0.9,  light: 0.6,  rock: 0.2 },  freq: e => 4 * clamp(e.water / 1.2) * (0.5 + e.relief) },
  { id: 'streambed',  name: 'stream bed and gravel bar', unit: '100 m stretch',   vector: { moisture: 1,    light: 0.8,  rock: 0.85 }, freq: e => 3 * clamp(e.water / 1.2) * (0.5 + e.relief) },
  { id: 'pond',       name: 'pond or marsh margin',      unit: 'pond',            vector: { moisture: 1,    light: 0.85, rock: 0.05 }, freq: e => 2 * clamp(e.water) * (1.2 - e.relief) },
  { id: 'spring',     name: 'spring',                    unit: 'spring',          vector: { moisture: 0.95, light: 0.5,  rock: 0.5 },  freq: e => 0.8 * e.relief * clamp(e.water), landmark: true },
  { id: 'outcrop',    name: 'rocky outcrop',             unit: 'outcrop',         vector: { moisture: 0.25, light: 0.8,  rock: 1 },    freq: e => 0.5 + 3 * e.relief },
  { id: 'scree',      name: 'scree slope',               unit: 'slope',           vector: { moisture: 0.2,  light: 0.85, rock: 1 },    freq: e => Math.max(0, 3 * (e.relief - 0.45)) },
  { id: 'claybank',   name: 'eroded clay bank',          unit: 'bank',            vector: { moisture: 0.6,  light: 0.6,  rock: 0.1 },  freq: e => (e.clayPresent ? 0.8 * (0.4 + e.relief) : 0) },
];

function biomeName(T, treeCover, water) {
  const temp = T < 7 ? 'cool' : T < 17 ? 'temperate' : 'warm';
  let veg;
  if (treeCover < 0.12) veg = water < 0.6 ? 'semi-desert scrub' : 'open grassland';
  else if (treeCover < 0.35) veg = 'grassland with scattered trees';
  else if (treeCover < 0.6) veg = 'open woodland';
  else veg = 'closed forest';
  return `${temp} ${veg}`;
}

export function generateEnvironment(rng, opts = {}) {
  const c = rng.fork('climate');
  const meanTempC = round(opts.meanTempC ?? c.uniform(4, 24), 1);
  const precipMm = Math.round(opts.precipMm ?? c.uniform(350, 1800));
  const seasonality = round(opts.seasonality ?? c.uniform(0.2, 0.9));

  const g = rng.fork('geology');
  const bedrock = opts.bedrock ?? g.pick(Object.keys(BEDROCKS));
  const relief = round(opts.relief ?? g.uniform(0.1, 0.9));

  // Crude water balance: rainfall relative to a temperature-driven evaporation demand.
  const water = round(precipMm / (400 + 50 * meanTempC));
  const fire = round(clamp(seasonality * (1.4 - water)));
  const treeCover = round(clamp((water - 0.45) / 1.1 - 0.35 * fire + 0.1));
  const clayPresent = g.chance(BEDROCKS[bedrock].clay * (0.6 + 0.4 * clamp(water)));

  const env = {
    meanTempC, precipMm, seasonality, bedrock, relief, water, fire, treeCover, clayPresent,
    bedrockLabel: BEDROCKS[bedrock].label,
    soil: BEDROCKS[bedrock].soil,
    biome: biomeName(meanTempC, treeCover, water),
    leanSeason: meanTempC < 15 ? 'winter' : 'dry season',
    fireLabel: fire < 0.2 ? 'rare' : fire < 0.5 ? 'occasional' : 'frequent',
  };

  env.microhabitats = MICROHABITATS
    .map(m => ({ ...m, perKm2: round(m.freq(env), 1) }))
    .filter(m => m.perKm2 >= 0.1)
    .map(({ freq, ...m }) => m);
  return env;
}

const SIZE_MIX = {
  outcrop: 'mostly blocks and boulders; cobbles where pieces weather off',
  scree: 'cobbles to small boulders',
  streambed: 'gravel and rounded cobbles',
  glade: 'scattered cobbles',
};

function makeDeposit(r, type, where, origin, rarity) {
  const S = STONES[type];
  const fracture = round(clamp(S.fracture + r.normal(0, 0.05)));
  const streamOnly = where.length === 1 && where[0] === 'streambed';
  const flawRate = round(clamp(r.uniform(0.05, 0.35) + (streamOnly ? 0.1 : 0)));
  const color = r.pick(S.colors);
  const hidden = {
    type, fracture, flawRate, hardness: S.hardness, heatTreatable: S.heatTreatable,
    spallRisk: round(clamp(S.porosity * 1.5 + (where.includes('streambed') ? 0.15 : 0))),
  };
  const habitats = where.map(id => ({
    micro: id,
    pieces: Math.max(1, Math.round(r.logNormal(rarity === 'rare' ? 3 : id === 'streambed' ? 40 : 25, 0.5))),
    sizes: SIZE_MIX[id],
  }));

  const uses = [];
  if (fracture >= 0.75) uses.push('excellent knapping stone');
  else if (fracture >= 0.5) uses.push('workable knapping stone');
  if (S.hardness >= 5.5 && !['pumice', 'obsidian'].includes(type)) uses.push('hammerstone');
  if (['sandstone', 'pumice', 'granite'].includes(type)) uses.push('abrasive or grinding stone');
  if (['slate', 'sandstone', 'shale'].includes(type)) uses.push('flat slabs');
  if (S.pigment) uses.push('ochre pigment');
  if (type === 'limestone') uses.push('lime when burned (later)');
  if (hidden.spallRisk < 0.2 && fracture < 0.7) uses.push('cooking stones (heat, then drop into water)');

  const cues = [S.form, `${color}, ${S.luster} surface`];
  if (S.translucent && fracture > 0.6) cues.push('thin edges glow when held up to the light');

  const fieldTests = [
    ['Ring test (strike two pieces together)', flawRate < 0.18 ? 'most pieces ring clearly' : flawRate < 0.32 ? 'some ring clearly, some thud (hidden cracks)' : 'many pieces thud dully; hidden cracks are common'],
    ['Test break with a hammerstone', fracture >= 0.75 ? 'smooth, shell-like curved surfaces with very sharp edges' : fracture >= 0.5 ? 'rough curved surfaces; edges usable but uneven' : fracture >= 0.25 ? 'breaks at irregular angles; edges dull' : 'crumbles or splits in layers'],
    ['Scratch test', S.hardness >= 7 ? 'scratches most other stones' : S.hardness >= 5.5 ? 'scratches softer stones; scratched by the hardest' : 'easily scratched'],
  ];
  if (S.pigment) fieldTests.push(['Streak (rub on a pale stone)', `leaves a ${color.includes('yellow') ? 'yellow' : 'red'} ochre streak`]);
  fieldTests.push(['Heft', type === 'pumice' ? 'astonishingly light; floats' : S.porosity > 0.2 ? 'light for its size' : 'dense, heavy for its size']);

  const novice = Math.round(60 * fracture * (1 - flawRate));
  const deliberate = [
    ['Knap a session of flakes (novice)', fracture >= 0.5 ? `roughly ${novice}% of strikes give a usable flake` : 'rarely produces a usable flake; better as a hammer or grinder'],
  ];
  if (S.heatTreatable) deliberate.push(['Heat-treat (bury in sand under a fire, cool slowly)', 'noticeably easier to knap afterward; glossier break surfaces']);
  deliberate.push(['Heat in a fire', hidden.spallRisk >= 0.3 ? 'may crack or burst violently: dangerous as a cooking stone' : 'tolerates heating well']);

  return { color, origin, rarity, hidden, habitats, cues, fieldTests, deliberate, uses };
}

export function generateStones(rng, env, seed, namer, mc) {
  const has = id => env.microhabitats.some(m => m.id === id);
  const local = BEDROCKS[env.bedrock].stones.filter(s => s !== 'obsidian' || rng.chance(0.55));
  const deposits = [];
  for (const type of local) {
    const where = ['outcrop', 'scree', 'streambed'].filter(has);
    if (!where.length) where.push('glade');
    deposits.push(makeDeposit(rng.fork(`local/${type}`), type, where, 'local bedrock', 'common'));
  }
  // River gravels carry stones from upstream geology, so exotic stone can appear.
  if (has('streambed') && rng.chance(0.6)) {
    const exotic = Object.keys(STONES).filter(s => !local.includes(s) && s !== 'pumice');
    const n = rng.int(1, 2);
    for (let i = 0; i < n && exotic.length; i++) {
      const type = exotic.splice(Math.floor(rng.next() * exotic.length), 1)[0];
      deposits.push(makeDeposit(rng.fork(`exotic/${type}`), type, ['streambed'], 'carried in by the stream from elsewhere', 'rare'));
    }
  }
  return deposits.map((d, i) => {
    const id = `S${i + 1}`;
    const r = rng.fork(`vary/${id}`);
    const knappable = d.hidden.fracture >= 0.45;
    const pick = ids => STONE_VARYING.filter(v => ids.includes(v.id));
    const specs = [...pick(['colorTone', 'rind']), ...pick(knappable ? ['fracture', 'flawRate'] : ['pieceSize', 'flawRate'])];
    const integration = r.weighted([[0.25, 1], [0.55, 1], [0.85, 1]]);
    const lineageShare = r.uniform(0.3, 0.8);
    const varying = specs.map(spec => makeVarying(r.fork(spec.id), spec, d, integration, lineageShare));
    const variation = summarize(seed, id, varying, d.habitats.map(h => ({ micro: h.micro, weight: h.pieces })), env, mc);
    const { color, ...rest } = d;
    return { id, kind: 'stone', name: namer.stone(d.hidden.type, color), ...rest, varying, variation };
  });
}

export function generateClay(r, env) {
  if (!env.clayPresent) return [];
  const plasticity = round(clamp(r.normal(0.6, 0.2)));
  const sand = round(clamp(r.normal(0.3, 0.15)));
  const shrinkage = round(clamp(0.8 * plasticity - 0.5 * sand + 0.2));
  const color = r.pick(['grey', 'blue-grey', 'red-brown', 'yellow-buff']);
  const where = env.microhabitats.filter(m => ['claybank', 'streambank', 'pond'].includes(m.id)).map(m => m.id);
  const firing = plasticity < 0.35
    ? 'crumbles; not plastic enough to hold a shape'
    : shrinkage > 0.55 && sand < 0.25
      ? 'cracks as it dries and fires unless mixed with sand or crushed shell (temper)'
      : 'fires into a hard piece that rings when tapped';
  return [{
    id: 'C1', name: `${color} clay`, where,
    hidden: { plasticity, sand, shrinkage },
    cues: [`${color} sticky soil exposed where banks erode`, 'cracks into plates as it dries in the sun'],
    fieldTests: [
      ['Coil test (roll a snake, bend it around a finger)', plasticity > 0.55 ? 'bends smoothly without cracking' : plasticity > 0.35 ? 'bends with fine cracks' : 'breaks apart'],
      ['Rub wet between fingers', sand > 0.4 ? 'gritty' : 'smooth and slick'],
      ['Touch dry clay to the tongue', 'sticks to the tongue'],
    ],
    deliberate: [['Dry and fire a small test piece', firing]],
  }];
}

export function generateWater(r, env) {
  const has = id => env.microhabitats.some(m => m.id === id);
  const out = [];
  const illness = p => p < 0.15 ? 'rarely causes illness' : p < 0.35 ? 'occasional gut illness' : 'frequent gut illness; boil once you have fire and a container';
  const add = (name, micro, pathogen, seasonal, cues, taste) => out.push({
    id: `W${out.length + 1}`, name, micro, seasonal,
    hidden: { pathogen: round(pathogen) },
    cues,
    fieldTests: [['Smell and taste', taste]],
    deliberate: [['Drink untreated for several days', illness(pathogen)]],
  });
  if (has('spring')) add('spring water', 'spring', r.uniform(0.02, 0.12), 'year-round', ['clear water welling from the ground', 'cold to the touch'], 'clean, cold, faintly mineral');
  if (has('streambank')) add('stream water', 'streambank', r.uniform(0.15, 0.35), env.water < 0.7 ? `shrinks to pools in the ${env.leanSeason}` : 'year-round', ['moving water', env.water < 0.7 ? 'flow is weak; pools between riffles' : 'steady flow over stones'], 'clean, slightly earthy');
  if (has('pond')) {
    const brackish = env.water < 0.6 && r.chance(0.5);
    add('pond water', 'pond', r.uniform(0.35, 0.7), env.water < 0.8 ? `may dry up in the ${env.leanSeason}` : 'year-round', ['still water', 'green edges, insects on the surface'], brackish ? 'distinctly salty' : 'flat, a little swampy');
  }
  add('rain puddles and tree hollows', 'anywhere', 0.3, 'only after rain', ['small pools after rain'], 'flat; sometimes leafy');
  return out;
}
