// notes.js — turn a site visit into a short field-notes blurb.
//
// Content selection judges salience against the character's *memory* (running
// statistics of their own noisy observations), never against the true distributions.
// Notes are usually the top three salient items plus "more of the same"; when several
// unknown things turn up at once the note simply runs longer, ordered top-down.
// Newness is only remarked on ("new to me", "lots of new stuff") once the character has
// had two visits in a row with nothing new; before that, everything is new. Likewise "the usual" and
// "as expected": until then, things met again are just "again", "more of those", "pretty common here".
//
// Vertebrates are observed through channels (sighting, tracks, calls, scat, damage,
// dens, snagged hair). Each channel reveals only some traits. Signs must be
// attributed: known maker, ambiguous between candidates, or an unresolved sign held
// in memory until the character sees the animal and links them.
//
// Memory is plain JSON and lives in the save file.

import { makeRng, clamp } from './rng.js';
import { samplePatch } from './generator.js';
import { siteFactors } from './variation.js';
import { animalNow } from './life.js';
import { plantNow, cuesNow, fruitShows } from './phenology.js';
import { populationAt, densityAt } from './population.js';

export function newMemory() {
  return { visits: 0, factors: {}, entities: {}, micro: {}, water: {}, signs: {}, recent: [], last: null, names: {} };
}

// ------------------------------------------------------------ statistics

function welford(stat, x) {
  stat.n = (stat.n ?? 0) + 1;
  const d = x - (stat.mean ?? 0);
  stat.mean = (stat.mean ?? 0) + d / stat.n;
  stat.M2 = (stat.M2 ?? 0) + d * (x - stat.mean);
}
function zScore(stat, x, floor) {
  if (!stat || stat.n < 3) return null;
  return (x - stat.mean) / Math.max(Math.sqrt(stat.M2 / (stat.n - 1)), floor);
}

// ------------------------------------------------------------ vocabulary

const MICRO_OPENERS = {
  woodland: ['Woodland.', 'Under the trees.', 'Into the wood.'],
  edge: ['Woodland edge.', 'Along the edge of the trees.', 'Thicket edge.'],
  glade: ['Open grassy ground.', 'A clearing.', 'Out in the open.'],
  streambank: ['Stream bank.', 'Down by the stream.', 'Along the water.'],
  streambed: ['Gravel bar in the stream.', 'In the stream bed.'],
  pond: ['Pond margin.', 'Edge of a marshy pond.'],
  outcrop: ['Rocky outcrop.', 'Up on the rocks.'],
  scree: ['Scree slope.', 'Loose rock on a slope.'],
  claybank: ['Eroded bank, clay showing.'],
  spring: ['A spring.'],
};
const MICRO_PLAIN = {
  woodland: 'woodland', edge: 'the edge of the trees', glade: 'open grassy ground', streambank: 'a stream bank',
  streambed: 'a gravel bar', pond: 'a marshy pond margin', outcrop: 'a rocky outcrop', scree: 'a scree slope', claybank: 'an eroded clay bank',
};
const COVER = { woodland: 'underbrush', edge: 'thicket', glade: 'grass', streambank: 'reeds', pond: 'reeds', outcrop: 'rocks', scree: 'rocks' };

const FACTOR_WORDS = {
  moisture: {
    up: { rel: ['everything a bit wetter here', 'damper underfoot than usual'], abs: ['wet ground', 'boggy in places'] },
    down: { rel: ['drier than usual around here', 'ground harder and drier than elsewhere'], abs: ['dry, hard ground'] },
  },
  exposure: {
    up: { rel: ['more open and sunny than usual', 'brighter than most spots'], abs: ['open and sunny'] },
    down: { rel: ['shadier than usual', 'more closed-in than elsewhere'], abs: ['shady and close'] },
  },
  fertility: {
    up: { rel: ['growth lusher than usual', 'everything a bit greener and thicker'], abs: ['lush growth'] },
    down: { rel: ['sparser growth than usual', 'thin, poor-looking soil'], abs: ['thin, stony soil'] },
  },
};

const TRAIT_WORDS = {
  height: ['tall', 'short'], stemThickness: ['thick-stemmed', 'spindly'], leafSize: ['broad-leaved', 'small-leaved'],
  fruitSize: ['big-fruited', 'small-fruited'], fruitColor: ['dark-fruited', 'pale-fruited'],
  hairiness: ['woolly', 'smooth-leaved'], size: ['big', 'small'], colorDepth: ['vividly coloured', 'drab'],
  colorTone: ['dark', 'pale'], rind: ['thick-crusted', 'thin-crusted'],
};

const T = {
  // np: a noun phrase for the thing ("a bush with stout thorns"); n: its name; an: name with article if countable
  // The resemblance is the name: "oak-looking" means it goes by "oak" from now on.
  // Templates 1–3 hyphenate the name, so they are skipped for two-word names (NAME_HYPHEN).
  name: [
    (np, n, an) => `${cap(np)}. Reminds me of ${an}.`,
    (np, n) => `${cap(np)}; ${n}-looking.`,
    (np, n) => `${cap(np)}, ${n}-ish.`,
    (np, n) => `${cap(np)}: ${n}-like.`,
    (np, n, an) => `${cap(np)}, a bit like ${an}.`,
    (np, n, an) => `${cap(np)}. Looks like ${an} to me.`,
  ],
  newName: [
    (np, n, an) => `New to me: ${np}. Reminds me of ${an}.`,
    (np, n) => `Haven't seen this before: ${np}; ${n}-ish.`,
    (np, n, an) => `Something new: ${np}, a bit like ${an}.`,
  ],
  surprise: [
    () => 'There\'s a lot to take in here.', () => 'These are some firsts.', () => 'This area has a lot going on.',
    () => 'I don\'t recognize these.', () => 'Lots of new stuff.', () => 'Hard to keep track of everything here.',
  ],
  trait: [
    (p, a) => `${cap(p)} here: ${a.startsWith('very') ? '' : 'noticeably '}${a}.`,
    (p, a) => `${cap(p)}, but ${a} ones.`,
    (p, a) => `${cap(p)} ${a} compared with elsewhere.`,
    (p, a) => `${cap(p)}: ${a}, for what it's worth.`,
  ],
  abundUp: [p => `Lots of ${p}.`, p => `${cap(p)} everywhere.`, p => `Thick with ${p}.`, p => `Plenty of ${p}.`],
  abundDown: [p => `Only a scattering of ${p}.`, p => `${cap(p)} sparse here.`, p => `Hardly any ${p}.`, p => `${cap(p)} few and far between.`],
  missing: [p => `No ${p} that I saw, oddly.`, p => `Didn't see any ${p} here.`, p => `Expected ${p} here; none.`],
  // things seen before, before the character expects anything (no "usual" until newness is remarked on);
  // `seenBeforeKinds` only when every item is a kind of plant or animal ("damson trees", "minnows")
  seenBefore: [l => `${cap(l)} again.`, l => `Seen before: ${l}.`],
  seenBeforeKinds: [l => `More of those ${l}.`, l => `The common ${l}.`, l => `${cap(l)} seem pretty common around here.`, l => `${cap(l)} again.`],
  usual: [l => `More of the same: ${l}.`, l => `The usual ${l}.`, l => `Otherwise ${l}, nothing remarkable.`, l => `Also ${l}, as you'd expect.`],
  usualAware: [l => `Nothing new; ${l}, as expected.`, l => `Nothing I haven't seen: ${l}.`],
  water: [c => `Water: ${c}.`, c => `There's water: ${c}.`],
  // signs
  trackNew: [(d, cm) => `Tracks in the soft ground: ${d}, about ${cm} cm.`, (d, cm) => `Prints: ${d}, ${cm} cm or so. No idea whose.`],
  trackNewAware: [(d, cm) => `Prints I don't recognize: ${d}, about ${cm} cm.`, (d, cm) => `Unfamiliar tracks: ${d}, ${cm} cm or so.`],
  callNew: [d => `Something calling: ${d}.`, d => `A call from somewhere close: ${d}.`],
  callNewAware: [d => `New call: ${d}.`, d => `Heard something new: ${d}.`],
  scatNew: [d => `Droppings: ${d}.`, d => `Found ${d}; no idea whose.`],
  damageNew: [d => `Sign of something: ${d}.`, d => `Something has been at work here: ${d}.`],
  denNew: [d => `${cap(d)}; something lives here.`, d => `Found ${d}.`],
  hairNew: [c => `Tufts of ${c} hair caught on bark.`, c => `Some ${c} hair snagged on a branch.`],
  ambiguous: [(d, a, b) => `${cap(d)}; ${a} or ${b}, can't tell which.`, (d, a, b) => `${cap(d)}, could be ${a}, could be ${b}.`],
  groupUp: [p => `Lots of tracks; a bigger group of ${p} than usual.`, p => `Tracks of a big group of ${p}.`],
  groupDown: [p => `Tracks of just one or two ${p}.`, p => `Only a few ${p} came through, by the tracks.`],
  link: [(d, n) => `${cap(d)}: so that's the ${n}.`, (d, n) => `Saw the ${n} right by ${d}; mystery solved.`],
  linkCall: [(d, n) => `${cap(d)}: so that's the ${n}.`, (d, n) => `Caught the ${n} calling, ${d}. That settles that.`],
  distantNew: [n => `Might have seen ${article(n)} ${n} up on a thermal.`, n => `Something big circling high up; ${article(n)} ${n}, maybe.`],
  bolt: [
    (c, slow) => `Something bolted through the ${c}, too fast to be one of those ${slow}.`,
    c => `Something bolted through the ${c}; didn't see what.`,
  ],
};

const NAME_HYPHEN = { name: [1, 2, 3], newName: [1] };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const IRREGULAR = { mosquito: 'mosquitoes', fungus: 'fungi', mouse: 'mice', deer: 'deer', fish: 'fish', trout: 'trout', elk: 'elk', quail: 'quail', grouse: 'grouse', dace: 'dace', perch: 'perch', crayfish: 'crayfish', yabby: 'yabbies', boar: 'boar' };
function plural(n) {
  const parts = n.split(' ');
  const last = parts.pop();
  const p = IRREGULAR[last] ?? (/(s|sh|ch|x)$/.test(last) ? `${last}es` : /[^aeiou]y$/.test(last) ? `${last.slice(0, -1)}ies` : `${last}s`);
  return [...parts, p].join(' ');
}
function joinList(xs, conj = 'and') {
  return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${conj} ${xs[xs.length - 1]}`;
}

// ------------------------------------------------------------ helpers

const memKeyOf = e => e.lookalike?.mimics ?? e.id; // the character thinks a lookalike IS its model
const nameOf = (mem, e) => mem.names[memKeyOf(e)] ?? e.name;
function pl(mem, e) {
  const n = nameOf(mem, e);
  if (e.kind === 'plant') {
    if (e.form === 'tree') return /tree$/.test(n) ? `${n}s` : `${n} trees`;
    if (e.form === 'shrub') return /bush$/.test(n) ? `${n}es` : `${n} bushes`;
    if (e.form === 'mushroom') return plural(n);
    return n;
  }
  return e.kind === 'stone' ? n : plural(n);
}
const KIND_NOUN = e => (e.kind === 'stone' ? 'stone' : e.kind === 'plant' ? { tree: 'tree', shrub: 'bush', herb: 'plant', grass: 'grass', mushroom: 'fungus', moss: 'moss', lichen: 'lichen' }[e.form] : 'creature');
// Same precedence as the name tables in names.js, so the cue matches the name.
const CUE_PRIORITY = [/papery/, /resin/, /umbrella/, /square stems/, /stiff hairs/, /thorns/, /pods/, /berries|fleshy fruits/,
  /nuts/, /fluff/, /cutting edges/, /dead stalks/, /grass-like leaves/, /seed heads/, /dry seeds/, /stringy/, /bark/];
const DESCRIPTOR = {
  bee: 'fuzzy bee', wasp: 'narrow-waisted wasp', mosquito: 'whining, long-legged insect', gnat: 'tiny biting fly', fly: 'buzzing fly', stinker: 'small animal that reeks of musk',
  grub: 'fat grub', ant: 'ant', termite: 'soft-bodied insect', worm: 'earthworm', woodlouse: 'armoured grey crawler', cricket: 'dark chirping insect', grasshopper: 'jumping insect', caterpillar: 'caterpillar', beetle: 'beetle', snail: 'snail',
  crayfish: 'clawed crawler', mussel: 'freshwater shellfish', rodent: 'small gnawing animal', hare: 'long-eared runner',
  lizard: 'scaly basker', frog: 'smooth-skinned hopper', groundbird: 'plump ground bird', songbird: 'small songbird', fish: 'fish',
  browser: 'long-legged hoofed animal', rooter: 'stocky, bristled animal with tusks', soarer: 'big soaring bird',
};
// season: { world, g } (ground.js state for the day), or null: then every feature counts as showing.
// Only what shows now describes a plant: no berries in winter, no leaves on a bare tree.
function firstCue(e, season = null) {
  if (e.kind === 'animal') {
    const t = e.traits;
    const base = t.key === 'predator' ? (t.pack ? 'big doglike hunter' : 'big catlike hunter') : DESCRIPTOR[t.key];
    const m = base.match(/^(small|big|fat|plump) (.*)$/); // size before colour: "small brown songbird"
    const core = m ? `${m[1]} ${t.color} ${m[2]}` : `${t.color} ${base}`;
    return `${core}${t.hairy ? ', covered in bristly hairs' : ''}`;
  }
  const cues = season?.g && e.kind === 'plant' ? cuesNow(season.world, e, season.g) : e.cues;
  for (const re of CUE_PRIORITY) {
    const c = cues.find(x => re.test(x));
    if (c) return c;
  }
  return cues[0] ?? (['herb', 'grass'].includes(e.form) ? 'dead, brown stems' : 'nothing much to tell it by');
}
const COUNTABLE = e => e.kind === 'animal' || (e.kind === 'plant' && ['tree', 'shrub', 'mushroom'].includes(e.form));
const article = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const withArticle = (e, n) => (COUNTABLE(e) ? `${article(n)} ${n}` : n);
function nounPhrase(e, season = null) {
  const cue = firstCue(e, season);
  if (e.kind === 'animal') return `${article(cue)} ${cue}`;
  if (e.kind === 'stone') return `some ${cue}`;
  const k = KIND_NOUN(e);
  // "a grass with blades with rough edges" → "a grass with blades that have rough edges"
  const fixed = /^[\w-]+( [\w-]+)? with /.test(cue) ? cue.replace(' with ', ' that have ') : cue;
  return `${article(k)} ${k} with ${fixed}`;
}
const NOTICE = { tree: 0.95, shrub: 0.85, herb: 0.55, grass: 0.5, mushroom: 0.4, moss: 0.55, lichen: 0.45, stone: 0.7, invertebrate: 0.35, small: 0.45, large: 0.5 };
const TRACK_GROUND = { streambank: 1, pond: 1, claybank: 1, spring: 0.8, glade: 0.5, edge: 0.5, woodland: 0.4, streambed: 0.2, outcrop: 0.1, scree: 0.05 };
function activeAt(e, time) {
  const a = e.cues.find(c => c.startsWith('active:')) ?? '';
  if (/night/.test(a) && time === 'night') return true;
  if (/dawn/.test(a) && time === 'dawn') return true;
  if (/dusk/.test(a) && time === 'dusk') return true;
  if (/day/.test(a) && (time === 'day' || time === 'dawn')) return true;
  return false;
}

function pick(mem, r, key, options) {
  const pool = options.map((o, i) => [o, i]);
  const fresh = pool.filter(([, i]) => !mem.recent.includes(`${key}:${i}`));
  const [o, i] = r.pick(fresh.length ? fresh : pool);
  mem.recent.push(`${key}:${i}`);
  if (mem.recent.length > 16) mem.recent.shift();
  return o;
}
const tpl = (mem, r, key, exclude = []) => pick(mem, r, key, T[key].filter((_, i) => !exclude.includes(i)));

// Signature keys: what the character can actually distinguish about a sign.
function signature(channel, e) {
  const s = e.signs;
  switch (channel) {
    case 'track': return `track:${s.track.type}:${s.track.sizeClass}`;
    case 'call': return `call:${s.call}`;
    case 'scat': return `scat:${s.scat}`;
    case 'damage': return `damage:${s.damage}`;
    case 'den': return `den:${s.den}`;
    case 'hair': return `hair:${s.hair}`;
  }
}
function signDesc(channel, e) {
  const s = e.signs;
  return { track: s.track?.type, call: s.call, scat: s.scat, damage: s.damage, den: s.den, hair: s.hair }[channel];
}

// ------------------------------------------------------------ naming new things
//
// A familiar-looking thing is named by resemblance ("peach-looking"). A made-up name is announced
// as such ("Some rusty, heavy blocks. I'll call it ironstone."). Several new kinds of one sort at
// once are bundled ("A couple of different kinds of snail ... I'll call them snail and brown snail").
// A new kind of something already named at this place or the one before is "another", compared
// with the earlier one ("Another snail, this one a bit bigger. I'll call this one big snail.").

// Places visited, most recent last; "the last two locations" are this one and the one before.
export function noteTrail(memory, site) {
  memory.trail ??= [];
  if (memory.trail[memory.trail.length - 1] !== site) memory.trail.push(site);
  if (memory.trail.length > 8) memory.trail.shift();
}
const recentSites = memory => (memory.trail ?? []).slice(-2);
export const kindOf = e => (e.kind === 'animal' ? `a:${e.traits.key}` : `${e.kind}:${e.nameBase ?? e.name}`);
const kindNoun = e => (e.kind === 'animal' ? e.traits.noun : e.nameBase ?? e.name);
const shortCue = (e, season) => firstCue(e, season).replace(/^(a|an|some) /, '');
function compare(e, prev, season = null) {
  if (!prev) return null;
  const fruitBoth = !season?.g || (fruitShows(season.world, e, season.g) && fruitShows(season.world, prev, season.g));
  const t = e.traits ?? {}, p = prev.traits ?? {};
  if (e.kind === 'animal') {
    const rel = (t.mass && p.mass) ? t.mass / p.mass : (t.sizeFactor ?? 1) / (p.sizeFactor ?? 1);
    if (rel > 1.2) return 'a bit bigger';
    if (rel < 0.83) return 'a bit smaller';
    if (t.color !== p.color) return t.color;
  } else if (e.kind === 'plant') {
    if (fruitBoth && t.fruitColor && p.fruitColor && t.fruitColor !== p.fruitColor) return `${t.fruitColor}-fruited`;
    if (t.color && p.color && t.color !== p.color) return t.color;
    if ((t.pace ?? 0) - (p.pace ?? 0) > 0.3) return 'a bit softer-leaved';
    if ((p.pace ?? 0) - (t.pace ?? 0) > 0.3) return 'a bit tougher-leaved';
  } else if (e.cues?.[0] !== prev.cues?.[0]) return e.cues[0].replace(/ blocks?$/, '');
  return 'a little different';
}
// es: entities new to me, found together at `site`. Returns sentences; records what was named where.
// season: { world, g }, so a plant is described only by what shows now (see firstCue).
export function namingSentences(es, memory, site, byId, r, season = null) {
  const out = [];
  memory.namedAt ??= {};
  const groups = new Map(), seen = new Set();
  for (const e of es) {
    if (seen.has(memKeyOf(e))) continue; // a lookalike is, to me, the thing it mimics
    seen.add(memKeyOf(e));
    const k = kindOf(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e);
  }
  const recent = recentSites(memory);
  for (const [k, g] of groups) {
    const before = (memory.namedAt[k] ?? []).filter(x => recent.includes(x.site) && !g.some(e => e.id === x.id));
    const prev = before.length ? byId?.(before[before.length - 1].id) : null;
    const names = g.map(e => nameOf(memory, e));
    if (g.length > 1) {
      const cues = g.map(e => shortCue(e, season)), says = cues.every((c, i) => new RegExp(`\\b${names[i].split(' ').pop()}s?\\b`, 'i').test(c));
      out.push(`${g.length === 2 ? 'A couple of' : 'A few'} different kinds of ${prev ? 'other ' : ''}${kindNoun(g[0])}${says ? '' : `: ${joinList(cues)}`}. I'll call them ${joinList(names)}.`);
    } else {
      const e = g[0], n = names[0], np = nounPhrase(e, season);
      if (prev) { const c = compare(e, prev, season); out.push(c === 'a little different' ? `Another ${kindNoun(e)}, much like the one before. I'll call this one ${n}.` : `Another ${kindNoun(e)}; this one is ${c}. I'll call this one ${n}.`); }
      else if (new RegExp(`\\b${n.split(' ').pop()}s?\\b`, 'i').test(np)) out.push(`${cap(np)}.`); // the description already says what it is
      else if (e.coined) out.push(`${cap(np)}. I'll call it ${n}.`);
      else {
        const key = memory.noveltyAware && r.chance(0.35) ? 'newName' : 'name';
        out.push(tpl(memory, r, key, / /.test(n) ? NAME_HYPHEN[key] : [])(np, n, withArticle(e, n)));
      }
    }
    for (const e of g) (memory.namedAt[k] ??= []).push({ id: e.id, site });
  }
  return out;
}

// ------------------------------------------------------------ main

// world: from generateWorld; memory: from newMemory() (mutated in place);
// site: map-node key; micro: microhabitat id; skill: 0–1; time: 'dawn' | 'day' | 'dusk' | 'night'.
// cond (optional): { doy, meanC, weather, wet, light (0..1: how well detail close by can be made out),
// hearing (0..1: what rain leaves of it) }. Sight of anything (plants, animals, tracks, droppings)
// scales with light; calls don't, but rain drowns them; animals follow their seasons (life.js animalNow).
// cond may also carry g (ground.js: the season's state, for plants in leaf, flower, fruit or died back),
// snowCm and litter here (hiding things on the ground; fresh snow showing tracks, leaves hiding them),
// and freshSnow (fallen in the last day or so).
export function observeSite(world, memory, { site, micro, skill = 0.5, time = 'day', cond = null }) {
  const light = cond?.light ?? 1, hearing = cond?.hearing ?? 1, snow = cond?.snowCm ?? 0, litter = cond?.litter ?? 0;
  const lowCover = (1 - Math.min(1, snow / 20)) * (1 - 0.5 * litter); // what's left showing of things on the ground
  const season = cond?.g ? { world, g: cond.g } : null;
  const place = key => makeRng(`${world.seed}/${key}`); // the place's dice, as the game's (realPlace)
  const env = world.environment;
  const all = [...world.stones, ...world.plants, ...world.animals];
  const byId = id => all.find(x => x.id === id);
  const m = env.microhabitats.find(x => x.id === micro);
  const r = makeRng(`${world.seed}/obs/${site}/${memory.visits}`);
  const f = siteFactors(world.seed, site, m);
  const perceived = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v + r.normal(0, 0.3)]));
  const microMem = (memory.micro[micro] ??= { visits: 0, seen: {} });
  noteTrail(memory, site);
  const firstVisit = memory.visits === 0;
  const skillF = 0.6 + 0.8 * skill;

  // ---- site character
  const charBits = [];
  for (const k of light < 0.1 ? ['moisture'] : light < 0.35 ? ['moisture', 'fertility'] : ['moisture', 'exposure', 'fertility']) { // in the dark, only what I can feel underfoot
    const z = zScore(memory.factors[k], perceived[k], 0.3);
    const dir = perceived[k] > 0 ? 'up' : 'down';
    if (z !== null && Math.abs(z) > 1.1) charBits.push({ score: Math.abs(z), key: `f-${k}-${z > 0 ? 'up' : 'down'}-rel`, words: FACTOR_WORDS[k][z > 0 ? 'up' : 'down'].rel });
    else if (z === null && Math.abs(perceived[k]) > 1.4) charBits.push({ score: Math.abs(perceived[k]) - 0.3, key: `f-${k}-${dir}-abs`, words: FACTOR_WORDS[k][dir].abs });
  }
  if (snow > 3) charBits.push({ score: 2.5, key: 'snow', words: [snow < 12 ? 'a skin of snow on the ground' : snow < 35 ? 'snow over my ankles' : snow < 70 ? 'knee-deep snow' : 'deep snow, heavy going'] });
  else if (litter > 0.45 && light >= 0.35) charBits.push({ score: 1.6, key: 'litter', words: ['dead leaves thick underfoot', 'ankle-deep in fallen leaves'] });
  if (cond?.g && cond.g.leaf < 0.3 && ['woodland', 'edge', 'deadfall'].includes(micro) && light >= 0.35 && world.plants.some(x => x.form === 'tree' && x.traits.deciduous)) charBits.push({ score: 1.4, key: 'bare', words: ['bare branches overhead', 'the trees bare'] });
  const sr = makeRng(`${world.seed}/terrain/${site}`);
  const slope = clamp(env.relief + 0.35 * sr.normal() + (['scree', 'outcrop'].includes(micro) ? 0.3 : 0));
  if (slope > 0.8) charBits.push({ score: 1.2, key: 'slope-steep', words: ['steep going', 'a stiff climb'] });
  else if (slope > 0.55 && r.chance(0.5)) charBits.push({ score: 0.6, key: 'slope-some', words: ['a bit of a slope', 'gently sloping'] });
  else if (slope < 0.15 && r.chance(0.4)) charBits.push({ score: 0.5, key: 'slope-flat', words: ['flat ground', 'dead level'] });
  let deadfall = 0;
  if (['woodland', 'edge'].includes(micro)) {
    deadfall = Math.round(Math.max(0, env.treeCover * 6 * Math.exp(0.4 * f.moisture + 0.5 * sr.normal())));
    if (deadfall >= 5) charBits.push({ score: 1.3, key: 'deadfall-lots', words: ['lots of deadfall', 'fallen timber everywhere'] });
    else if (deadfall === 0 && micro === 'woodland') charBits.push({ score: 0.9, key: 'deadfall-none', words: ['hardly any deadfall'] });
  }

  const items = [], usual = [], sightings = [], signObs = [];
  const noticedKeys = new Set();

  // ---- sessile things and invertebrates: seen directly
  // (cryptic things, under stones and logs or in the litter, only turn up when poking around)
  // (what lives here is the same draw the survey makes: population.js, on the place's own dice)
  for (const { e, n: count } of populationAt(world, micro, site, f, place).filter(({ e }) => !e.cryptic)) {
    const now = e.kind === 'animal' && cond ? animalNow(e, cond) : null;
    if (now && !now.here) continue; // overwintering out of sight
    const low = ['herb', 'grass', 'moss', 'lichen', 'mushroom'].includes(e.form) || e.kind === 'stone' || e.kind === 'animal';
    const look = cond?.g && e.kind === 'plant' ? plantNow(world, e, cond.g) : null; // flowers and fruit catch the eye; a died-back herb doesn't
    let p = NOTICE[e.kind === 'stone' ? 'stone' : e.form ?? e.cls] * skillF * light * (now?.seen ?? 1) * (look?.notice ?? 1) * (low ? lowCover : 1);
    if (!r.chance(clamp(p))) continue;
    sightings.push({ e, logCount: Math.log(count + 1) + r.normal(0, 0.2) });
  }

  // ---- vertebrates: sightings and signs through channels
  let bolted = null;
  for (const e of world.animals.filter(x => x.cls !== 'invertebrate' && x.habitats.some(h => h.micro === micro))) {
    const s = e.signs ?? {};
    const now = cond ? animalNow(e, cond) : null;
    if (now && !now.here) continue; // away for the winter, or asleep through it
    const active = activeAt(e, time);
    const dens = densityAt(e, site, place);         // near here (population.js): more where its guild is thick
    const here = 1 - Math.exp(-dens * 0.08);   // present right now
    const recent = 1 - Math.exp(-dens * 0.3);  // passed through in the last few days
    const presentNow = r.chance(here);
    if (s.distant) {
      if (presentNow && r.chance(clamp(0.5 + 0.5 * f.exposure, 0, 1) * (active ? 1 : 0.2) * (now?.seen ?? 1) * Math.min(1, 2 * light))) sightings.push({ e, distant: true });
      continue;
    }
    const seen = presentNow && r.chance(clamp(NOTICE[e.cls] * skillF * (active ? 1.3 : 0.5) * (1 - 0.5 * e.traits.wariness) * light * (now?.seen ?? 1)));
    if (seen) sightings.push({ e });
    if (presentNow && !seen && e.traits.wariness > 0.5 && s.speed > 0.6 && r.chance(0.3)) bolted = bolted ?? e;
    if (presentNow && s.call && active && r.chance(clamp(0.6 * (now?.calls ?? 1) * hearing))) signObs.push({ e, channel: 'call', seenToo: seen, callDesc: now ? now.callNow(r) : s.call });
    if (!r.chance(recent)) continue;
    const trackP = (snow > 2 ? (cond.freshSnow ? 1.2 : 0.8) : (TRACK_GROUND[micro] ?? 0.4) * (1 - 0.6 * litter)) * (0.4 + 0.6 * skill) * light * (cond?.wet ? 0.3 : 1); // prints show in snow, hide under leaves; rain blurs them
    if (s.track && r.chance(trackP)) {
      const g = samplePatch(world, e.id, site, micro).traits.groupSize;
      signObs.push({ e, channel: 'track', seenToo: seen, cm: Math.round(2 * s.track.lengthCm * Math.exp(r.normal(0, 0.08))) / 2, group: g ? Math.max(1, Math.round(g * Math.exp(r.normal(0, 0.25)))) : null });
    }
    if (s.scat && r.chance(0.3 * (0.4 + 0.6 * skill) * light)) signObs.push({ e, channel: 'scat', seenToo: seen });
    if (s.damage && r.chance(0.25 * (0.4 + 0.6 * skill) * light)) signObs.push({ e, channel: 'damage', seenToo: seen });
    if (s.den && r.chance(0.12 * light)) signObs.push({ e, channel: 'den', seenToo: seen });
    if (s.hair && r.chance(0.06 * light)) signObs.push({ e, channel: 'hair', seenToo: seen });
  }

  // ---- interpret sightings
  for (const sgt of sightings) {
    const e = sgt.e, key = memKeyOf(e);
    noticedKeys.add(key);
    const em = memory.entities[key];
    sgt.traits = {};
    if (!sgt.distant) {
      const patch = samplePatch(world, e.id, site, micro).traits;
      const shows = id => !season || e.kind !== 'plant' || (/^fruit/.test(id) ? fruitShows(world, e, season.g) : /^(leafSize|hairiness)$/.test(id) ? plantNow(world, e, season.g).leaf >= 0.3 : true); // no sizing up fruit that isn't there
      for (const t of e.varying.filter(v => v.kind === 'visible' && shows(v.id))) {
        sgt.traits[t.id] = { latent: t.scale === 'log' ? Math.log(patch[t.id]) + r.normal(0, 0.1) : patch[t.id] + r.normal(0, 0.05), scale: t.scale };
      }
    }
    if (!em) { items.push({ score: sgt.distant ? 2.2 : 3, type: sgt.distant ? 'distantNew' : 'new', e }); continue; }
    let mentioned = false;
    const hits = [];
    for (const [tid, o] of Object.entries(sgt.traits)) {
      const z = zScore(em.traits?.[tid], o.latent, o.scale === 'log' ? 0.08 : 0.04);
      if (z !== null && Math.abs(z) > 1.1 && TRAIT_WORDS[tid]) hits.push({ tid, z });
    }
    if (hits.length) { items.push({ score: Math.max(...hits.map(x => Math.abs(x.z))), type: 'trait', e, hits: hits.slice(0, 2) }); mentioned = true; }
    if (sgt.logCount !== undefined) {
      const z = zScore(em.abund, sgt.logCount, 0.15);
      if (z !== null && Math.abs(z) > 1.3) { items.push({ score: Math.abs(z) * 0.9, type: z > 0 ? 'abundUp' : 'abundDown', e }); mentioned = true; }
    }
    if (!mentioned) usual.push({ text: sgt.distant ? `${nameOf(memory, e)} overhead` : pl(memory, e), e });
  }

  // ---- interpret signs: attribute, leave ambiguous, or hold as unresolved
  const knownAnimals = world.animals.filter(a => a.signs && memory.entities[memKeyOf(a)]);
  for (const so of signObs) {
    const { e, channel } = so;
    const key = so.callDesc ? `call:${so.callDesc}` : signature(channel, e); // a call of the season is a sound of its own
    const desc = so.callDesc ?? signDesc(channel, e);
    const sig = memory.signs[key];
    so.key = key;
    if (so.seenToo) {
      // The maker is in view: link the sign if it was a mystery, otherwise it's ordinary.
      if (sig && !sig.linked) items.push({ score: 3.1, type: channel === 'call' ? 'linkCall' : 'link', e, desc, key });
      else so.attributed = e;
      so.linkTo = e;
      continue;
    }
    if (sig?.linked) { so.attributed = byId(sig.linked); }
    else {
      const cands = channel === 'call' ? [] : knownAnimals.filter(a => a.signs[channel] && signature(channel, a) === key);
      if (cands.length === 1) so.attributed = cands[0];
      else if (cands.length > 1) { items.push({ score: 1.6, type: 'ambiguous', desc, a: cands[0], b: cands[1], key, channel }); continue; }
    }
    if (so.attributed) {
      const a = so.attributed, em = memory.entities[memKeyOf(a)];
      if (channel === 'track' && so.group && em) {
        const z = zScore(em.traits?.groupSize, Math.log(so.group), 0.15);
        if (z !== null && Math.abs(z) > 1.2) { items.push({ score: Math.abs(z), type: z > 0 ? 'groupUp' : 'groupDown', e: a }); continue; }
      }
      if (channel === 'track') usual.push({ text: `${nameOf(memory, a)} tracks` });
      else if (channel === 'call') usual.push({ text: `the ${nameOf(memory, a)} calling` });
      continue;
    }
    // Unresolved.
    if (!sig) items.push({ score: channel === 'call' ? 2.3 : channel === 'track' ? 2.4 : 1.8, type: `${channel}New`, desc, cm: so.cm, key, channel });
    else usual.push({ text: channel === 'call' ? `${desc} again` : /^an? /.test(desc) ? `another ${desc.replace(/^an? /, '')}` : `more ${desc}` }); // "another nest scraped in the ground", not "more a nest"
  }
  if (bolted) {
    const slow = knownAnimals.filter(a => !a.signs.distant && a.signs.speed < bolted.signs.speed - 0.15 && a.cls === 'large');
    items.push({ score: 1.9, type: 'bolt', slow: slow[0] ? pl(memory, slow[0]) : null });
  }

  // ---- expected but not seen (sessile only: animals move)
  if (microMem.visits >= 3) {
    const miss = [];
    for (const [key, n] of Object.entries(microMem.seen)) {
      const e = byId(key);
      if (!e || noticedKeys.has(key) || n / microMem.visits < 0.6 || (e.kind === 'animal' && e.cls !== 'invertebrate')) continue;
      miss.push({ e, score: 1.2 + n / microMem.visits });
    }
    miss.sort((a, b) => b.score - a.score);
    if (miss.length) items.push({ score: miss[0].score, type: 'missing', e: miss[0].e, others: miss.slice(1, 2).map(x => x.e) });
  }
  for (const w of world.water.filter(w => w.micro === micro && !memory.water[w.id])) items.push({ score: 2.2, type: 'water', w });

  // merge abundance into trait notes for the same species
  for (const it of items.filter(x => x.type === 'abundUp' || x.type === 'abundDown')) {
    const tr = items.find(x => x.type === 'trait' && x.e === it.e);
    if (tr) { tr.abund = it.type; tr.score += 0.5; it.merged = true; }
  }
  const live = items.filter(x => !x.merged).sort((a, b) => b.score - a.score);

  // ---- length and framing. Novelty is only remarked on once the character has had
  // a couple of visits with nothing new (before that, everything is new and saying so is noise).
  const newCount = live.filter(x => ['new', 'distantNew', 'trackNew', 'callNew'].includes(x.type)).length;
  const aware = !!memory.noveltyAware;
  const cap3 = newCount >= 3 ? Math.min(6, 2 + newCount) : 3;
  let chosen = live.filter(x => x.score >= 1.1).slice(0, cap3);
  const LAYER = it => (it.type === 'water' ? 7 : !it.e ? 6 : it.e.kind === 'stone' ? 4 : it.e.kind === 'animal' ? 5 : { tree: 1, shrub: 2 }[it.e.form] ?? 3);
  if (newCount >= 3) chosen = [...chosen].sort((x, y) => LAYER(x) - LAYER(y)); // long notes read top-down: trees, bushes, ground, stone, creatures, signs
  // An association ("so that's the wren") comes after what it associates: the animal is seen (and
  // named) first, then the sign is put down to it. A link to something new brings its sighting along.
  for (const l of chosen.filter(x => x.type === 'link' || x.type === 'linkCall')) {
    if (memory.entities[memKeyOf(l.e)] || chosen.some(x => x.e === l.e && x.type === 'new')) continue;
    const seen = live.find(x => x.e === l.e && x.type === 'new');
    if (seen) chosen.push(seen);
  }
  chosen = [...chosen.filter(x => !/^link/.test(x.type)), ...chosen.filter(x => /^link/.test(x.type))];

  const out = [];
  const charChosen = charBits.sort((a, b) => b.score - a.score).slice(0, 2).map(c => pick(memory, r, c.key, c.words));
  const opener = firstVisit ? `Where I woke: ${MICRO_PLAIN[micro] ?? micro}.` : pick(memory, r, `open-${micro}`, MICRO_OPENERS[micro] ?? ['Somewhere new.']);
  out.push(charChosen.length ? `${opener.replace(/\.$/, '')}; ${charChosen.join('; ')}.` : opener);
  if (light < 0.35) out.push(light < 0.1 ? 'Too dark to see much; mostly I listened.' : 'Too dark to make out much.');
  if (aware && newCount >= 3 && r.chance(0.7)) out.push(tpl(memory, r, 'surprise')());
  // new things are named together, where the first of them would have gone
  const fresh = chosen.filter(x => x.type === 'new');
  let namedYet = false;
  for (const it of chosen) {
    if (it.type !== 'new') { out.push(realize(it)); continue; }
    if (!namedYet) { out.push(...namingSentences(fresh.map(x => x.e), memory, site, byId, r, season)); namedYet = true; }
  }
  const chosenEntities = new Set(chosen.map(x => x.e).filter(Boolean));
  const usualItems = usual.filter(u => (!u.e || u.e.kind !== 'stone') && !chosenEntities.has(u.e)).filter((u, i, all) => all.findIndex(v => v.text === u.text) === i).slice(0, 3);
  const usualText = usualItems.map(u => u.text);
  const usualKey = aware ? (r.chance(0.4) ? 'usualAware' : 'usual') : usualItems.every(u => u.e && !/ overhead$/.test(u.text)) ? 'seenBeforeKinds' : 'seenBefore';
  if (usualText.length && (chosen.length < 2 || r.chance(0.4)) && !firstVisit) out.push(tpl(memory, r, usualKey)(joinList(usualText)));
  if (out.length === 1) out.push('Nothing much to note.');

  function realize(it) {
    const e = it.e;
    switch (it.type) {
      case 'water': memory.water[it.w.id] = true; return tpl(memory, r, 'water')(it.w.cues.join(', '));
      case 'new': {
        const n = nameOf(memory, e);
        const np = nounPhrase(e, season);
        // when the plain description already says what it is ("a red ant"), no resemblance is needed
        if (new RegExp(`\\b${n.split(' ').pop()}s?\\b`, 'i').test(np)) return `${cap(np)}.`;
        const key = aware && r.chance(0.35) ? 'newName' : 'name';
        return tpl(memory, r, key, / /.test(n) ? NAME_HYPHEN[key] : [])(np, n, withArticle(e, n));
      }
      case 'distantNew': return tpl(memory, r, 'distantNew')(nameOf(memory, e));
      case 'trait': {
        const p = pl(memory, e);
        const words = joinList(it.hits.map(h => `${Math.abs(h.z) > 2 ? 'very ' : ''}${TRAIT_WORDS[h.tid][h.z > 0 ? 0 : 1]}`));
        if (it.abund === 'abundUp') return `${cap(p)} everywhere, and ${words}.`;
        if (it.abund === 'abundDown') return `Only a scattering of ${p}, and those ${words}.`;
        const mass = (e.kind === 'plant' && ['herb', 'grass'].includes(e.form)) || e.kind === 'stone';
        return tpl(memory, r, 'trait', mass ? [1] : [])(p, words);
      }
      case 'missing': return tpl(memory, r, 'missing')(joinList([pl(memory, e), ...it.others.map(o => pl(memory, o))], 'or'));
      case 'trackNew': return tpl(memory, r, aware ? 'trackNewAware' : 'trackNew')(it.desc, it.cm);
      case 'callNew': return tpl(memory, r, aware ? 'callNewAware' : 'callNew')(it.desc);
      case 'hairNew': return tpl(memory, r, 'hairNew')(it.desc);
      case 'ambiguous': return tpl(memory, r, 'ambiguous')(it.desc, pl(memory, it.a), pl(memory, it.b));
      case 'link': return tpl(memory, r, 'link')(it.desc, nameOf(memory, e));
      case 'linkCall': return tpl(memory, r, 'linkCall')(it.desc, nameOf(memory, e));
      case 'groupUp': case 'groupDown': return tpl(memory, r, it.type)(pl(memory, e));
      case 'bolt': return it.slow ? T.bolt[0](COVER[micro] ?? 'brush', it.slow) : T.bolt[1](COVER[micro] ?? 'brush');
      default: return T[it.type] ? tpl(memory, r, it.type)(it.desc ?? pl(memory, e)) : '';
    }
  }

  // ---- update memory. First sightings and new signs that didn't make it into the
  // notes stay unknown: the character will "discover" them another time.
  const introduced = new Set(chosen.filter(x => x.type === 'new' || x.type === 'distantNew').map(x => x.e.id));
  const introducedSigns = new Set(chosen.filter(x => /New$/.test(x.type) && x.key).map(x => x.key));
  const linked = chosen.filter(x => x.type === 'link' || x.type === 'linkCall');
  const linkedKeys = new Set(linked.map(x => x.key));
  memory.visits++;
  for (const k of Object.keys(perceived)) welford(memory.factors[k] ??= {}, perceived[k]);
  microMem.visits++;
  for (const sgt of sightings) {
    const key = memKeyOf(sgt.e);
    if (!memory.entities[key] && !introduced.has(sgt.e.id)) continue;
    const em = (memory.entities[key] ??= { seen: 0, traits: {} });
    em.seen++;
    microMem.seen[key] = (microMem.seen[key] ?? 0) + 1;
    for (const [tid, t] of Object.entries(sgt.traits)) welford(em.traits[tid] ??= {}, t.latent);
    if (sgt.logCount !== undefined) welford(em.abund ??= {}, sgt.logCount);
  }
  for (const so of signObs) {
    if (!so.key) continue;
    const sig = memory.signs[so.key];
    if (!sig && !introducedSigns.has(so.key) && !(so.linkTo && memory.entities[memKeyOf(so.linkTo)])) continue;
    const entry = (memory.signs[so.key] ??= { channel: so.channel, desc: so.callDesc ?? signDesc(so.channel, so.e), count: 0, linked: null });
    entry.count++;
    if (so.linkTo && memory.entities[memKeyOf(so.linkTo)] && (!sig || linkedKeys.has(so.key))) entry.linked = memKeyOf(so.linkTo);
    if (so.channel === 'track' && so.group && entry.linked && memory.entities[entry.linked]) welford(memory.entities[entry.linked].traits.groupSize ??= {}, Math.log(so.group));
  }
  for (const l of linked) memory.signs[l.key].linked = memKeyOf(l.e);
  memory.calm = introduced.size === 0 && introducedSigns.size === 0 ? (memory.calm ?? 0) + 1 : 0;
  if (memory.calm >= 2) memory.noveltyAware = true;
  memory.last = { site, micro, time };
  const noticed = [...new Set(sightings.map(x => x.e).filter(e => memory.entities[memKeyOf(e)]).map(e => e.id))];
  return { site, micro, time, length: chosen.length, text: out.join(' '), noticed };
}
