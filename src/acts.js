// acts.js — the game's processes, each in the common shape (act.js): the state it reads, the state it
// may change, and a run on a copy of that state. Nothing here touches the game directly; game.js binds
// the state and things chosen for the job, runs a process, and puts its outcome back.
//
// Namespaces the game supplies (see stateFor in game.js):
//   body   my body: water (hyd), reserves (energy), gut, diet (macro), sickness and what's brewing
//          (sick, pendingSick), warmth (chill), clothes, hurts (limp, wound), germs on my hands, and
//          crafting skill and wear (skills, fatigue, hands, callus, focus)
//   site   the place as I've made it: bed, hut, fire (fireUntil), basin, bones found, things known here
//   here   worked out from the place, sky and ground: water (name, pathogen), fire, dark, shelter, wind,
//          ambient dampness, conditions for seeing (cond), site factors, the limits on seeing
//   sky, ground, clock (day, t, now), mem (field-note memory), lore (what eating things did to me),
//   mind (what I've already remarked on), milestones, inv (all I carry), world (constant)
//   and slots: the things bound to this job (core, hammer, food, edge, stones, ...), and mode.
import { clamp } from './rng.js';
import { knapFlakes } from './craft.js';
import { hazard as harmBand, animalNow } from './life.js';
import { expose, nutrients, harm, textureWords, COMPOUNDS, PREP } from './food.js';
import { plantNow } from './phenology.js';
import { namingSentences, noteTrail } from './notes.js';
import { moonWords } from './sky.js';
import { sleepHour } from './body.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const r3 = x => Math.round(x * 1000) / 1000;
const entityIn = world => id => [...world.stones, ...world.plants, ...world.animals].find(e => e.id === id);

// ------------------------------------------------------------ words for counts of things

export const pluralize = n => (/fungus$/.test(n) ? n.replace(/fungus$/, 'fungi') : /louse$/.test(n) ? n.replace(/louse$/, 'lice') : /(s|sh|ch|x)$/.test(n) ? `${n}es` : /[^aeiou]y$/.test(n) ? `${n.slice(0, -1)}ies` : /(deer|fish|trout|elk|grouse|quail|boar)$/.test(n) ? n : `${n}s`);
export function countWord(n) { return n < 10 ? String(Math.max(1, Math.round(n))) : `~${n < 30 ? Math.round(n / 5) * 5 : Math.round(n / 10) * 10}`; }
export function lineFor(e, n) {
  const nm = e.name, c = countWord(n);
  if (e.kind === 'stone') return `${c} heftable ${nm} cobbles`;
  const colony = { ant: 'nest', termite: 'mound', wasp: 'nest' }[e.traits?.key];
  if (colony) return `${c} ${nm} ${colony}${n > 1.5 ? 's' : ''}`;
  if (e.kind === 'animal') return `${c} ${pluralize(nm)}`;
  if (e.form === 'tree') return `${c} ${/tree$/.test(nm) ? pluralize(nm) : `${nm} trees`}`;
  if (e.form === 'shrub') return `${c} ${/bush$/.test(nm) ? `${nm}es` : `${nm} bushes`}`;
  if (e.form === 'grass') return `${c} tufts of ${nm}`;
  if (e.form === 'mushroom') return `${c} ${pluralize(nm)}`;
  if (e.form === 'moss' || e.form === 'lichen') return `${c} patches of ${nm}`;
  return `${c} clumps of ${nm}`;
}

// ------------------------------------------------------------ germs on things handled together

// Everything handled together mixes toward a common germ load: the things, and my hands if they're in it.
export function mix(items, body, k = 0.4, hands = true) {
  const xs = items.filter(Boolean);
  const all = [...xs.map(i => i.props.germs ?? 0), ...(hands ? [body.germs] : [])];
  if (!all.length) return;
  const m = all.reduce((a, b) => a + b, 0) / all.length;
  for (const i of xs) i.props.germs = r3((i.props.germs ?? 0) + k * (m - (i.props.germs ?? 0)));
  if (hands) body.germs += k * (m - body.germs);
}

// ------------------------------------------------------------ what lives in a place

// How many of each thing live at a site: for each stone, plant and invertebrate whose habitat includes
// this microhabitat, a count from its usual abundance there, the site's fertility, and the place's own
// luck (dice.place, keyed by thing and site: the same site always holds the same). Present when that
// count clears a chance; as { e, n }.
export function populationAt(world, micro, siteKey, factors, place) {
  const out = [];
  for (const e of [...world.stones, ...world.plants, ...world.animals]) {
    const h = e.habitats.find(x => x.micro === micro);
    if (!h || (e.kind === 'animal' && e.cls !== 'invertebrate')) continue;
    const ar = place(`abund/${e.id}/${siteKey}`);
    const count = (h.perInstance ?? h.pieces) * Math.exp((e.kind === 'stone' ? 0 : 0.35 * factors.fertility) + 0.5 * ar.normal());
    if (!ar.chance(1 - Math.exp(-count / 2))) continue;
    out.push({ e, n: count });
  }
  return out;
}
export const POPULATION = {
  id: 'population', name: 'What lives here',
  reads: ['site.key', 'site.micro', 'here.factors', 'world'], writes: [],
  run: (v, d) => ({ report: { present: Object.fromEntries(populationAt(v.world, v.site.micro, v.site.key, v.here.factors, d.place).map(({ e, n }) => [e.name, n])) } }),
};

// ------------------------------------------------------------ bones
//
// How many bones lie about, and of what size. For each vertebrate living in this microhabitat:
//   finds  ∝  density × (1 / lifespan) × persistence × visibility
// with lifespan ~ mass^0.25 (allometry), visibility ~ bone length ~ mass^(1/3), and persistence rising
// steeply with size: a songbird carcass is usually gone to scavengers within days, while a large
// mammal's long bones weather on the surface for years. Taking persistence ~ mass^1 (a judgment that
// spans days at tens of grams to years at tens of kilograms), the exponents sum to about one, so
// bone supply tracks standing biomass: density × mass. Bones show on open ground and hide in leaf litter.
// Fine bones (birds' hollow bones, anything under 3 kg) suit needles and awls; big long bones suit
// handles and, smashed, give sharp splinters.
const BONE_VIS = { glade: 1.3, outcrop: 1.3, scree: 1.3, streambed: 1.2, edge: 1, claybank: 1, streambank: 0.8, pond: 0.8, spring: 0.8, woodland: 0.6, deadfall: 0.6 };
const isFineBoned = a => /bird|soarer|fish|frog|lizard/.test(a.traits.key ?? '') || (a.traits.mass ?? 0) < 3;
// effort: 1 = half an hour looking for nothing else. Adds what's found to the site's bones (at most 4 fine, 3 big).
export function findBones(world, site, effort, rng) {
  const vis = BONE_VIS[site.micro] ?? 1;
  const found = { fine: 0, big: 0 };
  for (const a of world.animals) {
    if (a.cls === 'invertebrate' || !a.habitats.some(h => h.micro === site.micro)) continue;
    const mu = effort * vis * (a.perKm2 ?? 0) * (a.traits.mass ?? 0) / 600; // expected finds; 600 kg/km² per find is tuning
    let n = 0, L = Math.exp(-mu), p = 1; // Poisson draw
    do { n++; p *= rng.next(); } while (p > L && n < 20);
    found[isFineBoned(a) ? 'fine' : 'big'] += n - 1;
  }
  site.bones ??= { fine: 0, big: 0 };
  site.bones.fine = Math.min(4, site.bones.fine + found.fine);
  site.bones.big = Math.min(3, site.bones.big + found.big);
  return found;
}
export const boneLines = f => [
  ...(f.big ? [`${f.big > 1 ? `${f.big} long bones` : 'a long bone'}, weathered pale, from something big`] : []),
  ...(f.fine ? [`${f.fine > 1 ? 'a scatter of' : 'a few'} fine, light bones from something small`] : []),
];

// ------------------------------------------------------------ survey: a formal count of what's in eyeshot

const memKeyE = e => e.lookalike?.mimics ?? e.id;
export function noteKnown(site, mem, e) { site.known.add(e.id); (mem.entities[memKeyE(e)] ??= { seen: 0, traits: {} }).seen++; }

// What the nose picks up close by.
function smellsHere(v, here, rng) {
  const out = [], mem = v.mem;
  const nm = e => (mem.entities[memKeyE(e)] ? ` (${e.name})` : '');
  const find = f => here.find(e => e.kind === 'plant' && f(e.traits ?? {}));
  const resin = find(t => t.resin > 0.5); if (resin) out.push(`resin${nm(resin)}`);
  const onion = find(t => t.defense === 'sulfur'); if (onion) out.push(`onion, underfoot${nm(onion)}`);
  const mint = find(t => t.defense === 'aromatic'); if (mint) out.push(`something sharp and minty${nm(mint)}`);
  const fruit = find(t => ['berry', 'drupe'].includes(t.fruit)); if (fruit) out.push(`ripe fruit${nm(fruit)}`);
  if (here.some(e => e.form === 'mushroom')) out.push('damp, mushroomy earth');
  if (here.some(e => e.traits?.key === 'bee')) out.push('a waxy sweetness where bees are working');
  if (here.some(e => e.traits?.key === 'fly') && rng.chance(0.4)) out.push('droppings somewhere close, by the flies');
  if (v.world.animals.some(a => a.traits.key === 'predator' && a.habitats.some(h => h.micro === v.site.micro)) && rng.chance(0.3)) out.push('a musky reek where something has marked its ground');
  if (v.site.micro === 'pond' && v.here.marsh) out.push('stagnant water and rotting reeds');
  return out;
}

// Each thing living here is seen with a chance set by how visible it is (low plants less, animals
// less), the light, snow and leaf litter over the low ones, and how much it shows now (in flower or
// fruit, died back); animals only if they're about this season. Animal sign, bones, the water and
// smells too. What's seen goes into what I know of this place and my field notes.
export const SURVEY = {
  id: 'survey', name: 'Survey',
  reads: ['site.key', 'site.micro', 'here.factors', 'here.cond', 'here.water', 'here.marsh', 'here.seeing', 'world'],
  writes: ['site.known', 'site.bones', 'mem'],
  hours: 0.75, kcal: 160,
  run(v, d) {
    const rows = [], fresh = [], seen = {}, cond = v.here.cond, rng = d.act;
    noteTrail(v.mem, v.site.key);
    const cover = (1 - Math.min(1, cond.snowCm / 20)) * (1 - 0.5 * cond.litter); // snow and leaves hide what's low down
    const present = populationAt(v.world, v.site.micro, v.site.key, v.here.factors, d.place);
    for (const { e, n } of present) {
      if (e.cryptic) continue; // under stones, logs and bark: only poking around finds these
      const low = ['herb', 'grass', 'moss', 'lichen', 'mushroom'].includes(e.form) || e.kind !== 'plant';
      const now = e.kind === 'animal' ? animalNow(e, cond) : null;
      if (now && !now.here) continue; // away or asleep for the season
      const visible = (e.kind === 'animal' ? 0.6 * now.seen : { herb: 0.85, grass: 0.9, mushroom: 0.6, moss: 0.9, lichen: 0.8 }[e.form] ?? 0.97) * cond.light * (low ? cover : 1) * (e.kind === 'plant' ? Math.min(1.2, plantNow(v.world, e, cond.g).notice) : 1);
      if (!rng.chance(visible)) continue;
      if (!v.mem.entities[memKeyE(e)] && !fresh.includes(e)) fresh.push(e);
      rows.push({ n, text: lineFor(e, n) });
      seen[e.name] = n;
      noteKnown(v.site, v.mem, e);
    }
    // animal sign: what's been left behind, not the animals themselves
    for (const a of v.world.animals.filter(a => a.cls !== 'invertebrate' && a.signs && a.habitats.some(h => h.micro === v.site.micro))) {
      if (!animalNow(a, cond).here || !rng.chance((1 - Math.exp(-a.perKm2 * 0.3)) * cond.light * (cond.snowCm > 2 ? 1.5 : 1 - 0.6 * cond.litter))) continue; // fresh sign shows in snow, hides under leaves
      const known = v.mem.entities[memKeyE(a)];
      const sign = a.signs.damage ?? (a.signs.track ? `sets of ${a.signs.track.type}` : a.signs.den);
      if (!sign) continue;
      rows.push({ n: 0.5, text: `${/^sets/.test(sign) ? 'a few' : '1'} ${sign.replace(/^(the|a) /, '')}${known ? ` (${a.name})` : ', left by some animal'}` });
      seen[`sign of ${a.name}`] = 1;
    }
    const bones = findBones(v.world, v.site, 0.35, rng);
    for (const t of boneLines(bones)) rows.push({ n: 0.4, text: t });
    rows.sort((a, b) => b.n - a.n);
    const water = v.world.water.find(w => w.micro === (v.site.micro === 'streambed' ? 'streambank' : v.site.micro));
    const sm = smellsHere(v, present.map(r => r.e), rng);
    const lines = [...(water ? [v.here.water ? `water: ${water.name}` : 'water: none now; the bed is dry'] : []), ...rows.map(r => r.text), ...(sm.length ? [`smells: ${sm.join('; ')}`] : []), ...namingSentences(fresh, v.mem, v.site.key, entityIn(v.world), rng)];
    return {
      say: [...(v.here.seeing ? [[v.here.seeing, 'thought']] : []), [`Surveying what I can see from here:\n${lines.join('\n')}`, 'survey']],
      report: { seen, bones, smells: sm },
    };
  },
};

// ------------------------------------------------------------ water

const POOR_WATER = 0.6; // of a source's pathogen score, the chance a drink makes me ill
export const DRINK = {
  id: 'drink', name: 'Drink',
  reads: ['here.water', 'clock.now'], writes: ['body.hyd', 'body.pendingSick'],
  hours: 0.25, kcal: 120,
  ready: v => (v.here.water ? true : 'There’s no water here.'),
  run(v, d) {
    const w = v.here.water;
    v.body.hyd = 1;
    if (d.act.chance(w.pathogen * POOR_WATER)) v.body.pendingSick.push({ at: v.clock.now + 24 + d.act.uniform(0, 18), severity: 0.25 + w.pathogen * 0.5, text: 'Cramps and a loose gut. Something in the water, maybe.' });
    return { say: [`Drank my fill of ${w.name}.`] };
  },
};
// Washing leaves my hands no cleaner than the water; a cut washed within a few hours seldom goes bad.
export const WASH_HANDS = {
  id: 'washhands', name: 'Wash my hands',
  reads: ['here.water', 'clock.now'], writes: ['body.germs', 'body.wound', 'body.pendingSick'],
  hours: 0.1, kcal: 110,
  ready: v => (v.here.water ? true : 'There’s no water here.'),
  run(v, d) {
    const b = v.body;
    b.germs = b.germs * 0.3 + 0.3 * v.here.water.pathogen;
    const cut = b.wound && v.clock.now - b.wound.at < 4;
    if (cut) { const i = b.pendingSick.findIndex(x => x.wound); if (i >= 0 && d.act.chance(0.8)) b.pendingSick.splice(i, 1); b.wound = null; }
    return { say: [cut ? 'Washed my hands, and the cut on my shin, clean.' : 'Washed my hands in the water.'] };
  },
};

// ------------------------------------------------------------ shelter and fire

// Heap what I carry into a bed: a hand's depth of dry stuff between me and the ground.
export const MAKE_BED = {
  id: 'bed', name: 'Make up a bed',
  reads: ['stuff'], writes: ['site.bed'],
  hours: 0.15, kcal: 120,
  ready: v => (v.stuff.length ? true : 'Nothing to make a bed with.'),
  run(v) {
    const add = v.stuff.reduce((a, it) => a + (it.props.loft ?? 0.3), 0), wet = v.stuff.reduce((a, it) => a + (it.props.moisture ?? 0.2), 0) / v.stuff.length;
    const before = v.site.bed?.clo ?? 0;
    v.site.bed = { clo: Math.min(1.5, before + add), wet: clamp(((v.site.bed?.wet ?? 0) * before + wet * add) / (before + add)) };
    const b = v.site.bed;
    return { use: v.stuff, say: [`${before ? 'Added to the bed' : 'Heaped up a bed'}: ${b.clo < 0.5 ? 'a thin layer, but better than bare ground' : b.clo < 1 ? 'a hand’s depth to lie on' : 'a deep, springy pile'}${b.wet > 0.35 ? ', though damp' : ''}.`] };
  },
};
export const BUILD_HUT = {
  id: 'hut', name: 'Build a debris hut',
  reads: ['here.dark'], writes: ['site.hut', 'milestones.hut'],
  hours: 3.5, kcal: 320,
  ready: v => (v.here.dark ? 'Too dark to build.' : true),
  run(v) {
    v.site.hut = true;
    const first = !v.milestones.hut; v.milestones.hut = true;
    return { say: ['Built a debris hut: a ridgepole, ribs of dead branches, and an arm-deep pile of leaves on top.', ...(first ? [['A shelter.', 'milestone']] : [])] };
  },
};
export const FEED_FIRE = {
  id: 'feed', name: 'Feed the fire',
  reads: ['wood', 'clock.now'], writes: ['site.fireUntil'],
  run(v) { v.site.fireUntil = Math.max(v.site.fireUntil ?? -1, v.clock.now) + 3; return { use: [v.wood], say: ['Fed the fire.'] }; },
};

// ------------------------------------------------------------ stone

const SKILL_STATE = ['body.skills', 'body.fatigue', 'body.hands', 'body.callus', 'body.focus', 'body.peakHands', 'body.attempts', 'body.outcomes'];
// Smash a stone on an anvil with a hammerstone (bipolar flaking, craft.js): flakes whose sharpness
// follows the stone's fracture and how well the blow went; hardness from the stone; and a one in four
// chance the stone is used up.
export const KNAP = {
  id: 'knap', name: 'Knap flakes',
  reads: ['core', 'hammer.props', 'anvil', 'site.key', 'here.dark'], writes: [...SKILL_STATE, 'milestones.edge'],
  hours: 0.25, kcal: 200,
  ready: v => (v.here.dark ? 'Too dark to work. Time to sleep.' : true),
  run(v, d) {
    const { core } = v, rng = d.act;
    const res = knapFlakes(rng, v.body, { props: core.props, provenance: { name: core.from?.name ?? core.name, source: core.from?.id, site: core.from?.site } }, { props: v.hammer.props }, v.anvil);
    const label = `flake, ${core.from.name}`;
    const make = res.flakes.map(f => ({ name: label, kind: 'edge', props: f.props, from: { id: f.provenance?.source, name: f.provenance?.name ?? '', part: label, site: v.site.key } }));
    const say = [make.length ? `Smashed the ${core.from.name} stone ${v.anvil.slab ? 'on the slab' : 'against a rock'}: ${make.length} usable flake${make.length > 1 ? 's' : ''}.` : `Smashed the ${core.from.name} stone; nothing but crumbs and blunt chunks.`];
    if (make.length && !v.milestones.edge) { v.milestones.edge = true; say.push(['My first cutting edge.', 'milestone']); }
    return { make, use: rng.chance(0.25) ? [core] : [], say, report: { success: res.success, margin: res.margin, flakes: make.length } };
  },
};

// ------------------------------------------------------------ food preparation
//
// Every way of working food changes its make-up through food.js's expose(): crushing, grinding,
// cutting, heat, water and drying, each done as well as my focus allows (q) under conditions set by
// the tools (a hard heavy pounding stone, gritty grinding stones, a sharp edge, enough hot stones).
// Water in or out changes the weight; what I'd tasted before no longer holds.
const PREP_WORDS = { pound: 'Pounded', grind: 'Ground', chop: 'Chopped up', roast: 'Roasted', leach: 'Left', soak: 'Soaked', dryfood: 'Dried', stoneboil: 'Stone-boiled' };
export function PREPARE(id) {
  return {
    id, name: PREP_WORDS[id],
    reads: ['mode', 'food.from', 'food.base', 'body.focus', 'here.fire', 'here.dark', 'here.waterTempC', 'site.basin', ...(id === 'pound' ? ['stone.props'] : []), ...(['grind', 'stoneboil'].includes(id) ? ['stones'] : [])],
    writes: ['food.props', 'food.notes', 'food.prep', 'food.name', ...(id === 'chop' ? ['edge.props.sharpness'] : [])],
    hours: v => ({ pound: 0.25, grind: 0.75, chop: 0.2, stoneboil: 0.75 }[id] ?? (id === 'roast' ? (v.mode === 'careful' ? 0.5 : 0.25) : ['leach', 'soak'].includes(id) ? Number(v.mode) : v.mode === 'fire' ? 2 : 4)),
    kcal: { pound: 260, grind: 240, chop: 150, roast: 180, leach: 140, soak: 140, dryfood: 140, stoneboil: 220 }[id],
    ready(v) {
      if (v.here.dark) return 'Too dark to work. Time to sleep.';
      if (id === 'dryfood' && v.mode === 'fire' && !v.here.fire) return 'There’s no fire here to dry it by.';
      return true;
    },
    run(v, d) {
      const { food } = v, rng = d.act, say = [], use = [];
      const q = clamp(0.5 + 0.4 * v.body.focus + rng.normal(0, 0.1));
      let ex, tag, cond = {};
      if (id === 'pound') { // a hard, heavy pounding stone does more per blow
        const st = v.stone; cond.crushPower = clamp(st.props.hardness / 7, 0.3, 1) * clamp(Math.sqrt(st.props.mass / 800), 0.6, 1.2);
        ex = { crush: 0.5 }; tag = 'pounded';
      } else if (id === 'grind') { // gritty stones grind; smooth ones polish
        cond.rough = Math.max(...v.stones.map(x => x.props.rough ?? 0.4));
        ex = { grind: 0.9 }; tag = 'ground';
      } else if (id === 'chop') { const e = v.edge; cond.crushPower = 1; ex = { cut: 0.25 + 0.25 * (e.props.sharpness ?? 0.5) }; tag = 'chopped'; e.props.sharpness = Math.max(0, e.props.sharpness - 0.01); }
      else if (id === 'roast') { ex = { heat: { mode: 'roast', minutes: v.mode === 'careful' ? 25 : 10 } }; tag = 'roasted'; }
      else if (id === 'leach' || id === 'soak') { const hours = Number(v.mode); ex = { water: { mode: id === 'leach' ? 'running' : 'still', hours, tempC: v.here.waterTempC[id === 'soak' ? 'still' : 'running'] } }; tag = `${id === 'leach' ? 'leached' : 'soaked'} ${hours} h`; }
      else if (id === 'stoneboil') { // hot stones dropped into the basin; enough of them bring it to a boil, and some crack
        cond.heatPower = Math.min(1.2, 0.3 * v.stones.length + 0.1);
        for (const st of v.stones) if (rng.chance((st.props.spall ?? 0.3) * 0.4)) { use.push(st); say.push([`The ${st.name} burst with a crack in the fire.`, 'warn']); }
        ex = { heat: { mode: 'boil', minutes: 20 } }; tag = cond.heatPower >= 0.9 ? 'boiled' : 'simmered';
        if (cond.heatPower < 0.9) say.push(`With only ${v.stones.length} stone${v.stones.length === 1 ? '' : 's'} the water never quite boiled.`);
      } else { ex = { dry: v.mode === 'fire' ? 12 : 8 }; tag = 'dried'; }
      const before = food.props.chem, after = expose(before, ex, q, cond);
      if (id === 'roast' && v.mode === 'quick' && rng.chance(0.3)) { food.props.mass *= 0.85; say.push('Some of it charred black.'); }
      food.props.mass = r3(food.props.mass * (1 - before.water) / Math.max(0.05, 1 - after.water)); // water in or out changes the weight
      food.props.chem = after;
      food.notes = {}; // what I tasted before no longer holds
      food.prep.push(tag);
      food.name = `${food.base} (${food.prep.join(', ')})`;
      const how = id === 'leach' ? ` in the stream for ${v.mode} hours` : id === 'soak' ? ` for ${v.mode} hours` : id === 'dryfood' ? (v.mode === 'fire' ? ' by the fire' : ' in the sun') : id === 'stoneboil' ? ` in the ${v.site.basin.kind}` : '';
      say.push(`${PREP_WORDS[id]} the ${food.from.part} of the ${food.from.name}${how}. ${cap(textureWords(after))} now.`);
      return { use, say, report: { quality: q } };
    },
  };
}

// ------------------------------------------------------------ eating
//
// Cook it first if a fire is here (roasting), eat as much as the gut will hold, digest it. Harm from
// compounds sets the outcome bands (safe … potentially lethal); energy comes from digestion, net of
// what digesting costs, and protein past ~35% of the day's energy is wasted and sickening. A food that
// costs more to digest than it gives leaves me worse off. Germs on it (and my hands) risk a sour gut a
// day later; parasites in raw flesh, fever. A slow poison (amatoxin) gives no sign until the next day.
export const GUT_KG = 1.5; // a stomach-full
export const loreKey = (e, part) => `${e.lookalike?.mimics ?? e.id}:${part}`;
export const EAT = {
  id: 'eat', name: 'Eat',
  reads: ['food', 'here.fire', 'clock.now', 'body.focus', 'world'],
  writes: ['body.gut', 'body.macro', 'body.energy', 'body.sick', 'body.pendingSick', 'body.germs', 'food.props', 'lore'],
  hours: v => (v.here.fire ? 0.5 : 0.2), kcal: 120,
  ready: v => (GUT_KG - v.body.gut < 0.05 ? 'Too full to eat any more just now.' : true),
  run(v, d) {
    const it = v.food, b = v.body, rng = d.act, cooking = v.here.fire;
    let st = it.props.chem;
    if (cooking) st = expose(st, PREP.roast, 0.5 + 0.5 * b.focus);
    const m = Math.min(it.props.mass, GUT_KG - b.gut), all = m >= it.props.mass - 1e-6;
    if (!all) it.props.mass = r3(it.props.mass - m);
    b.gut += m;
    const how = cooking ? 'Roasted and ate' : 'Ate', what = `${all ? '' : 'some of '}the ${it.from.part} of the ${it.from.name}`;
    const n = nutrients(st, m);
    // protein and fat balance over roughly the last day
    const tot = b.macro.p + b.macro.f + b.macro.c + n.protein + n.fat + n.carb;
    const excess = Math.max(0, b.macro.p + n.protein - 0.35 * tot);
    const wasted = tot > 500 ? Math.min(n.protein, excess) : 0;
    b.macro.p += n.protein - wasted; b.macro.f += n.fat; b.macro.c += n.carb;
    const net = n.net - wasted;
    // harm, scaled gently by how much was eaten (a mouthful is not a meal)
    const outcome = harmBand(harm(st) * Math.sqrt(Math.min(1.5, m / 0.2)));
    const germs = (it.props.germs ?? 0) * (cooking ? 0.05 : 1);
    mix([it], b, 0.3);
    if (rng.chance(Math.min(0.7, (germs + 0.25 * b.germs) * Math.min(1, m / 0.2)))) b.pendingSick.push({ at: v.clock.now + 20, severity: Math.min(0.5, 0.15 + 0.4 * germs), text: 'A sour gut, then the runs. Something I ate wasn’t clean.' });
    const parasites = st.compounds.parasites ?? 0;
    if (parasites > 0.02 && rng.chance(Math.min(0.8, parasites * 1.5))) b.pendingSick.push({ at: v.clock.now + 30, severity: Math.min(0.5, 0.2 + parasites), text: 'A sour gut and fever. Something I ate raw.' });
    const irritant = Object.keys(st.compounds).some(k => COMPOUNDS[k].effect === 'irritant' && st.compounds[k] > 0.1);
    const key = loreKey(entityIn(v.world)(it.from.id), it.from.part);
    const L = (v.lore[key] ??= { ok: 0, sick: 0 });
    const delayed = !!st.compounds.amatoxin && /poison|lethal/.test(outcome);
    b.energy = clamp(b.energy + (/severe|lethal/.test(outcome) && !delayed ? Math.min(0, net) : net) / 24000);
    const feel = [`${cap(textureWords(st))}.`];
    if (irritant) feel.push('My mouth and throat burned.');
    if (wasted > 50) { b.sick = clamp(b.sick + Math.min(0.15, wasted / 1500)); feel.push('All lean, nothing fatty or starchy with it: my stomach turns, and I’m still hungry.'); }
    if (net < 0) feel.push('Heavy going; I doubt it gave back what it cost to get down.');
    else feel.push(m < 0.08 ? 'A few mouthfuls.' : b.gut > 1.2 ? 'Full.' : n.net / Math.max(0.05, m) < 600 ? 'Filling for now, but there’s not much in it.' : net > 400 ? 'That was real food.' : '');
    const use = all ? [it] : [], report = { eatenKg: m, netKcal: net, harm: outcome };
    if (delayed) {
      b.pendingSick.push({ lore: key, at: v.clock.now + 30, severity: outcome === 'potentially lethal' ? 0.95 : 0.6, text: `Sick, badly, a day after eating the ${it.from.name}. It must have been that.` });
      return { use, report, say: [`${how} ${what}. ${feel.join(' ')} Tasted fine.`.replace(/ +/g, ' ')] };
    }
    const bad = { 'mild upset': [0.15, 'My stomach didn’t like it.'], 'moderate poisoning': [0.4, 'Within the hour: sweating, cramps, vomiting.'], 'severe poisoning': [0.75, 'Violently ill soon after; I thought I might die.'], 'potentially lethal': [1, 'It was poison.'] }[outcome];
    if (bad) { b.sick = clamp(b.sick + bad[0]); L.sick++; } else L.ok++;
    return { use, report, say: [[`${how} ${what}. ${bad ? bad[1] : feel.join(' ')}`.replace(/ +/g, ' ').trim(), bad && bad[0] >= 0.4 ? 'warn' : 'act']] };
  },
};

// ------------------------------------------------------------ an hour's sleep
//
// One hour asleep (body.js): the night (v.night: air, wind, rain or snow, the ground's wet and snow,
// biters), what I'm sheltered by (v.shelter), lying on (the site's bed) and wearing, a banked fire
// (v.fireC, degrees) and my body give how well I sleep; that sets how far tiredness, sickness and a bad
// ankle mend, what shivering costs, how chilled I get, and how wet or dry my clothes and bed become.
// v.dt is the share of the hour slept.
export const SLEEP_HOUR = {
  id: 'sleep-hour', name: 'An hour asleep',
  reads: ['night', 'shelter', 'fireC', 'dt', 'body.clothes'],
  writes: ['body.fatigue', 'body.chill', 'body.energy', 'body.hyd', 'body.sick', 'body.limp', 'body.clothes.wet', 'site.bed'],
  run(v) {
    const b = v.body, dt = v.dt;
    const r = sleepHour({ env: v.night, shelter: v.shelter, bed: v.site.bed ?? null, clothes: b.clothes, fireC: v.fireC, body: { energy: b.energy, hyd: b.hyd, limp: b.limp ?? 0 } });
    b.fatigue = clamp(b.fatigue - 0.12 * (0.35 + 0.65 * r.quality) * dt); // even broken sleep rests me some
    b.chill = clamp((b.chill ?? 0) + r.chill * dt);
    b.energy = clamp(b.energy - dt * (0.0045 + r.kcal / 24000)); // asleep, about a hundred kcal an hour, more shivering
    b.hyd = clamp(b.hyd - dt * 0.015);
    b.sick = clamp(b.sick - dt * 0.03 * r.quality);
    if (b.limp > 0) b.limp = Math.max(0, b.limp - dt * 0.008 * r.quality);
    b.clothes.wet = clamp(b.clothes.wet + dt * (r.wetting - r.drying));
    if (v.site.bed && r.wetting) v.site.bed.wet = clamp(v.site.bed.wet + dt * 0.6 * r.wetting);
    return { report: r };
  },
};

// ------------------------------------------------------------ the passing of time
//
// Time passes in half-hour ticks, and each tick runs every process here in turn, in the same shape as
// any other: v.tick holds { dt (hours), kcal (the work's rate) } and v.was the sky at the tick's start.
// Each reads the state it cares about and changes only its own; none calls another. A new system is a
// new entry here.
const WET_WORDS = { rain: 'Rain set in.', storm: 'Thunder, then a downpour: a storm.', snow: 'Snow began to fall.', blizzard: 'The snow thickened and the wind got up: hard to see anything.', fog: 'Fog crept in; I can hardly see a stone’s throw.' };
export function moonLine(k) {
  const m = k.moon, up = m.alt > 0, cloud = ['overcast', 'rain', 'storm', 'snow', 'blizzard', 'fog'].includes(k.weather);
  if (cloud) return 'Cloud over everything: a black night.';
  if (!up || m.illum < 0.05) return m.illum < 0.05 ? 'No moon; only starlight.' : 'The moon isn’t up yet; only starlight.';
  return `A ${moonWords(m.phase)}${m.illum > 0.9 ? ', bright enough to see by' : m.illum < 0.3 ? ', not much use' : ''}.`;
}
export const TICKS = [
  { id: 'sky', reads: ['tick', 'was', 'sky', 'here.fire', 'site.hut'], writes: [], run(v) { // what changes in the sky gets a line: rain starting or stopping, fog, a storm, nightfall
    const a = v.was, b = v.sky, say = [];
    if (a.weather !== b.weather) {
      if (WET_WORDS[b.weather] && !(a.wet && b.wet)) say.push([WET_WORDS[b.weather], 'note']);
      else if (a.weather === 'fog' && b.weather !== 'fog') say.push(['The fog lifted.', 'note']);
      else if (a.wet && !b.wet) say.push([`The ${a.weather === 'snow' || a.weather === 'blizzard' ? 'snow' : 'rain'} stopped.`, 'note']);
      if (b.wet && v.here.fire && !v.site.hut && !a.wet) say.push(['Rain on the fire: it won’t last long like this.', 'warn']);
    }
    if (a.sunAlt >= -6 && b.sunAlt < -6) say.push(['Night fell.', 'note']);
    return { say };
  } },
  { id: 'moon', reads: ['sky', 'clock.day'], writes: ['mind.moonNoted'], run(v) { // once a night, while I'm awake in the dark: what the moon is doing
    const k = v.sky;
    if (k.sunAlt >= -6) return {};
    const night = k.t < 12 ? v.clock.day - 1 : v.clock.day; // a night belongs to the day it began
    if (v.mind.moonNoted === night) return {};
    v.mind.moonNoted = night;
    return { say: [[moonLine(k), 'note']] };
  } },
  { id: 'metabolism', reads: ['tick', 'sky.tempC', 'body.sick'], writes: ['body.hyd', 'body.energy', 'body.gut', 'body.macro'], run(v) {
    const { dt, kcal } = v.tick, b = v.body;
    b.hyd -= dt * (0.032 + 0.02 * Math.max(0, kcal - 150) / 250 + 0.02 * b.sick + (v.sky.tempC > 28 ? 0.015 : 0)); // more in the heat
    b.energy -= dt * kcal / 24000; // the stock holds about ten days of reserves
    b.gut = Math.max(0, b.gut - 0.12 * dt); // a stomach-full clears in half a day or so
    const fade = Math.exp(-dt / 24); for (const m of ['p', 'f', 'c']) b.macro[m] *= fade; // roughly the last day's diet
  } },
  { id: 'healing', reads: ['tick'], writes: ['body.limp'], run(v) {
    if (!(v.body.limp > 0)) return {};
    v.body.limp = Math.max(0, v.body.limp - v.tick.dt * 0.1 / 24);
    return { say: v.body.limp ? [] : [['My ankle feels sound again.', 'note']] };
  } },
  { id: 'warming', reads: ['tick', 'here.fire', 'body.clothes.wet'], writes: ['body.chill'], run(v) { // moving, and a fire, warm me back up; wet clothes slow it
    if (v.body.chill > 0) v.body.chill = Math.max(0, v.body.chill - v.tick.dt * (0.15 + (v.here.fire ? 0.3 : 0)) * (v.body.clothes.wet > 0.5 ? 0.4 : 1));
  } },
  { id: 'clothes', reads: ['tick', 'sky', 'here.shelter', 'here.wind', 'here.fire'], writes: ['body.clothes.wet'], run(v) { // rain soaks them out in the open; wind, sun and a fire dry them
    const k = v.sky, c = v.body.clothes, dt = v.tick.dt, pour = { storm: 2, blizzard: 1.5 }[k.weather] ?? 1;
    if (k.wet) c.wet = clamp(c.wet + dt * 0.3 * pour * (1 - v.here.shelter.rainBlock));
    else c.wet = clamp(c.wet - dt * (0.06 + 0.1 * v.here.wind.strength + (v.here.fire ? 0.4 : 0) + (k.weather === 'clear' && k.sunAlt > 20 ? 0.1 : 0)));
  } },
  { id: 'germs', reads: ['tick', 'sky.tempC'], writes: ['inv'], run(v) { // things carried together share what's on them; moist food breeds more, faster in the warm
    if (v.inv.length > 1) mix(v.inv, null, 0.01 * v.tick.dt, false);
    const warm = Math.pow(2, (v.sky.tempC - 20) / 10);
    for (const it of v.inv) if (it.kind === 'food' && it.props.chem.water > 0.5) it.props.germs = Math.min(1, it.props.germs + v.tick.dt * 0.008 * warm * (1 - it.props.germs));
  } },
  { id: 'drying', reads: ['tick', 'sky.wet', 'here.fire', 'here.ambient'], writes: ['inv'], run(v) { // moisture relaxes toward the air's: about a third of the gap a day, faster by a fire, slower in rain
    const days = (v.tick.dt / 24) * (v.here.fire ? 3 : 1) * (v.sky.wet ? 4 : 1);
    for (const it of v.inv) if (it.props.moisture !== undefined && it.kind !== 'food') it.props.moisture = v.here.ambient + (it.props.moisture - v.here.ambient) * Math.exp(-0.4 * days);
  } },
  { id: 'fire', reads: ['tick', 'sky', 'here.fire', 'site.hut'], writes: ['site.fireUntil'], run(v) { // rain eats a fire in the open
    if (v.here.fire && v.sky.wet && !v.site.hut) v.site.fireUntil -= v.tick.dt * ({ storm: 3, blizzard: 3, rain: 1, snow: 0.5 }[v.sky.weather] ?? 0);
  } },
  { id: 'illness', reads: ['clock.now'], writes: ['body.sick', 'body.pendingSick', 'lore'], run(v) { // what was brewing comes on when its time comes
    const b = v.body, say = [];
    for (const p of [...b.pendingSick]) if (v.clock.now >= p.at) {
      b.sick = clamp(b.sick + p.severity);
      b.pendingSick.splice(b.pendingSick.indexOf(p), 1);
      if (p.lore) v.lore[p.lore].sick++;
      say.push([p.text, 'warn']);
    }
    return { say };
  } },
];
