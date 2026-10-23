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
import { knapFlakes, notchHearth, refineNotch, carveSpindle, makeTinder, splinterBone, handDrill, lightFire } from './craft.js';
import { hazard as harmBand, animalNow } from './life.js';
import { expose, nutrients, harm, textureWords, COMPOUNDS, PREP } from './food.js';
import { plantNow } from './phenology.js';
import { namingSentences, noteTrail } from './notes.js';
import { moonWords } from './sky.js';
import { sleepHour } from './body.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// A chance taken, and noted as a draw (spread.js): what it was about, its chance, and whether it came off.
const roll = (d, kind, id, p, fields = {}) => { const hit = d.act.chance(p); d.note?.(kind, id, { p, observed: hit, ...fields }); return hit; };
// An attempt's draw (craft.js): its chance of success, how far over or under it fell, and whether it came off.
const tried = (d, id, res, fields = {}) => d.note?.('attempt', id, { p: res.p, margin: res.margin, success: res.success, ...fields });
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
export function populationAt(world, micro, siteKey, factors, place, note = null) {
  const out = [];
  for (const e of [...world.stones, ...world.plants, ...world.animals]) {
    const h = e.habitats.find(x => x.micro === micro);
    if (!h || (e.kind === 'animal' && e.cls !== 'invertebrate')) continue;
    const ar = place(`abund/${e.id}/${siteKey}`);
    const count = (h.perInstance ?? h.pieces) * Math.exp((e.kind === 'stone' ? 0 : 0.35 * factors.fertility) + 0.5 * ar.normal());
    const p = 1 - Math.exp(-count / 2), here = ar.chance(p);
    note?.('lives here', e.id, { name: e.name, count, p, observed: here });
    if (!here) continue;
    out.push({ e, n: count });
  }
  return out;
}
export const POPULATION = {
  id: 'population', name: 'What lives here',
  reads: ['site.key', 'site.micro', 'here.factors', 'world'], writes: [],
  run: (v, d) => ({ report: { present: Object.fromEntries(populationAt(v.world, v.site.micro, v.site.key, v.here.factors, d.place, d.note).map(({ e, n }) => [e.name, n])) } }),
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
export function findBones(world, site, effort, rng, note = null) {
  const vis = BONE_VIS[site.micro] ?? 1;
  const found = { fine: 0, big: 0 };
  for (const a of world.animals) {
    if (a.cls === 'invertebrate' || !a.habitats.some(h => h.micro === site.micro)) continue;
    const mu = effort * vis * (a.perKm2 ?? 0) * (a.traits.mass ?? 0) / 600; // expected finds; 600 kg/km² per find is tuning
    let n = 0, L = Math.exp(-mu), p = 1; // Poisson draw
    do { n++; p *= rng.next(); } while (p > L && n < 20);
    found[isFineBoned(a) ? 'fine' : 'big'] += n - 1;
    note?.('bones', a.id, { name: `bones of ${a.name}`, expected: mu, count: n - 1, observed: n > 1 });
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
    const present = populationAt(v.world, v.site.micro, v.site.key, v.here.factors, d.place, d.note);
    for (const { e, n } of present) {
      if (e.cryptic) continue; // under stones, logs and bark: only poking around finds these
      const low = ['herb', 'grass', 'moss', 'lichen', 'mushroom'].includes(e.form) || e.kind !== 'plant';
      const now = e.kind === 'animal' ? animalNow(e, cond) : null;
      if (now && !now.here) { d.note?.('noticed', e.id, { name: e.name, count: n, p: 0, observed: false, away: true }); continue; } // away or asleep for the season
      const visible = (e.kind === 'animal' ? 0.6 * now.seen : { herb: 0.85, grass: 0.9, mushroom: 0.6, moss: 0.9, lichen: 0.8 }[e.form] ?? 0.97) * cond.light * (low ? cover : 1) * (e.kind === 'plant' ? Math.min(1.2, plantNow(v.world, e, cond.g).notice) : 1);
      if (!roll(d, 'noticed', e.id, visible, { name: e.name, count: n })) continue;
      if (!v.mem.entities[memKeyE(e)] && !fresh.includes(e)) fresh.push(e);
      rows.push({ n, text: lineFor(e, n) });
      seen[e.name] = n;
      noteKnown(v.site, v.mem, e);
    }
    // animal sign: what's been left behind, not the animals themselves
    for (const a of v.world.animals.filter(a => a.cls !== 'invertebrate' && a.signs && a.habitats.some(h => h.micro === v.site.micro))) {
      if (!animalNow(a, cond).here || !roll(d, 'sign', a.id, (1 - Math.exp(-a.perKm2 * 0.3)) * cond.light * (cond.snowCm > 2 ? 1.5 : 1 - 0.6 * cond.litter), { name: `sign of ${a.name}` })) continue; // fresh sign shows in snow, hides under leaves
      const known = v.mem.entities[memKeyE(a)];
      const sign = a.signs.damage ?? (a.signs.track ? `sets of ${a.signs.track.type}` : a.signs.den);
      if (!sign) continue;
      rows.push({ n: 0.5, text: `${/^sets/.test(sign) ? 'a few' : '1'} ${sign.replace(/^(the|a) /, '')}${known ? ` (${a.name})` : ', left by some animal'}` });
      seen[`sign of ${a.name}`] = 1;
    }
    const bones = findBones(v.world, v.site, 0.35, rng, d.note);
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
    if (roll(d, 'made ill', w.name, w.pathogen * POOR_WATER, { pathogen: w.pathogen })) {
      const onset = 24 + d.act.uniform(0, 18);
      d.note?.('illness to come', w.name, { onsetHours: onset, severity: 0.25 + w.pathogen * 0.5 });
      v.body.pendingSick.push({ at: v.clock.now + onset, severity: 0.25 + w.pathogen * 0.5, text: 'Cramps and a loose gut. Something in the water, maybe.' });
    }
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
    if (cut) { const i = b.pendingSick.findIndex(x => x.wound); if (i >= 0 && roll(d, 'infection washed out', 'cut', 0.8)) b.pendingSick.splice(i, 1); b.wound = null; }
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
    tried(d, 'knap', res, { flakes: res.flakes.length });
    const label = `flake, ${core.from.name}`;
    const make = res.flakes.map(f => ({ name: label, kind: 'edge', props: f.props, from: { id: f.provenance?.source, name: f.provenance?.name ?? '', part: label, site: v.site.key } }));
    const say = [make.length ? `Smashed the ${core.from.name} stone ${v.anvil.slab ? 'on the slab' : 'against a rock'}: ${make.length} usable flake${make.length > 1 ? 's' : ''}.` : `Smashed the ${core.from.name} stone; nothing but crumbs and blunt chunks.`];
    if (make.length && !v.milestones.edge) { v.milestones.edge = true; say.push(['My first cutting edge.', 'milestone']); }
    return { make, use: roll(d, 'used up', 'core', 0.25) ? [core] : [], say, report: { success: res.success, margin: res.margin, flakes: make.length } };
  },
};

// ------------------------------------------------------------ wood, fibre, bone, fire
//
// Each a process over the things bound to it by slot (wood, edge, board, shoot, stalk, stick, tool,
// thing, mat, bone, hammer, spindle) and my crafting skill and wear (craft.js's attempt: a performance
// score from how well the tools suit their roles, skill and effort, with luck). Edges dull as they
// work (Archard's law, in craft.js); the first time one goes dull, I say so.
const dark = v => (v.here.dark ? 'Too dark to work. Time to sleep.' : true);
const provOf = it => ({ name: it.from?.name ?? it.name, source: it.from?.id, site: it.from?.site });
function dulled(edge, say) {
  if (edge.props.sharpness < 0.35 && !edge.toldDull) { edge.toldDull = true; say.push(`The ${edge.name} has gone dull.`); }
}
const EDGE = slot => [`${slot}.props`, `${slot}.toldDull`];
export const CRAFTS = {
  notch: { id: 'notch', name: 'Notch a hearth board', reads: ['mode', 'wood', 'edge.name', 'here.dark'], writes: [...SKILL_STATE, ...EDGE('edge')],
    hours: v => (v.mode === 'careful' ? 1.0 : 0.4), kcal: 160, ready: dark,
    run(v, d) {
      const { wood, edge } = v, hours = v.mode === 'careful' ? 1.0 : 0.4, say = [];
      const res = notchHearth(d.act, v.body, { props: wood.props, provenance: provOf(wood) }, { props: edge.props, name: 'flake' }, hours);
      tried(d, 'notch', res, { notch: res.board.props.notch, edgeLeft: edge.props.sharpness });
      say.push(`${v.mode === 'careful' ? 'Took my time and' : 'Quickly'} split and notched a hearth board from the ${wood.from.name} wood.`);
      dulled(edge, say);
      return { make: [{ name: `hearth board, ${wood.from.name}`, kind: 'board', props: res.board.props, from: wood.from }], use: [wood], say, report: { notch: res.board.props.notch, margin: res.margin } };
    } },
  refine: { id: 'refine', name: 'Touch up a notch', reads: ['board.from', 'edge.name', 'here.dark'], writes: [...SKILL_STATE, 'board.props', 'board.notes', ...EDGE('edge')],
    hours: 0.6, kcal: 150, ready: dark,
    run(v, d) {
      const say = [], res = refineNotch(d.act, v.body, v.board, { props: v.edge.props });
      tried(d, 'refine', res, { before: res.before, after: res.after });
      delete v.board.notes['Inspect the notch'];
      say.push(res.after > res.before ? 'Worked the notch slowly; it’s cleaner now.' : 'The edge slipped and tore the notch a little.');
      dulled(v.edge, say);
      return { say, report: { before: res.before, after: res.after } };
    } },
  carve: { id: 'carve', name: 'Carve a spindle', reads: ['shoot', 'edge.name', 'here.dark'], writes: [...SKILL_STATE, ...EDGE('edge')],
    hours: 0.5, kcal: 160, ready: dark,
    run(v, d) {
      const { shoot } = v, say = [], res = carveSpindle(d.act, v.body, { props: shoot.props, provenance: provOf(shoot) }, { props: v.edge.props });
      tried(d, 'carve', res, { straightness: res.spindle.props.straightness });
      say.push(`Carved a spindle from the ${shoot.from.name} ${shoot.kind === 'shoot' && shoot.props.moisture > 0.3 ? 'shoot. It’s green; it will need to dry' : 'shoot'}.`);
      dulled(v.edge, say);
      return { make: [{ name: `spindle, ${shoot.from.name}`, kind: 'spindle', props: res.spindle.props, from: shoot.from }], use: [shoot], say };
    } },
  trim: { id: 'trim', name: 'Trim a spindle from a stalk', reads: ['stalk', 'here.dark'], writes: [], hours: 0.15, kcal: 130, ready: dark,
    run: v => ({ make: [{ name: `spindle, ${v.stalk.from.name}`, kind: 'spindle', props: { ...v.stalk.props, length: 70 }, from: v.stalk.from }], use: [v.stalk], say: [`Snapped a ${v.stalk.from.name} stalk to length and rubbed it smooth: a spindle.`] }) },
  // hardness of the point: wood density, plus a little for a clean shape; green wood is softer until dried
  digstick: { id: 'digstick', name: 'Make a digging stick', reads: ['stick', 'tool.kind', 'tool.name', 'body.focus', 'here.dark'], writes: [...EDGE('tool'), 'milestones.stick'],
    hours: v => (v.tool.kind === 'edge' ? 0.5 : 1.0), kcal: 200, ready: dark, // grinding a point on rough stone is slow
    run(v, d) {
      const { stick, tool } = v, cut = tool.kind === 'edge', say = [];
      const dens = stick.props.density ?? 0.45;
      const finish = clamp((cut ? 0.6 + 0.4 * (tool.props.sharpness ?? 0.5) : 0.5) * (0.8 + 0.4 * v.body.focus) + d.act.normal(0, 0.08));
      d.note?.('workmanship', 'digstick', { finish });
      const green = (stick.props.moisture ?? 0.15) > 0.3;
      const hardness = clamp(dens * (0.75 + 0.25 * finish) - (green ? 0.08 : 0), 0.1, 0.95);
      if (cut) { tool.props.sharpness = Math.max(0, tool.props.sharpness - 0.04); dulled(tool, say); }
      say.unshift(`Shaped a digging stick from the ${stick.from.name} ${stick.kind === 'shoot' ? 'shoot' : 'wood'}, ${cut ? 'whittling' : 'grinding'} the end to a chisel point on ${cut ? 'the edge' : 'a rough stone'}.`);
      if (!v.milestones.stick) { v.milestones.stick = true; say.push(['A digging stick.', 'milestone']); }
      return { make: [{ name: `digging stick, ${stick.from.name}`, kind: 'diggingstick', props: { density: dens, moisture: stick.props.moisture, hardness, finish, hardened: 0 }, from: stick.from }], use: [stick], say };
    } },
  harden: { id: 'harden', name: 'Fire-harden the digging stick', reads: ['mode', 'here.ambient', 'here.fire', 'here.dark'], writes: ['stick.props'],
    hours: v => (v.mode === 'careful' ? 0.75 : 0.3), kcal: 140,
    ready: v => (v.here.dark ? 'Too dark to work. Time to sleep.' : v.here.fire ? true : 'There’s no fire here.'),
    run(v, d) {
      const careful = v.mode === 'careful', p = v.stick.props, room = 1 - p.hardness;
      const charred = !careful && roll(d, 'charred', 'point', 0.35);
      p.hardness = clamp(p.hardness + room * (careful ? 0.3 : 0.18) * (p.hardened ? 0.4 : 1) - (charred ? 0.08 : 0));
      p.moisture = Math.min(p.moisture ?? 0.2, v.here.ambient + 0.02);
      p.hardened++;
      return { say: [charred ? 'Hurried the stick over the fire and charred the tip; scraped off the black. Harder underneath, but the point is thinner.' : `Turned the point over the coals until it browned${careful ? ', slowly, a little at a time' : ''}. It rings harder when tapped.`], report: { charred } };
    } },
  // a hollow in rock, or a pit lined with clay, that holds water for hot-stone cooking
  basin: { id: 'basin', name: 'Make a cooking basin', reads: ['site.micro', 'here.dark'], writes: ['site.basin'],
    hours: v => (v.site.micro === 'claybank' ? 1.5 : 0.5), kcal: v => (v.site.micro === 'claybank' ? 320 : 180), ready: dark,
    run(v, d) {
      if (v.site.micro === 'claybank') { v.site.basin = { kind: 'clay-lined pit' }; return { say: ['Dug a pit beside the water and lined it with clay, smoothed wet. It holds water.'] }; }
      if (roll(d, 'found', 'rock hollow', 0.6)) { v.site.basin = { kind: 'rock hollow' }; return { say: ['Found a hollow in the rock that holds water: good enough to boil in with hot stones.'] }; }
      return { say: ['Looked for a rock hollow that would hold water; nothing that doesn’t drain.'] };
    } },
  // rinsing helps, but leaves the water's own germs behind: hands and thing are rinsed, not mixed
  wash: { id: 'wash', name: 'Wash something', rinse: true, reads: ['thing.name', 'here.water', 'here.dark'], writes: ['thing.props.germs', 'body.germs'], hours: 0.1, kcal: 120,
    ready: v => (!v.here.water ? 'There’s no water here.' : dark(v)),
    run(v) {
      const w = v.here.water.pathogen;
      v.thing.props.germs = r3(v.thing.props.germs * 0.3 + 0.4 * w);
      v.body.germs = v.body.germs * 0.5 + 0.3 * w;
      return { say: [`Washed the ${v.thing.name} in the water.`] };
    } },
  scorch: { id: 'scorch', name: 'Scorch a tool clean', reads: ['thing.name', 'here.fire', 'here.dark'], writes: [], hours: 0.1, kcal: 120,
    ready: v => (v.here.fire ? dark(v) : 'There’s no fire here.'),
    run: v => ({ say: [`Passed the ${v.thing.name} through the flames.`] }) },
  tinder: { id: 'tinder', name: 'Make a tinder bundle', reads: ['mat', 'here.dark'], writes: SKILL_STATE, hours: 0.2, kcal: 140, ready: dark,
    run(v, d) {
      const res = makeTinder(d.act, v.body, { props: v.mat.props, provenance: provOf(v.mat) });
      tried(d, 'tinder', res, { fineness: res.tinder.props.fineness });
      return { make: [{ name: `tinder bundle, ${v.mat.from.name}`, kind: 'tinder', props: res.tinder.props, from: v.mat.from }], use: [v.mat], say: [`Shredded the ${v.mat.from.name} ${v.mat.from.part} into a tinder nest.`], report: { fineness: res.tinder.props.fineness } };
    } },
  bone: { id: 'bone', name: 'Smash a bone for splinters', reads: ['bone', 'hammer.props', 'here.dark'], writes: [...SKILL_STATE, 'milestones.edge'], hours: 0.2, kcal: 160, ready: dark,
    run(v, d) {
      const res = splinterBone(d.act, v.body, v.bone, { props: v.hammer.props });
      tried(d, 'bone', res, { splinters: res.flakes.length });
      const make = res.flakes.map(f => ({ name: 'bone splinter', kind: 'edge', props: f.props, from: v.bone.from }));
      const say = [make.length ? `Cracked the bone: ${make.length} sharp splinter${make.length > 1 ? 's' : ''}.` : 'The bone shattered into useless bits.'];
      if (make.length && !v.milestones.edge) { v.milestones.edge = true; say.push(['My first cutting edge.', 'milestone']); }
      return { make, use: [v.bone], say, report: { splinters: make.length } };
    } },
};

// One go at the hand drill: spin the spindle in the notch until an ember comes or I give up. The socket
// burns in, the board burns through and the spindle shortens with each go; worn out, they're used up.
// Not possible with raw palms, too tired, or in the dark (ready gives the reason for stopping).
const DRILL_LINES = [
  [r => r.success, 'smoke thickened and a mound of dark dust began to glow'],
  [r => r.margin > -0.6, 'thick smoke and dark dust, but no glow'],
  [r => r.margin > -1.6, 'some smoke; the dust stayed coarse and pale'],
  [() => true, 'barely warm; the spindle just polished the socket'],
];
export const DRILL_ATTEMPT = {
  id: 'drill', name: 'Drill for an ember', reads: ['board', 'spindle', 'here.dark'], writes: [...SKILL_STATE, 'board.props', 'spindle.props'],
  hours: 0.25, kcal: 400,
  ready(v) {
    if (v.body.hands > 0.85) return 'my palms are raw; I have to stop';
    if (v.body.fatigue > 0.88) return 'too tired to keep going';
    if (v.here.dark) return 'too dark';
    return true;
  },
  run(v, d) {
    const res = handDrill(d.act, v.body, v.board, v.spindle), use = [];
    tried(d, 'drill', res, { vigor: res.ember ? res.ember.props.vigor : null });
    if (v.board.props.life <= 0.05) use.push(v.board);
    if (v.spindle.props.length < 40) use.push(v.spindle);
    return { use, report: { success: res.success, margin: res.margin, line: DRILL_LINES.find(([f]) => f(res))[1], ember: res.ember ? res.ember.props.vigor : null, burnedThrough: v.board.props.life <= 0.05, wornShort: v.spindle.props.length < 40 } };
  },
};
// Tip an ember into the tinder and blow: a flame if the tinder is fine and dry and the ember strong.
export const EMBER = {
  id: 'ember', name: 'Light a fire from an ember', reads: ['ember', 'tinder', 'wood', 'clock'], writes: [...SKILL_STATE, 'site.fireUntil', 'milestones.ember', 'milestones.fire'],
  hours: v => (v.tinder && v.wood ? 0.15 : 0), kcal: 180,
  run(v, d) {
    const say = [];
    if (!v.milestones.ember) { v.milestones.ember = true; say.push(['An ember!', 'milestone']); }
    if (!v.tinder) return { say: [...say, ['An ember, but no tinder bundle ready. It faded in the notch.', 'warn']] };
    if (!v.wood) return { say: [...say, ['An ember, but no wood to feed a flame. It faded.', 'warn']] };
    const res = lightFire(d.act, v.body, v.ember, v.tinder), use = [v.tinder];
    tried(d, 'light', res);
    if (!res.success) return { use, say: [...say, ['Tipped the ember into the tinder and blew, but it smothered and died.', 'warn']], report: { fire: false } };
    use.push(v.wood);
    v.site.fireUntil = v.clock.now + 3;
    say.push(['Tipped the ember into the tinder and blew. Smoke, then a flicker, then flame. Fire.', 'act']);
    if (!v.milestones.fire) { v.milestones.fire = true; say.push([`Fire, on day ${v.clock.day}.`, 'milestone']); }
    return { use, say, report: { fire: true } };
  },
};

// Everything handled together in a job shares what's on it: the things still carried and my hands mix
// toward a common germ load; heat (kill: the share left) kills most of it.
export const HANDLE = {
  id: 'handle', name: 'Handling', reads: ['handled', 'kill'], writes: ['inv', 'body.germs'],
  run(v) {
    const xs = v.inv.filter(i => v.handled.includes(i.uid));
    mix(xs, v.body, 0.4);
    if (v.kill != null) for (const i of xs) i.props.germs = r3(i.props.germs * v.kill);
  },
};

// Rest for some hours: tiredness and sore hands ease, focus comes back.
export const REST = {
  id: 'rest', name: 'Rest', reads: ['hours', 'dusk'], writes: ['body.fatigue', 'body.hands', 'body.focus'],
  hours: v => v.hours, kcal: 90,
  run(v) {
    const b = v.body, h = v.hours;
    b.fatigue *= Math.pow(0.15, h / 9);
    b.hands *= Math.pow(0.55, h / 12);
    b.focus = clamp(b.focus + 0.12 * h);
    return { say: [v.dusk ? 'Rested in the shade until dusk.' : `Rested for ${h === 1 ? 'an hour' : `${h} hours`}.`] };
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
      d.note?.('workmanship', id, { quality: q });
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
        for (const st of v.stones) if (roll(d, 'burst', st.uid, (st.props.spall ?? 0.3) * 0.4, { name: st.name })) { use.push(st); say.push([`The ${st.name} burst with a crack in the fire.`, 'warn']); }
        ex = { heat: { mode: 'boil', minutes: 20 } }; tag = cond.heatPower >= 0.9 ? 'boiled' : 'simmered';
        if (cond.heatPower < 0.9) say.push(`With only ${v.stones.length} stone${v.stones.length === 1 ? '' : 's'} the water never quite boiled.`);
      } else { ex = { dry: v.mode === 'fire' ? 12 : 8 }; tag = 'dried'; }
      const before = food.props.chem, after = expose(before, ex, q, cond);
      if (id === 'roast' && v.mode === 'quick' && roll(d, 'charred', 'food', 0.3)) { food.props.mass *= 0.85; say.push('Some of it charred black.'); }
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
    d.note?.('eaten', it.from.name, { kg: m, netKcal: net, harm: outcome, germs });
    if (roll(d, 'made ill', 'germs', Math.min(0.7, (germs + 0.25 * b.germs) * Math.min(1, m / 0.2)))) b.pendingSick.push({ at: v.clock.now + 20, severity: Math.min(0.5, 0.15 + 0.4 * germs), text: 'A sour gut, then the runs. Something I ate wasn’t clean.' });
    const parasites = st.compounds.parasites ?? 0;
    if (parasites > 0.02 && roll(d, 'made ill', 'parasites', Math.min(0.8, parasites * 1.5))) b.pendingSick.push({ at: v.clock.now + 30, severity: Math.min(0.5, 0.2 + parasites), text: 'A sour gut and fever. Something I ate raw.' });
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
