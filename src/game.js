// game.js — a playable slice of the first days, built on the generator, notes, process network and crafting model.

import { generateWorld, samplePatch } from './generator.js';
import { hazard, animalNow } from './life.js';
import { newMemory, observeSite, namingSentences, noteTrail } from './notes.js';
import { makeRng, clamp } from './rng.js';
import { siteFactors } from './variation.js';
import { generateLandscape, N as GN, CELL } from './landscape.js';
import { outlook } from './outlook.js';
import { windFor, smellSources, smellAt } from './smell.js';
import { hazardFactors, injuryReasons, injuryAt } from './injury.js';
import { groundAt, waterAt, crossingNow, snowCm, litterAt, deciduousShare } from './ground.js';
import { partNow, plantNow } from './phenology.js';
import { sleepHour, SHELTERS, naturalShelter } from './body.js';
import { windAt, skyAt, dawnAt, dayLength, seasonOf, dayOfYear, temperature, seeingFar, seeingNear, throughAir, moonWords, WEATHER_WORDS } from './sky.js';
import { cloneChem, expose, nutrients, harm, tasteWords, smellWords, textureWords, describeState, COMPOUNDS, PREP } from './food.js';
import { walkOdds, chooseSpawn, perceive, suspicionFrom, walk, followStage, shoreStage, stepHours, CLIFF_COST, sightline, lookoutEye, isLookout, bearingWord, bearing, distM, CUE_WORDS, loudWords, waterKeyAt, waterKeyOf, lineHours as rawLineHours } from './geo.js';
import { trailGraph, firstClear, placeLabels, suspectedCrossings, timeWords, awayWords, explainTrip } from './mentalmap.js';
import { materialsOf, expandGoal, thought, ITEMS, lookHint, PROCESSES } from './process.js';
import { pack, unpack } from './pack.js';
import { spread, reproduces } from './spread.js';
import { viewOf as viewFor, rehearse, apply, stateOver, hoursOf, kcalOf, readyFor } from './act.js';
import { TICKS, SLEEP_HOUR, CRAFTS, DRILL_ATTEMPT, EMBER, HANDLE, REST, DRINK, WASH_HANDS, MAKE_BED, BUILD_HUT, FEED_FIRE, KNAP, PREPARE, EAT, SURVEY, GUT_KG, loreKey, populationAt, findBones, boneLines, noteKnown as knowIt, pluralize, lineFor, mix } from './acts.js';
import { newCharacter, dry, ROLES, searchNaturalEdge, estimateFire } from './craft.js';

// ------------------------------------------------------------ helpers

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Typographic punctuation for everything people read.
const typo = s => String(s).replace(/(\w)'(\w)/g, '$1’$2').replace(/'(\w)/g, '‘$1').replace(/(\w)'/g, '$1’').replace(/"(\w)/g, '“$1').replace(/(\w|[.,!?])"/g, '$1”');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const clock = t => { const m = Math.round(t * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }; // 9.999 h is 10:00, not 09:00

const WATER_MICRO = ['streambank', 'streambed', 'pond', 'spring'];
const PRESET_LABEL = { '': 'Anywhere', 'temperate-woodland': 'Temperate woodland', 'warm-savanna': 'Warm savanna', 'cool-forest': 'Cool forest', 'dry-scrub': 'Dry scrub' };

let S = null;        // game state
let tab = 'actions'; // mobile tab

const now = () => (S.day - 1) * 24 + S.t;
// The sky now (sky.js): sun, moon, light, weather, temperature; kept until the clock moves.
const skyNow = () => (S._sky?.k === `${S.day}/${S.t}` ? S._sky.v : (S._sky = { k: `${S.day}/${S.t}`, v: skyAt(S.world, S.day, S.t) }).v);
// The land today (ground.js): snow, soak, stream flow, leaves, litter, growing season.
const groundNow = () => groundAt(S.world, S.day);
// Hooked onto the landscape, so walking, crossing and hearing (geo.js) see the land as it is today.
function landNow(L) {
  let memo = { day: null, g: null, cross: new Map() };
  const today = () => { if (memo.day !== S.day) memo = { day: S.day, g: groundNow(), cross: new Map() }; return memo.g; }; // looked up once a day: walking asks per cell
  return {
    cross(c) { const g = today(); let v = memo.cross.get(c); if (!v) { v = crossingNow(L, g, c, crossingAt(c % GN, Math.floor(c / GN))); memo.cross.set(c, v); } return v; },
    slow(c) { const cm = snowCm(L, today(), c); return cm > 2 ? 1 + cm / 40 : 1; }, // knee-deep snow (40 cm) doubles the time
    sound(a) { const w = waterAt(L, today(), cellOf(a.x, a.y)); return !w ? 1 : w.dry ? 0 : w.frozen ? 0.3 : Math.sqrt(Math.min(4, today().flow)); },
  };
}
const isNight = () => skyNow().sunAlt < -6; // too dark to work: the sun more than 6° down (civil twilight over)
const sunsetAt = day => 12 + dayLength(S.world, day) / 2;
// how damp things left out get: the climate's usual, wetter in rain and fog, drier on a clear afternoon
const ambient = () => { const k = skyNow(); return clamp(S.ambient + ({ rain: 0.15, storm: 0.25, fog: 0.12, snow: 0.08, blizzard: 0.12 }[k.weather] ?? (k.weather === 'clear' && k.sunAlt > 20 ? -0.03 : 0)), 0.03, 0.6); };
const site = () => S.sites[S.at];
const entity = id => [...S.world.stones, ...S.world.plants, ...S.world.animals].find(e => e.id === id);
const fireHere = () => (site().fireUntil ?? -1) > now();

function log(text, kind = 'act') {
  S.log.push({ day: S.day, t: S.t, text: typo(text), kind });
}

// ------------------------------------------------------------ world setup

// The start-screen outlook (trial walks) is only for showing; a replay or a test start can skip it.
// Making a world (species, landscape, spawn) takes a while, so a page can keep made worlds between runs
// (the tests do): window.__worldStore, if set, is { get(key) → text or null, set(key, text) }, keyed by
// the seed, the preset and a hash of the code that makes worlds (__GEN_HASH__, set by the build), so a
// change to that code never gets an old world. The fire estimate and the outlook are worked out fresh.
function makeWorld(seed, preset) {
  const store = typeof window !== 'undefined' ? window.__worldStore : null;
  const key = `${seed}|${preset ?? ''}|mc150|${typeof __GEN_HASH__ === 'undefined' ? 'dev' : __GEN_HASH__}`;
  const kept = store?.get(key);
  if (kept) return unpack(kept);
  const world = generateWorld(seed, { ...(preset ? { preset } : {}), mcSamples: 150 });
  const L = generateLandscape(world);
  const made = { world, L, spawn: chooseSpawn(L, seed) };
  store?.set(key, pack(made));
  return made;
}
function checkWorld(seed, preset, { withOutlook = true } = {}) {
  const { world, L, spawn } = makeWorld(seed, preset);
  const est = estimateFire(world);
  const water = world.water.filter(w => w.micro !== 'anywhere');
  return { world, est, water, L, spawn, outlook: withOutlook ? outlook(world, L, spawn, est, seed) : null };
}

function newGame(seed, preset, checked) {
  lhMemo.clear();
  for (const k of Object.keys(sel)) delete sel[k];
  checked = checked ?? checkWorld(seed, preset);
  const world = checked.world;
  S = {
    world, seed, preset, rng: makeRng(`${seed}/game`),
    // the body: crafting skill and wear (craft.js), water, food reserves, sickness, warmth, hurts, and what I'm wearing
    body: { ...newCharacter(), germs: 0.1, hyd: 0.8, energy: 0.75, sick: 0, pendingSick: [], gut: 0, macro: { p: 0, f: 0, c: 0 }, chill: 0, limp: 0, wound: null,
      clothes: { clo: 1.0, wet: 0 } }, // what I came in: trousers, shirt and a light jacket, about 1 clo; wet 0 dry .. 1 soaked
    mem: newMemory(), mind: { moonNoted: null }, day: 1, t: 6.5, showProps: false,
    sites: [], at: 0, inv: [], log: [], uid: 1,
    goal: 'fire', revealed: { fire: new Set() },
    milestones: {}, mats: materialsOf(world), lore: {},
    ambient: clamp(0.05 + 0.07 * world.environment.water, 0.05, 0.35),
    collapsed: 0, L: checked.L, suspects: [], attentive: false,
    waterNames: {}, streams: [], walked: {}, recentNotice: null,
  };
  S.L.dyn = landNow(S.L); // the land as it is each day, for walking, crossing and hearing
  { const k = skyNow(), tw = k.tempC < 5 ? 'cold' : k.tempC < 12 ? 'cool' : k.tempC < 22 ? 'mild' : 'warm';
    const when = (adj, rest) => (/season/.test(k.season) ? `a ${adj} morning in the ${k.season}${rest}` : `a ${adj} ${k.season} morning${rest}`);
    log(`${cap(k.weather === 'fog' ? when('foggy', ': I can hardly see a stone’s throw') : k.wet ? when('wet', `, ${WEATHER_WORDS[k.weather]} coming down`) : when(tw, `, ${WEATHER_WORDS[k.weather]}`))}.`, 'note'); }
  const first = newSite(checked.spawn.x, checked.spawn.y);
  first.name = 'where I woke';
  S.at = 0;
  look(first, 0.5);
  markSeen(first.x, first.y, 20, { eye: 1.7 });
  noteSeenFeatures();
  sense(first);
  log('I know how fire, tools and shelter work in principle. I have none of them. Water first, then fire.', 'thought');
}

function pickMicro() {
  const ms = S.world.environment.microhabitats.filter(m => m.id !== 'deadfall');
  const total = ms.reduce((s, m) => s + m.perKm2, 0);
  let u = S.rng.next() * total;
  for (const m of ms) { u -= m.perKm2; if (u <= 0) return m.id; }
  return ms[0].id;
}

const cellOf = (x, y) => y * GN + x;
// Walking-time guesses are asked for over and over as the map redraws; remember them.
const lhMemo = new Map();
function lineHours(L, a, b) {
  const k = `${Math.round(a.x)},${Math.round(a.y)},${Math.round(b.x)},${Math.round(b.y)}`;
  if (!lhMemo.has(k)) { if (lhMemo.size > 20000) lhMemo.clear(); lhMemo.set(k, rawLineHours(L, a, b)); }
  return lhMemo.get(k);
}
function microAt(x, y) { const m = S.L.micro[cellOf(x, y)]; return m === 'lake' ? 'pond' : m; }
// ------------------------------------------------------------ names for places and landmarks
//
// Things are called what they are, with no modifier: the hill, the falls, the crossing, the cliff, the
// lake, the stream bank. Proper names come in two ways: I name a place myself (renaming where I stand,
// or naming where something I collected came from), or a stretch of stream gets a name once I've walked
// every cell of it from end to end (see "names for streams"). A name I gave is never replaced.
const SITE_NOUN = { woodland: 'wood', edge: 'thicket', glade: 'clearing', streambank: 'stream bank', streambed: 'gravel bar', pond: 'marsh', outcrop: 'rocks', scree: 'scree', claybank: 'clay bank', spring: 'spring', deadfall: 'deadfall' };
const LANDMARK_NOUN = { hill: 'hill', cliff: 'cliff', lake: 'lake', waterfowl: 'lake', falls: 'falls', cascade: 'cascade', rapids: 'river', river: 'river', stream: 'stream', brook: 'brook', 'river trace': 'tree line' };
const namesInUse = () => new Set([...S.sites.map(t => t.name), ...S.suspects.map(u => u.label), ...Object.values(S.waterNames), ...Object.values(S.cliffNames ?? {})]);
function looksOf(kind, x, y) {
  const c = cellOf(x, y), veg = S.L.veg[c], tags = [];
  if (kind === 'hill') {
    const h = S.L.features.hills.reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a), S.L.features.hills[0]);
    if (h) tags.push(h.prominence > 120 ? 'tall' : h.prominence < 50 ? 'low' : null);
    tags.push(veg < 0.3 ? 'bald' : veg > 0.65 ? 'wooded' : null, S.L.slope[c] > 0.3 ? 'rocky' : null);
  }
  if (kind === 'cliff') tags.push((S.L.features.escarpments.find(e => Math.hypot(e.x - x, e.y - y) < 4)?.cells ?? 0) > 15 ? 'long' : null);
  if (kind === 'lake' || kind === 'waterfowl') { const l = S.L.features.lakes.find(e => Math.hypot(e.x - x, e.y - y) < 8); if (l) tags.push(l.cells > 120 ? 'big' : l.cells < 30 ? 'little' : null); }
  if (kind === 'site') { // a tree or bush the character already knows by name, standing here
    const m = S.world.environment.microhabitats.find(z => z.id === microAt(x, y));
    const top = S.world.plants.filter(e => ['tree', 'shrub'].includes(e.form) && S.mem.entities[e.id] && e.habitats.some(h => h.micro === m?.id)).sort((a, b) => (b.habitats.find(h => h.micro === m.id).perInstance) - (a.habitats.find(h => h.micro === m.id).perInstance))[0];
    if (top) tags.push(top.name);
  }
  return tags.filter(Boolean);
}
function uniqueName(base) { // things are called what they are: "the hill", however many hills there are
  S.lastTag = null;
  return `the ${base}`;
}
function waterName(wkey, kind, pos) {
  if (S.waterNames[wkey]) return S.waterNames[wkey];
  const noun = /^lake/.test(wkey) ? 'lake' : /^falls/.test(wkey) ? (kind === 'cascade' ? 'cascade' : 'falls') : /^brook/.test(wkey) ? 'brook' : ['river', 'rapids'].includes(kind) ? 'river' : 'stream';
  return (S.waterNames[wkey] = uniqueName(noun));
}

// ------------------------------------------------------------ streams as I know them
//
// Brooks, streams and rivers are lines on my map, made of fixes: cells where I've stood in, crossed or
// seen the water, each with the way it flows there (plain to see underfoot), its height (I know whether
// I climbed or dropped to reach it) and its size (brook, stream, river). Which stream a new fix belongs
// to is my judgement, not the world's: the same stream if it's within a couple of cells of one of that
// stream's fixes, or about the same size and plausibly upstream or downstream of one (the line between
// them runs roughly the way both flow, within 2.3 km); otherwise a new stream with a new name. The
// judgement is deliberately eager, as a person's would be: some of the dotted lines are wrong. Water only heard
// joins a stream near where I guess the sound is. Each fix is drawn joined to the nearest fix it could
// flow down to (a drainage tree), unless walking that way showed the stream doesn't run there.
// Following a stream (in stages; followStream) lays fixes every few cells along the way and keeps them
// in order as a run (downstream first to last); links along a run are stretches I've walked, drawn
// solid, and need no guessing.
// S.streams: [{ id, name, size, sus (a heard one not yet found), fixes: [{ x, y, flow, elev, size, how }], runs: [[fix, ...]] }]
const SIZE_NOUN = ['', 'brook', 'stream', 'river'];
const angDiff = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
function flowAt(x, y) { // the way it runs as far as I can see it from here: three cells on downstream
  let c = cellOf(x, y), n = 0;
  for (; n < 3 && S.L.down[c] >= 0; n++) c = S.L.down[c];
  return n ? bearing({ x, y }, { x: c % GN, y: Math.floor(c / GN) }) : null;
}
// height: of the water's surface (the landscape's hollow-filled surface, which water always runs down)
function makeFix(p, how) { const c = cellOf(p.x, p.y); return { x: p.x, y: p.y, flow: S.L.chan[c] ? flowAt(p.x, p.y) : null, elev: S.L.filled[c], size: S.L.chan[c] || 1, how }; }
function flowsTo(a, b) { // could water at fix a run down to fix b? (downhill, never shrinking, the way both flow, no rise between)
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (a.elev <= b.elev || d > 30) return false;
  if (d <= 2.5) return true;
  if (b.size < a.size) return false;
  const way = bearing(a, b);
  if ((a.flow != null && angDiff(way, a.flow) > 85) || (b.flow != null && angDiff(way, b.flow) > 85)) return false;
  for (let i = 1; i < d; i++) { // the ground between stays within 5 m of a straight descent from a to b, and isn't lake I've seen
    const t = i / d, c = cellOf(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t));
    if (S.L.elev[c] > a.elev + (b.elev - a.elev) * t + 5) return false;
    if (S.L.lake[c] && (S.seenLand?.[c] ?? 0) >= SEEN) return false;
  }
  return true;
}
function matchStream(fix) {
  let best = null, score = Infinity;
  for (const st of S.streams) {
    for (const f of st.fixes) {
      const d = Math.hypot(f.x - fix.x, f.y - fix.y);
      const sc = d <= 2.5 ? d : Math.abs(f.size - fix.size) <= 1 && (flowsTo(f, fix) || flowsTo(fix, f)) ? d + 3 : Infinity;
      if (sc < score) { score = sc; best = st; }
    }
    const u = st.sus && S.suspects.find(v => v.id === st.sus);
    if (u && !st.fixes.length && st.size === fix.size) {
      const d = Math.hypot(u.est.x - fix.x, u.est.y - fix.y);
      if (d <= Math.max(3, 1.5 * (u.err ?? 3)) && d + 1 < score) { score = d + 1; best = st; }
    }
  }
  return best;
}
function newStream(size, pos) {
  const id = `s${S.streams.length + 1}`, noun = SIZE_NOUN[size];
  const st = { id, name: `the ${noun}`, size, fixes: [] };
  S.waterNames[id] = st.name;
  S.streams.push(st);
  return st;
}
// A stream by id; one merged into another answers for the one it joined.
function streamById(id) {
  let st = S.streams.find(x => x.id === id);
  while (st?.into) st = S.streams.find(x => x.id === st.into);
  return st ?? null;
}
// Two streams I'd thought apart turn out to be one (I walked along the water from one to the other):
// the older keeps its name, and takes the other's fixes and walked stretches.
function mergeStreams(a, b) {
  if (a === b) return a;
  const [keep, drop] = S.streams.indexOf(a) < S.streams.indexOf(b) ? [a, b] : [b, a];
  keep.fixes.push(...drop.fixes);
  if (drop.runs?.length) (keep.runs ??= []).push(...drop.runs);
  keep.size = Math.max(keep.size, drop.size);
  keep.sus ??= drop.sus;
  Object.assign(drop, { fixes: [], runs: [], sus: null, into: keep.id });
  S.waterNames[drop.id] = keep.name;
  S.streamVer = (S.streamVer ?? 0) + 1;
  return keep;
}
// A fix on the water at p: which stream it is, and whether it's news. One fix per cell: a cell I
// already have a fix on keeps it, and its stream. `hint`: the stream I was heading for, if this cell
// is new to me; `along`: the stream I'm following to here, which is then the same water as whatever
// I already had here.
function addFix(p, how, hint = null, along = null) {
  for (const st0 of S.streams) {
    const old = st0.fixes.find(f => f.x === p.x && f.y === p.y);
    if (!old) continue;
    const via = along && streamById(along);
    return { st: via && via !== st0 ? mergeStreams(via, st0) : st0, isNew: false, fix: old };
  }
  const fix = makeFix(p, how);
  const st = (along && streamById(along)) || (hint && streamById(hint)) || matchStream(fix) || newStream(fix.size, p);
  st.fixes.push(fix);
  S.streamVer = (S.streamVer ?? 0) + 1;
  const u = st.sus && S.suspects.find(v => v.id === st.sus);
  if (u && !u.reached) u.reached = true; // the one I'd heard: found
  return { st, isNew: true, fix };
}
// Each stream as drawn: links from each fix to the nearest one it could flow down to, and lone fixes.
// The guesses are made afresh each time from what I know now, so one I've since learnt can't be
// (it would cross a lake I've seen, or leave a mouth) simply isn't drawn.
function streamTrees() {
  const memo = `${S.streamVer ?? 0}/${[...(S.streamGaps ?? [])].length}`;
  if (S.treeMemo?.key === memo) return S.treeMemo.trees;
  const gapKey = (a, b) => `${a.x},${a.y}>${b.x},${b.y}`;
  const trees = S.streams.filter(st => st.fixes.length).map(st => {
    const segs = [], walked = new Set();
    for (const run of st.runs ?? []) for (let i = 1; i < run.length; i++) { // stretches I walked along (downstream order): known
      const a = run[i - 1], b = run[i];
      if (a !== b && !walked.has(a)) { segs.push(Object.assign([a, b], { known: true })); walked.add(a); }
    }
    for (const f of st.fixes) {
      if (walked.has(f) || isMouth(f.x, f.y)) continue; // its way down is known: along a walked stretch, or into a lake
      let best = null;
      for (const g of st.fixes) if (g !== f && flowsTo(f, g) && !S.streamGaps?.has(gapKey(f, g)) && (!best || Math.hypot(g.x - f.x, g.y - f.y) < Math.hypot(best.x - f.x, best.y - f.y))) best = g;
      if (best) segs.push([f, best]);
    }
    const lone = st.fixes.filter(f => !segs.some(([a, b]) => a === f || b === f));
    return { id: st.id, name: st.name, segs, lone };
  });
  S.treeMemo = { key: memo, trees };
  return trees;
}
// The nearest point of a stream as drawn, and the link it lies on (null at a fix itself).
function nearestOnStream(t, from) {
  let best = null;
  const consider = (x, y, seg) => { const d = Math.hypot(x - from.x, y - from.y); if (!best || d < best.d) best = { x: Math.round(x), y: Math.round(y), d, seg }; };
  for (const f of t.lone) consider(f.x, f.y, null);
  for (const [a, b] of t.segs) {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1, k = clamp(((from.x - a.x) * dx + (from.y - a.y) * dy) / L2);
    consider(a.x + k * dx, a.y + k * dy, k > 0.05 && k < 0.95 ? [a, b] : null);
  }
  return best;
}
// A place where I found a landmark takes its name ("the hill"); water I reach leaves the place its own.
const placeNameFor = u => (u.group === 'water' ? null : u.label);

// ------------------------------------------------------------ names for streams
//
// A stream is "the brook", "the stream" or "the river" until I've walked one stretch of it from end to
// end. A stretch is an unbranched run of water between two of: a spring or other source (where the
// water starts), a fork (where streams join), a mouth (where it runs into a lake), an outlet (where it
// leaves one). Once every cell of a stretch is one I've stood in, crossed or walked along, it gets a
// name: the name of the water it carries on from, if that has one (a stretch above a fork carries the
// name of the stretch below it if it's the bigger branch, and the stretch below a fork carries the name
// of the bigger branch above it), or else a new one from something about it (a tree I know growing
// along it, something it runs from or to, its direction). A fork then bears the name of the stretch
// below it. Names I gave myself are never replaced. S.segNames: { "top>bottom" (cells): { name,
// top, bottom: {x, y}, cells: [cell, ...] } }.
const isSegTop = c => { const x = c % GN, y = Math.floor(c / GN); return inflowsAt(x, y).length !== 1 || isOutlet(x, y); };
function segmentFrom(top) { // the stretch from a top cell down to the next fork or mouth; null if it runs off the land
  const cells = [top];
  for (let c = top, n = 0; n < 400; n++) {
    const d = S.L.down[c];
    if (d < 0) return null; // off the edge of the land
    if (S.L.lake[d]) return cells.length > 1 ? cells : null; // c is a mouth
    c = d; cells.push(c);
    if (inflowsAt(c % GN, Math.floor(c / GN)).length >= 2) return cells; // a fork
  }
  return null;
}
const segAt = c => Object.values(S.segNames ?? {}).find(g => g.cells.includes(c)) ?? null;
// What to call the water at a cell: the name of its stretch, if it has one, else what it is.
function waterNameAt(st, x, y) { const g = segAt(cellOf(x, y)); return g ? g.name : st?.name ?? 'the stream'; }
const titleCase = w => w.split(/[\s-]+/).map(cap).join(' ');
function newSegmentName(cells) {
  const bottom = cells[cells.length - 1], noun = titleCase(SIZE_NOUN[S.L.chan[bottom] || 1]);
  const used = new Set(Object.values(S.segNames ?? {}).map(g => g.name));
  const at = c => ({ x: c % GN, y: Math.floor(c / GN) });
  const trees = new Map(); // trees and bushes I know by name, along it
  for (const c of cells) { const t = looksOf('site', at(c).x, at(c).y)[0]; if (t) trees.set(t, (trees.get(t) ?? 0) + 1); }
  const top = at(cells[0]), end = at(bottom);
  const words = [...[...trees].sort((a, b) => b[1] - a[1]).map(([t]) => t), cells.some(c => nearFeature(S.L.features.waterfalls, at(c), 0)) ? 'falls' : null,
    nearFeature(S.L.features.springs, top, 0) ? 'spring' : null, isOutlet(top.x, top.y) || isMouth(end.x, end.y) ? 'lake' : null, S.recentNotice, bearingWord(bearing({ x: GN / 2, y: GN / 2 }, top))];
  for (const w of words) if (w && !used.has(`${titleCase(w)} ${noun}`)) return `${titleCase(w)} ${noun}`;
  for (let k = 2; ; k++) if (!used.has(`${noun} ${k}`)) return `${noun} ${k}`;
}
// Name every stretch I've now walked from end to end. Called on arriving anywhere.
function nameSegments() {
  const walkedCells = new Set(S.streams.flatMap(st => st.fixes.filter(f => f.how !== 'near').map(f => cellOf(f.x, f.y))));
  if (S.segMemo === walkedCells.size) return;
  S.segMemo = walkedCells.size;
  S.segNames ??= {};
  const fresh = [];
  for (const top of [...walkedCells].sort((a, b) => a - b)) {
    if (!isSegTop(top)) continue;
    const cells = segmentFrom(top);
    if (!cells || !cells.every(c => walkedCells.has(c))) continue;
    const key = `${cells[0]}>${cells[cells.length - 1]}`;
    if (S.segNames[key]) continue;
    S.segNames[key] = { key, cells, top: { x: cells[0] % GN, y: Math.floor(cells[0] / GN) }, bottom: { x: cells[cells.length - 1] % GN, y: Math.floor(cells[cells.length - 1] / GN) }, name: null };
    fresh.push(S.segNames[key]);
  }
  if (!fresh.length) return;
  // names carry on along the bigger branch: settle those first, both ways, until nothing changes
  const all = Object.values(S.segNames), bigger = c => inflowsAt(c % GN, Math.floor(c / GN)).sort((a, b) => S.L.acc[cellOf(b.x, b.y)] - S.L.acc[cellOf(a.x, a.y)])[0];
  for (let changed = true; changed;) {
    changed = false;
    for (const g of fresh.filter(g => !g.name)) {
      const bot = g.cells[g.cells.length - 1], top = g.cells[0], below = all.find(h => h.name && h.cells[0] === bot), main = bigger(bot);
      if (below && main && cellOf(main.x, main.y) === g.cells[g.cells.length - 2]) { g.name = below.name; changed = true; continue; }
      const up = bigger(top), above = up && all.find(h => h.name && h.cells[h.cells.length - 1] === top && h.cells[h.cells.length - 2] === cellOf(up.x, up.y));
      if (above && inflowsAt(top % GN, Math.floor(top / GN)).length >= 2) { g.name = above.name; changed = true; }
    }
  }
  for (const g of fresh) {
    const named = !!g.name;
    g.name ??= newSegmentName(g.cells);
    const what = c => { const x = c % GN, y = Math.floor(c / GN); return isOutlet(x, y) ? 'where it leaves the lake' : isMouth(x, y) ? 'where it runs into the lake' : inflowsAt(x, y).length >= 2 ? 'the fork' : nearFeature(S.L.features.springs, { x, y }, 0) ? 'the spring' : 'its source'; };
    log(`I’ve walked all of this stretch now, from ${what(g.cells[0])} to ${what(g.cells[g.cells.length - 1])}${named ? `: more of ${g.name}` : `. I’ll call it ${g.name}`}.`, 'note');
    // the fork at its head bears its name
    const fork = S.sites.find(t => t.x === g.top.x && t.y === g.top.y && inflowsAt(t.x, t.y).length >= 2);
    if (fork && !fork.renamed) fork.name = g.name;
  }
}

// ------------------------------------------------------------ places worth a marker
//
// Every cell I've stood on is a place (the game remembers what I found there, and trails run through
// it), but once I've left it, it keeps a marker only if it's of interest in its own right, on that
// cell: a landmark I reached there, a stream's mouth or outlet, a fork, a spring, a waterfall, a
// crossing, a lookout, a clay bank, where I woke, a hut or a fire, or a name I gave it (naming where
// something I collected came from is how to keep a marker on a good patch).
// Anything else is marked only while I stand on it.
const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function inflowsAt(x, y) { // channel cells that drain into this one
  const c = cellOf(x, y);
  return NB8.map(([dx, dy]) => ({ x: x + dx, y: y + dy })).filter(q => q.x >= 0 && q.y >= 0 && q.x < GN && q.y < GN && S.L.chan[cellOf(q.x, q.y)] && !S.L.lake[cellOf(q.x, q.y)] && S.L.down[cellOf(q.x, q.y)] === c);
}
const nearFeature = (list, p, r) => list.some(f => Math.abs(f.x - p.x) <= r && Math.abs(f.y - p.y) <= r);
const isMouth = (x, y) => { const c = cellOf(x, y); return !!S.L.chan[c] && !S.L.lake[c] && S.L.down[c] >= 0 && !!S.L.lake[S.L.down[c]]; };
const isOutlet = (x, y) => { const c = cellOf(x, y); return !!S.L.chan[c] && !S.L.lake[c] && NB8.some(([dx, dy]) => { const n = cellOf(x + dx, y + dy); return x + dx >= 0 && y + dy >= 0 && x + dx < GN && y + dy < GN && S.L.lake[n] && S.L.down[n] === c; }); };
function waterMark(t) { // what makes a place by water worth a marker, if anything
  if (isMouth(t.x, t.y)) return 'mouth'; // where a stream runs into a lake
  if (isOutlet(t.x, t.y)) return 'outlet'; // where one leaves a lake
  if (S.L.chan[cellOf(t.x, t.y)] && inflowsAt(t.x, t.y).length >= 2) return 'fork';
  if (t.micro === 'spring' || nearFeature(S.L.features.springs, t, 0)) return 'spring';
  if (nearFeature(S.L.features.waterfalls, t, 0)) return 'falls';
  if (crossingAt(t.x, t.y)) return 'crossing';
  return null;
}
// Crossings (a ford, a tree down across the water, a rockfall): seen when I pass within a cell of one.
const CROSSING_WORDS = { ford: 'a ford, the water wide and shallow over gravel', deadfall: 'a tree down across the water', rockfall: 'boulders tumbled across the water' };
const crossingAt = (x, y) => S.L.features.crossings.find(q => q.x === x && q.y === y) ?? null;
function noticeCrossings(path) {
  S.crossingsKnown ??= [];
  for (const p of path) for (const q of S.L.features.crossings) {
    if (Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)) > 1 || S.crossingsKnown.some(k => k.x === q.x && k.y === q.y)) continue;
    S.crossingsKnown.push({ x: q.x, y: q.y, kind: q.kind });
    log(`A way over without wading: ${CROSSING_WORDS[q.kind]}. Marked the crossing.`, 'note');
  }
}
const lakeside = t => NB8.some(([dx, dy]) => { const x = t.x + dx, y = t.y + dy; return x >= 0 && y >= 0 && x < GN && y < GN && S.L.lake[cellOf(x, y)]; });
function unmarked(t) {
  return !(t === site() || waterMark(t) || t.landmark || isLookout(S.L, t.x, t.y) || t.micro === 'claybank' || t.name === 'where I woke' || t.hut || t.fireUntil > 0 || t.renamed);
}

// ------------------------------------------------------------ the mental map
//
// Nodes: every place I've been (true positions), every landmark I suspect but haven't reached
// (believed positions; "?" for things only heard once), and a few stretches of unexplored ground.
// Links between places are the trails I've walked plus guessed shortcuts where the trails make too
// long a detour (mentalmap.js's trailGraph); each landmark hangs off the place I saw it best from,
// each stretch of unexplored ground off the nearest place I've been. Streams are marked where I
// crossed them or where a link cuts the line through a stream's known points.
const DETOUR = 1.5; // a guessed shortcut goes on the map when the map's route is longer than this times the direct guess
function placeLinks() { // trails and shortcuts between visited places; only changes when I walk somewhere
  const memo = `${S.sites.length}/${JSON.stringify(S.walked)}`;
  if (S.linkMemo?.key === memo) return S.linkMemo.edges;
  const ix = new Map(S.sites.map((t, i) => [t.key, i]));
  const trails = Object.entries(S.walked).map(([k, w]) => { const [a, b] = k.split('|').map(x => ix.get(x)); return { a, b, hours: w.hours }; }).filter(e => e.a !== undefined && e.b !== undefined);
  const edges = trailGraph(S.sites, trails, (a, b) => lineHours(S.L, S.sites[a], S.sites[b]), { detour: DETOUR });
  S.linkMemo = { key: memo, edges };
  return edges;
}
const byDistance = p => [...S.sites].sort((s, t) => Math.hypot(s.x - p.x, s.y - p.y) - Math.hypot(t.x - p.x, t.y - p.y));
function mentalMap() {
  const nodes = [], links = placeLinks().map(e => ({ ...e }));
  S.sites.forEach((t, i) => nodes.push({ key: t.key, name: t.name, x: t.x, y: t.y, site: i, certainty: 'known', unmarked: unmarked(t), mark: waterMark(t) }));
  const segs = links.map(e => [S.sites[e.a], S.sites[e.b]]);
  const hang = (v, prefer, kind) => { // link v to the preferred place, or the nearest one that doesn't cross the map
    const t = firstClear(v, [...new Set([...prefer, ...byDistance(v)])], segs);
    links.push({ a: S.sites.indexOf(t), b: nodes.length, kind }); segs.push([t, v]); nodes.push(v);
  };
  const shown = new Set([...seenPieces('lake'), ...seenPieces('cliff')].map(q => q.key));
  for (const u of S.suspects) {
    if (u.reached || u.lost || shown.has(u.group === 'water' ? waterKeyOf(u.trueKey) : u.trueKey)) continue;
    hang({ key: u.id, name: u.label, x: u.est.x, y: u.est.y, sus: u.id, water: u.group === 'water', certainty: (u.channel === 'sound' && u.obs < 2) || u.channel === 'smell' ? 'unknown' : 'guess' }, byDistance(u.seenAt ?? u.est).slice(0, 1), 'sighting');
  }
  const streams = streamTrees().map(t => ({ key: t.id, name: t.name, segs: t.segs }));
  const edges = links.map(({ a, b, hours, walked, kind }) => {
    const A = nodes[a], B = nodes[b], w = walked ? S.walked[edgeKey(A.key, B.key)] : null;
    kind ??= walked ? 'trail' : 'shortcut';
    const certainty = w ? 'known' : [A.certainty, B.certainty].includes('unknown') ? 'unknown' : 'guess';
    const sc = suspectedCrossings(A, B, streams);
    const walkedX = (w?.crossings ?? []).map(k => ({ key: k, name: S.waterNames[k], walked: true, at: sc.find(c => c.key === k)?.at ?? { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 } }));
    return { a, b, hours: hours ?? lineHours(S.L, A, B), certainty, kind, stub: kind === 'stub', crossings: [...walkedX, ...sc.filter(c => !walkedX.some(x => x.key === c.key))] };
  });
  return { nodes, edges, streams };
}
// What I expect a trip to take: the time I walked it in, else my guess at the quickest way there.
function mapHours(from, key, target) {
  if (S.walked[edgeKey(from.key, key)]) return S.walked[edgeKey(from.key, key)].hours;
  return routeHours(from, target);
}
// My guess at walking times from a place: the quickest way over the ground as it looks, going round
// the lakes I know of and, where it pays, the cliffs (a known cliff cell costs CLIFF_COST times its
// walking time); Dijkstra over the grid; what I haven't seen I take as it looks.
// One field per place I'm at and per state of what I've seen; a target on a lake or cliff is reached
// beside it.
// Every step's walking time across the land today (stepHours, geo.js: slope, cover, snow, wading),
// worked out once a day: route-finding asks it of every cell, eight ways, each time the map is drawn.
let stepMemo = { key: null, h: null };
function stepGrid() {
  const key = `${S.seed}/${S.day}`;
  if (stepMemo.key === key) return stepMemo.h;
  const L = S.L, h = new Float64Array(GN * GN * 8);
  for (let c = 0; c < GN * GN; c++) {
    const x = c % GN, y = (c / GN) | 0;
    for (let k = 0; k < 8; k++) { const nx = x + NB8[k][0], ny = y + NB8[k][1]; h[c * 8 + k] = nx < 0 || ny < 0 || nx >= GN || ny >= GN ? Infinity : stepHours(L, { x, y }, { x: nx, y: ny }); }
  }
  stepMemo = { key, h };
  return h;
}
function routeField(from) {
  const key = `${from.x},${from.y}/${S.seenVer ?? 0}/${S.day}`; // the water changes by the day
  if (S.routeMemo?.key === key) return S.routeMemo.D;
  const esc = cliffIndex(), seen = S.seenLand, lake = S.L.lake, steps = stepGrid(), known = c => (seen?.[c] ?? 0) >= SEEN;
  const blocked = c => known(c) && !!lake[c];
  const D = new Float64Array(GN * GN).fill(Infinity), start = cellOf(from.x, from.y);
  // a binary heap of (time, cell) in two typed arrays
  let hd = new Float64Array(4096), hc = new Int32Array(4096), n = 0;
  const push = (c, d) => {
    if (n === hd.length) { const d2 = new Float64Array(n * 2), c2 = new Int32Array(n * 2); d2.set(hd); c2.set(hc); hd = d2; hc = c2; }
    let i = n++;
    while (i > 0) { const j = (i - 1) >> 1; if (hd[j] <= d) break; hd[i] = hd[j]; hc[i] = hc[j]; i = j; }
    hd[i] = d; hc[i] = c;
  };
  const pop = () => { // the cell with the least time; its time is left in hd[n]
    const c = hc[0], d = hd[0], ld = hd[--n], lc = hc[n];
    let i = 0;
    for (;;) { const l = 2 * i + 1, r = l + 1; let m = -1, md = ld; if (l < n && hd[l] < md) { m = l; md = hd[l]; } if (r < n && hd[r] < md) m = r; if (m < 0) break; hd[i] = hd[m]; hc[i] = hc[m]; i = m; }
    hd[i] = ld; hc[i] = lc; hd[n] = d;
    return c;
  };
  D[start] = 0; push(start, 0);
  while (n) {
    const c = pop(), d = hd[n];
    if (d > D[c] || (blocked(c) && c !== start)) continue; // a blocked cell gets a time (I can reach its edge) but leads nowhere
    const x = c % GN, y = (c / GN) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + NB8[k][0], ny = y + NB8[k][1]; if (nx < 0 || ny < 0 || nx >= GN || ny >= GN) continue;
      const m = cellOf(nx, ny), nd = d + (blocked(m) ? 0 : steps[c * 8 + k] * (lake[m] ? 1.6 : known(m) && esc[m] >= 0 ? CLIFF_COST : 1));
      if (nd < D[m]) { D[m] = nd; push(m, nd); }
    }
  }
  S.routeMemo = { key, D };
  return D;
}
const routeHours = (from, to) => routeField(from)[cellOf(clamp(Math.round(to.x), 0, GN - 1), clamp(Math.round(to.y), 0, GN - 1))];

// Sites are real positions: one place per cell, never merged with the one next to it.
function newSite(x, y, name) {
  const micro = microAt(x, y);
  const same = S.sites.find(t => t.x === x && t.y === y);
  if (same) return same;
  const noun = { fork: 'fork', falls: 'falls', spring: 'spring', mouth: 'mouth', outlet: 'outlet', crossing: 'crossing' }[waterMark({ x, y, micro })] ?? SITE_NOUN[micro] ?? micro; // a place by water named for what makes it one
  const headOf = noun === 'fork' ? Object.values(S.segNames ?? {}).find(g => g.top.x === x && g.top.y === y) : null; // a fork bears the name of the stretch below it
  const s = { key: `p${x}_${y}`, x, y, micro, name: name ?? headOf?.name ?? uniqueName(noun), known: new Set(), visits: 0, hut: false, fireUntil: -1 };
  S.sites.push(s);
  return s;
}

// ------------------------------------------------------------ distant cues and suspected landmarks

const COMPASS_RANDOM = () => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.floor(S.rng.next() * 8)];
// what the light and the air allow: for perceive (geo.js)
const skyView = () => { const k = skyNow(); return { far: seeingFar(k.lux), visibility: k.visibility, hearing: k.hearing }; };
// how well I can make out detail close by, here (the canopy shades my own cell)
const nearLight = (s = site()) => seeingNear(skyNow().lux * (1 - 0.75 * S.L.veg[cellOf(s.x, s.y)]));
// conditions for the animals and the notes (life.js animalNow, notes.js observeSite)
const condNow = (s = site()) => {
  const k = skyNow(), g = groundNow(), c = cellOf(s.x, s.y);
  return { doy: k.doy, meanC: k.meanC, weather: k.weather, wet: k.wet, light: nearLight(s), hearing: k.hearing, g, snowCm: snowCm(S.L, g, c), litter: litterAt(S.world, S.L, g, c), freshSnow: g.snowfall > 0 || groundAt(S.world, S.day - 1).snowfall > 0 };
};
const timeOfDay = () => { const a = skyNow().sunAlt; return a < -6 ? 'night' : a < 10 ? (S.t < 12 ? 'dawn' : 'dusk') : 'day'; };
const WATER_KINDS = ['falls', 'cascade', 'rapids', 'river', 'stream', 'brook', 'river trace', 'lake', 'waterfowl'];
const isWaterKind = k => WATER_KINDS.includes(k);
// One phrase per percept: sounds are reported by loudness (the ear can't measure distance), sights by distance.
const cuePhrase = (c, g, from) => `${CUE_WORDS[c.kind]} to the ${bearingWord(g.bearing)}, ${c.channel === 'sound' ? loudWords(c.level) : awayWords(lineHours(S.L, from, g.est), 'guess')}`;
// ------------------------------------------------------------ wind and smell
const windNow = () => windFor(S.world, S.day);
function smellsToday() {
  if (S._smellDay !== S.day) { S._smells = smellSources(S.world, S.L, S.day); S._smellDay = S.day; }
  return S._smells;
}
const SMELL_NOUN = { carcass: 'dead thing', sulfur: 'sulfur smell', musk: 'musky smell' };
// A smell gives a direction (upwind) and hardly any distance: the guess goes on the map as "?".
function associateSmell(c, from) {
  const wkey = c.source.waterKey;
  let sus = S.suspects.find(u => u.trueKey === (wkey ?? c.key));
  const fix = () => { // upwind, at a guessed distance
    const w = windNow(), dir = (w.from + S.rng.normal(0, 25)) * Math.PI / 180, dist = c.trueDist * Math.exp(S.rng.normal(0, 0.6)) / CELL;
    return { est: { x: clamp(Math.round(from.x + Math.sin(dir) * dist), 0, GN - 1), y: clamp(Math.round(from.y - Math.cos(dir) * dist), 0, GN - 1) }, err: fixErr('smell', dist * CELL) };
  };
  if (sus) { if (sus.lost) Object.assign(sus, fix(), { lost: false }); sus.obs++; noteSeenFrom(sus, from); return { sus, isNew: false }; }
  const { est, err } = fix();
  S.lastTag = null;
  const label = wkey ? waterName(wkey, 'lake', est) : uniqueName(SMELL_NOUN[c.kind] ?? 'smell');
  sus = { id: `u${S.suspects.length + 1}`, kind: wkey ? 'lake' : c.kind, group: wkey ? 'water' : 'smell', trueKey: wkey ?? c.key, truePos: { x: c.x, y: c.y }, est, err, seenAt: { x: from.x, y: from.y }, channel: 'smell', obs: 1, label, reached: false, source: c.source };
  S.suspects.push(sus);
  return { sus, isNew: true };
}

// A landmark goes on the map hanging off where I've had the closest look at it.
function noteSeenFrom(sus, from) {
  if (!sus.seenAt || Math.hypot(from.x - sus.est.x, from.y - sus.est.y) < Math.hypot(sus.seenAt.x - sus.est.x, sus.seenAt.y - sus.est.y)) sus.seenAt = { x: from.x, y: from.y };
}
// How far off (in cells, one standard deviation, roughly) a fix on something is: a fraction of its
// distance, bigger for sounds than sightings (geo.js suspicionFrom), biggest for smells.
const FIX_ERR = { sight: 0.2, sound: 0.45, smell: 0.6 };
const fixErr = (channel, distM) => Math.max(0.5, FIX_ERR[channel] * distM / CELL);
// Data association: is this cue one I already suspect? If not, a new named suspect. A new fix is
// blended with the old one by how sure each is (inverse-variance weighting, as in a Kalman update),
// so a glimpse from far off doesn't spoil a good look from close by. A thing I'd lost track of takes
// the new fix outright.
function associate(c, from) {
  const g = suspicionFrom(c, from, S.rng);
  const kindGroup = isWaterKind(c.kind) ? 'water' : c.kind;
  // the same thing again: the same feature, or (not knowing which feature it is) the same kind of thing near where I placed it; a river's
  // line of trees isn't the cascade on it
  let sus = S.suspects.find(u => u.trueKey === c.key) ?? S.suspects.find(u => u.group === kindGroup && LANDMARK_NOUN[u.kind] === LANDMARK_NOUN[c.kind] && Math.hypot(u.est.x - g.est.x, u.est.y - g.est.y) * CELL < Math.max(700, 0.35 * g.dist));
  if (sus) {
    const e = fixErr(c.channel, g.dist), old = sus.lost ? Infinity : sus.err ?? e, w = old === Infinity ? 1 : old ** 2 / (old ** 2 + e ** 2);
    sus.est = { x: Math.round(sus.est.x * (1 - w) + g.est.x * w), y: Math.round(sus.est.y * (1 - w) + g.est.y * w) };
    sus.err = old === Infinity ? e : Math.sqrt(old ** 2 * e ** 2 / (old ** 2 + e ** 2));
    sus.lost = false;
    sus.obs++;
    noteSeenFrom(sus, from);
    if (c.channel === 'sight' && (c.kind === 'cliff' || c.kind === 'lake')) { revealFeature(c.key, from, senseEye); noteSeenFeatures(); }
    return { sus, isNew: false, g };
  }
  const named = isWaterKind(c.kind) && c.kind !== 'river trace';
  // running water heard: a stream I know near where the sound seems to be, or a new one
  const heardSize = { brook: 1, stream: 2, river: 3, rapids: 3 }[c.kind];
  const err = fixErr(c.channel, g.dist);
  const knownStream = heardSize ? S.streams.find(st => st.size === heardSize && st.fixes.some(f => Math.hypot(f.x - g.est.x, f.y - g.est.y) <= Math.max(4, 1.5 * err))) : null;
  const known = named && (heardSize ? !!knownStream : S.waterNames[waterKeyOf(c.key)]);
  S.lastTag = null;
  const heard = heardSize ? knownStream ?? newStream(heardSize, g.est) : null;
  const label = heard ? heard.name : named ? waterName(waterKeyOf(c.key), c.kind, g.est) : S.cliffNames?.[c.key] ?? uniqueName(LANDMARK_NOUN[c.kind] ?? c.kind);
  // another of a kind I named here or at the last place: say how this one differs
  const noun = named ? label.split(' ').pop() : LANDMARK_NOUN[c.kind] ?? c.kind, recent = (S.mem.trail ?? []).slice(-2);
  let another = null;
  if (!known && S.lastTag && (S.landNamed?.[noun] ?? []).some(x => recent.includes(x.site) && x.label !== label)) {
    const t = S.lastTag, how = t.why === 'visual' ? `is ${t.tag}` : t.why === 'notice' ? `is near where I saw the ${t.tag}` : t.why === 'dir' ? `lies further ${t.tag}` : 'is a different one';
    another = `another ${noun}; this one ${how}. I’ll call this one ${label}`;
  }
  if (!known) ((S.landNamed ??= {})[noun] ??= []).push({ site: site()?.key, label });
  sus = { id: `u${S.suspects.length + 1}`, kind: c.kind, group: kindGroup, trueKey: c.key, truePos: { x: c.x, y: c.y }, est: g.est, err, stream: heard?.id, seenAt: { x: from.x, y: from.y }, channel: c.channel, obs: 1, label, reached: false, another };
  S.suspects.push(sus);
  if (heard && !heard.fixes.length && !heard.sus) heard.sus = sus.id;
  if (c.channel === 'sight' && (c.kind === 'cliff' || c.kind === 'lake')) { revealFeature(c.key, from, senseEye); noteSeenFeatures(); }
  return { sus, isNew: true, g };
}
let senseEye = 1.7; // eye height of the look in progress (higher from a lookout), for revealing what's seen
// What the light, the air and the noise are taking from a deliberate look and listen, if anything.
function senseLimits(close = false) {
  const k = skyNow(), w = windAt(S.world, S.day, S.t), out = [];
  if (close) { const n = nearLight(); if (n < 0.5) out.push(n < 0.15 ? 'Too dark to make out anything close by.' : 'The light’s too poor to see much detail.'); }
  else if (seeingFar(k.lux) < 0.5) out.push(k.sunAlt < -6 ? 'Too dark to see far; only the skyline shows.' : 'The light’s going; distant things are hard to make out.');
  else if (k.visibility < 3000) out.push({ fog: 'The fog hides everything past a stone’s throw.', blizzard: 'Driving snow hides everything.', storm: 'Rain like a curtain: I can’t see far.', snow: 'Falling snow blurs the distance.', rain: 'The rain blurs the distance.' }[k.weather] ?? 'Hard to see far.');
  if (!close && k.hearing < 0.8) out.push({ rain: 'Rain on the leaves drowns out distant sounds.', storm: 'The storm drowns out everything else.', blizzard: 'The wind and snow drown out everything else.' }[k.weather] ?? 'Hard to hear much.');
  else if (!close && w.strength > 0.75) out.push('The wind in the trees drowns out distant sounds.');
  return out.join(' ');
}
function sense(s, lookout = false, { scan = false, focus = null } = {}) {
  senseEye = lookout ? lookoutEye(S.L, s) : 1.7;
  if (scan || lookout) { const lim = senseLimits(); if (lim) log(lim, 'thought'); }
  let all = perceive(S.L, s, { time: timeOfDay(), sky: skyView(), lookout, boost: scan ? 1.6 : focus === 'water' ? 1.4 : 1 });
  if (focus) all = all.filter(c => isWaterKind(c.kind) || (focus === 'lookout' && ['hill', 'cliff'].includes(c.kind)));
  // from the ground, only the most salient few new things register (water first)
  const cues = lookout || scan ? all : [...all].sort((a, b) => (isWaterKind(b.kind) - isWaterKind(a.kind)) || (b.strength - a.strength)).filter((c, i) => isWaterKind(c.kind) || i < 3);
  const before = new Set(S.suspects); // "noted before" means before this look, not earlier in it
  const found = { heard: [], seen: [], land: [], upgraded: [] }, stillSeen = new Set();
  for (const c of cues) {
    if (c.kind === 'brook' && c.trueDist > 100) continue;
    const { sus, isNew, g } = associate(c, s);
    if (!isNew) {
      if (c.channel === 'sight' && sus.channel === 'sound') { sus.channel = 'sight'; found.upgraded.push(`${cuePhrase(c, g, s)} (${sus.label})`); }
      else if (before.has(sus)) stillSeen.add(sus);
      continue;
    }
    (sus.group !== 'water' ? found.land : c.channel === 'sound' ? found.heard : found.seen).push(`${cuePhrase(c, g, s)} (${sus.another ?? sus.label})`);
  }
  const smelled = [];
  if (!lookout && (!focus || focus === 'water')) for (const c of smellAt(smellsToday(), s, windNow(), S.rng)) {
    const { sus, isNew } = associateSmell(c, s);
    if (isNew || scan) smelled.push(`${c.words} (${sus.label}${isNew ? '' : ', again'})`);
  }
  const report = [];
  if (found.heard.length) report.push(`Water I can hear: ${found.heard.join('; ')}.`);
  if (found.seen.length) report.push(`Water I can see: ${found.seen.join('; ')}.`);
  if (found.upgraded.length) report.push(`I can see it now: ${found.upgraded.join('; ')}.`);
  if (found.land.length) report.push(`Landmarks: ${found.land.join('; ')}.`);
  if (smelled.length) report.push(`On the wind from the ${bearingWord(windNow().from)}: ${smelled.join('; ')}.`);
  if (scan || lookout) {
    // where I now believe each one is, after combining this look with earlier ones
    if (stillSeen.size) report.push(`Still there: ${[...stillSeen].map(u => `${u.label} (${bearingWord(bearing(s, u.est))})`).join('; ')}.`);
    if (scan) {
      const cond = condNow(s); // who's calling depends on the season and the weather; a call of the season is a sound of its own
      const calls = S.world.animals.filter(a => a.signs?.call && a.cls !== 'invertebrate').map(a => ({ a, now: animalNow(a, cond) })).filter(({ a, now }) => now.here && S.rng.chance(clamp(a.perKm2 / 15 * now.calls * cond.hearing) * (timeOfDay() === 'day' ? 0.5 : 1))).slice(0, 3)
        .map(({ a, now }) => { const call = now.callNow(S.rng), sig = S.mem.signs?.[`call:${call}`]; const who = sig?.linked ? ` (${entity(sig.linked)?.name ?? 'something'})` : ''; return `${call}${who} to the ${COMPASS_RANDOM()}, ${a.cls === 'large' ? 'some way off' : 'close'}`; });
      if (calls.length) report.push(`Calls: ${calls.join('; ')}.`);
      log(report.length ? `Scanning and listening:\n${report.join('\n')}` : 'Scanned and listened for half an hour. Nothing beyond the immediate.', 'survey');
    } else log(report.length ? `From up here:\n${report.join('\n')}` : 'From up here I can see a long way, but nothing I haven’t already noted.', 'survey');
  } else if (report.length) log(report.join(' '), 'note');
}

// ------------------------------------------------------------ travel

function arrive(x, y, how, onTheWay = null) {
  const s = newSite(x, y);
  markSeen(x, y, 20, { eye: 1.7 });
  noticeCrossings([{ x, y }]);
  if (S.L.chan[cellOf(x, y)]) addFix({ x, y }, 'stood', S.travelHint);
  noteSeenFeatures();
  noteTrail(S.mem, s.key);
  S.at = S.sites.indexOf(s);
  if (how) log(how); // the walk first, then what it found
  { const w = waterAt(S.L, groundNow(), cellOf(x, y)); // the water here today
    if (w?.dry) log(`The ${SIZE_NOUN[w.size]} is dry here: a bed of stones and sand, no water.`, 'note');
    else if (w?.frozen) log(`The ${SIZE_NOUN[w.size]} is frozen over; water moves under the ice.`, 'note');
    else if (w?.flood) log(`The ${SIZE_NOUN[w.size]} is in spate: brown, fast and loud, well up its banks.`, 'note'); }
  const fresh = S.sites[S.sites.length - 1] === s && s.visits === 0;
  for (const u of S.suspects) if (!u.reached && atTarget({ x, y }, { truePos: u.truePos, sus: u })) {
    u.reached = true;
    s.landmark ??= u.label;
    if (fresh && s.name !== 'where I woke' && !waterMark(s) && placeNameFor(u)) s.name = placeNameFor(u); // the place takes the landmark's name; a mouth, spring or the like keeps its own
    log(`Found ${u.label}.`, 'act');
    if (u.kind === 'carcass') {
      const a = entity(u.source?.animal), fresh = u.source?.epoch === Math.floor((S.day - 1) / 4);
      const what = a && S.mem.entities[memKeyE(a)] ? `a dead ${a.name}` : 'a dead animal, something big';
      log(fresh ? `It was ${what}, a few days gone: torn open by scavengers, flies everywhere. Bones lie about.` : `It was ${what}, long dead; only scattered bones now and a faint smell.`, 'note');
      s.bones ??= { fine: 0, big: 0 }; s.bones.big = Math.min(3, s.bones.big + 2);
    } else if (u.kind === 'sulfur') log('A spring that reeks of sulfur; the water tastes of rotten eggs.', 'note');
    else if (u.kind === 'musk') log('A burrow under a root, reeking of musk. Whatever lives here, I’ll leave it be.', 'note');
  }
  if (onTheWay) onTheWay();
  if (lakeside(s)) { // on a shore: all the water in view from the water's edge goes on the map
    const keys = new Set(NB8.map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy })).filter(q => q.x >= 0 && q.y >= 0 && q.x < GN && q.y < GN && S.L.lake[cellOf(q.x, q.y)]).map(q => waterKeyAt(S.L, q.x, q.y)));
    for (const k of keys) revealFeature(k, s, 1.7, true);
    noteSeenFeatures();
  }
  if (waterHere(s) || S.crossedWater) { S.crossedWater = false; waterFound(); }
  if (!waterHere(s)) { // water within about 200 m gets noticed and marked
    let best = null;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x2 = x + dx, y2 = y + dy;
      if (x2 < 0 || y2 < 0 || x2 >= GN || y2 >= GN) continue;
      const c = cellOf(x2, y2);
      if ((S.L.chan[c] || S.L.lake[c]) && (!best || Math.hypot(dx, dy) < best.d)) best = { x: x2, y: y2, d: Math.hypot(dx, dy), lake: S.L.lake[c] };
    }
    if (best) {
      let wx = best.x, wy = best.y;
      if (best.lake) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = best.x + dx, b = best.y + dy; if (a >= 0 && b >= 0 && a < GN && b < GN && !S.L.lake[cellOf(a, b)]) { wx = a; wy = b; break; } }
      let wname, news;
      if (best.lake) { // seen from here; no place made on a shore I haven't stood on
        const key = waterKeyAt(S.L, best.x, best.y), c = cellOf(best.x, best.y);
        wname = waterName(key, 'lake', best);
        news = (S.seenLand?.[c] ?? 0) < SEEN;
        revealFeature(key, s, 1.7);
        noteSeenFeatures();
      } else ({ st: { name: wname }, isNew: news } = addFix(best, 'near'));
      const dryBed = !best.lake && waterAt(S.L, groundNow(), cellOf(best.x, best.y)).dry;
      if (dryBed) { if (news) log(`A dry stream bed just to the ${bearingWord(bearing(s, best))}, ${timeWords(best.d * CELL / 3000)} away: ${wname}, though no water in it now. Marked it.`, 'note'); }
      else {
      const first = !S.milestones.water;
      if (news || first) log(`${first ? 'Water! ' : ''}${best.lake ? 'A lake' : 'A watercourse'} just to the ${bearingWord(bearing(s, best))}, ${timeWords(best.d * CELL / 3000)} away: ${wname}. Marked it.`, first ? 'act' : 'note');
      for (const u of S.suspects) if (!u.reached && u.group === 'water' && Math.hypot(u.truePos.x - best.x, u.truePos.y - best.y) <= 4) u.reached = true;
      waterFound();
      }
    }
  }
  if (S.looking) {
    S.body.focus = clamp(S.body.focus - 0.03);
    lookHere(s);
    breakthroughs(s, S.looking.key);
    if (S.looking.type !== 'distant') sense(s, false, { focus: 'water' });
  } else {
    look(s, 0.4);
    sense(s);
  }
  // Something first noticed just now (heard on arrival, say) that I'm already standing at isn't a
  // landmark to head for: it's here.
  for (const u of S.suspects) if (!u.reached && atTarget({ x, y }, { truePos: u.truePos, sus: u })) u.reached = true;
  nameSegments();
}

// The first water of the game, however it is met: arriving at it, crossing it, or spotting it nearby.
function waterFound() {
  if (S.milestones.water) return false;
  S.milestones.water = true;
  log('Found water.', 'milestone');
  return true;
}

// Landmarks seen close by on the way get added to the map, even when only passed.
function notePassing(path) {
  const passed = [];
  for (let i = 6; i < path.length; i += 6) {
    for (const c of perceive(S.L, path[i], { time: timeOfDay(), sky: skyView() })) {
      if (c.channel !== 'sight' || !['hill', 'cliff', 'lake'].includes(c.kind) || c.trueDist > 900) continue;
      const { sus, isNew } = associate(c, path[i]);
      if (isNew) passed.push(`${sus.label} (${bearingWord(bearing(path[i], sus.est))})`);
    }
  }
  if (passed.length) log(`On the way I passed ${passed.join(', ')}.`, 'note');
}
// Every stream crossed on a walk is a fix on a stream I know (or a new one), named by it; the crossing
// is remembered on the leg. `hint`: the stream I was heading for, if the walk ended in it.
function noteCrossings(trip, hint = null) {
  const names = [], keys = [], ids = [];
  let wetCrossing = false;
  trip.crossings.forEach((c, i) => {
    if (!waterKeyAt(S.L, c.x, c.y)) return ids.push(null);
    const end = i === trip.crossings.length - 1 && c.x === trip.end.x && c.y === trip.end.y;
    const { st } = addFix(c, 'crossed', end ? hint : null); // a dry bed is still the stream, on the map
    ids.push(st.id);
    const cc = cellOf(c.x, c.y), how = S.L.dyn ? S.L.dyn.cross(cc).how : null, name = waterNameAt(st, c.x, c.y), w = waterAt(S.L, groundNow(), cc);
    if (how !== 'dry') wetCrossing = true;
    if (!keys.includes(st.id)) { keys.push(st.id); names.push(how === 'dry' ? `the dry bed of ${name}` : how === 'ice' ? `${name} on the ice` : how === 'deadfall' ? `${name} on a fallen log` : how === 'rockfall' ? `${name} on the boulders` : how === 'ford' ? `${name} at the ford` : w?.depth > 0.6 ? `${name}, ${w.flood ? 'in spate, ' : ''}waist-deep` : w?.flood ? `${name}, running high` : name); }
  });
  if (wetCrossing) S.crossedWater = true; // the milestone is logged on arrival, after the walk's own line
  return { names, keys, ids };
}
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
function rememberLeg(fromKey, toKey, hours, keys) {
  if (fromKey === toKey) return;
  const k = edgeKey(fromKey, toKey), old = S.walked[k];
  S.walked[k] = { hours: old ? 0.5 * (old.hours + hours) : hours, crossings: [...new Set([...(old?.crossings ?? []), ...keys])] };
}
// A walk is remembered as legs between the places it passed: a place I already knew whose cell the
// path goes through splits the walk there, so trails run through the places they really go by. Each
// leg's share of the time is its share of the walk's estimated time.
const PASS_R = 0;
function rememberTrip(from, path, hours, crossings, knownBefore) {
  const end = site(), stops = [{ i: 0, s: from }];
  for (const t of S.sites.slice(0, knownBefore)) {
    if (t === from || t === end) continue;
    let bi = -1, bd = Infinity;
    for (let i = 1; i < path.length - 1; i++) { const d = Math.hypot(path[i].x - t.x, path[i].y - t.y); if (d < bd) { bd = d; bi = i; } }
    if (bd <= PASS_R) stops.push({ i: bi, s: t });
  }
  stops.sort((a, b) => a.i - b.i);
  stops.push({ i: path.length - 1, s: end });
  const est = stops.slice(1).map((b, k) => { let h = 0; for (let i = stops[k].i + 1; i <= b.i; i++) h += stepHours(S.L, path[i - 1], path[i]); return h; });
  const total = est.reduce((x, y) => x + y, 0);
  const at = crossings.map(c => ({ i: path.findIndex(p => p.x === c.x && p.y === c.y), key: c.id })).filter(c => c.key); // c.id: the stream I took it for
  stops.slice(1).forEach((b, k) => {
    const a = stops[k];
    const keys = [...new Set(at.filter(c => c.i > a.i && c.i <= b.i).map(c => c.key))];
    rememberLeg(a.s.key, b.s.key, Math.max(0.02, total ? hours * est[k] / total : hours / est.length), keys);
  });
}

// Where a target really is, where I think it is, and what to call it.
function targetInfo(target) {
  const sus = S.suspects.find(u => u.id === target.suspect);
  const dest = target.site !== undefined ? S.sites[target.site] : null;
  const st = target.stream ? streamById(target.stream) : null, area = target.lake || target.cliff;
  return { sus, dest, st, area, truePos: sus?.truePos ?? dest ?? (st || area || target.point ? { x: target.x, y: target.y } : null), name: sus?.label ?? dest?.name ?? st?.name ?? target.label ?? 'there' };
}
// Standing in it: on a stream or river of it, or on the shore of a lake of it (where I can drink).
function onWater(p, want) {
  if (S.L.chan[cellOf(p.x, p.y)] && waterKeyAt(S.L, p.x, p.y) === want) return true;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = p.x + dx, y = p.y + dy; if (x >= 0 && y >= 0 && x < GN && y < GN && S.L.lake[cellOf(x, y)] && waterKeyAt(S.L, x, y) === want) return true; }
  return false;
}
// Am I at it? On its own cell; for a stream or river, on any cell of it; for a lake, on its shore.
function atTarget(p, info) {
  if (!info.truePos) return false;
  if (p.x === info.truePos.x && p.y === info.truePos.y) return true;
  const u = info.sus;
  if (u?.group === 'water' && /^(lake|river|brook)-/.test(waterKeyOf(u.trueKey))) return onWater(p, waterKeyOf(u.trueKey));
  return false;
}
// Didn't get there: say so, with a revised direction and walking time.
function missedTarget(target, from) {
  const { sus, name } = targetInfo(target), here = site();
  let est = { x: target.x, y: target.y }, how;
  if (sus) {
    const c = perceive(S.L, here, { time: timeOfDay(), sky: skyView(), boost: 1.4 }).find(k => k.key === sus.trueKey);
    if (c) { const g = suspicionFrom(c, here, S.rng); sus.est = est = g.est; sus.err = fixErr(c.channel, g.dist); how = `I can still ${c.channel === 'sound' ? 'hear' : 'see'} it`; }
    else if ((here.x === sus.est.x && here.y === sus.est.y) || here === from) {
      // Here is where I thought it was (or as near as I can get: the walk ended where it began, at a
      // shore, say), and there's no sign of it. Guessing "further on" sends me chasing it in ever
      // smaller hops, sometimes the wrong way, so it comes off the map until I pick it up again.
      sus.lost = true;
      return log(`Didn’t reach ${name}. ${here === from && !(here.x === sus.est.x && here.y === sus.est.y) ? 'I can’t get any nearer this way, and there’s no sign of it' : 'No sign of it where I expected'}; I’ve lost track of it. A scan, or a view from higher up, might pick it up again.`, 'thought');
    } else { est = sus.est; how = 'by my reckoning'; }
  } else how = 'by my reckoning';
  if (Math.hypot(here.x - est.x, here.y - est.y) < 1) return;
  log(`Didn’t reach ${name}. ${cap(how)}: ${awayWords(lineHours(S.L, here, est), sus && sus.channel === 'sound' && sus.obs < 2 ? 'unknown' : 'guess')}, to the ${bearingWord(bearing(here, est))}.`, 'thought');
}

// Didn't find the stream where I'd drawn it: if I'm there and it's dry, the link I'd guessed is wrong.
function missedStream(target, st) {
  const here = site();
  if (Math.hypot(here.x - target.x, here.y - target.y) > 2 || !target.seg) return log(`Didn’t reach ${st.name}. By my reckoning it’s ${awayWords(lineHours(S.L, here, target), 'guess')}, to the ${bearingWord(bearing(here, target))}.`, 'thought');
  const [a, b] = target.seg;
  (S.streamGaps ??= new Set()).add(`${a.x},${a.y}>${b.x},${b.y}`);
  log(`No sign of ${st.name} here. It doesn’t run this way after all.`, 'thought');
}
// Head for a stream I know: straight for the nearest point of it as I've drawn it.
function headForStream(id) {
  const t = streamTrees().find(x => x.id === id), from = site();
  if (!t) return;
  const p = nearestOnStream(t, from);
  if (S.L.chan[cellOf(from.x, from.y)] && p.x === from.x && p.y === from.y) return log(`I’m at ${t.name} already.`, 'thought');
  travelTo({ x: p.x, y: p.y, stream: id, seg: p.seg }, `toward ${t.name}`);
}

// Where I can follow the stream I'm at: downstream, and up each branch that feeds this spot.
function followOptions() {
  const h = site();
  if (!S.L.chan[cellOf(h.x, h.y)] && !['streambank', 'streambed'].includes(h.micro)) return [];
  const at = S.L.chan[cellOf(h.x, h.y)] ? h : NB8.map(([dx, dy]) => ({ x: h.x + dx, y: h.y + dy })).find(q => q.x >= 0 && q.y >= 0 && q.x < GN && q.y < GN && S.L.chan[cellOf(q.x, q.y)] && !S.L.lake[cellOf(q.x, q.y)]);
  if (!at) return [];
  const st = S.streams.find(x => x.fixes.some(f => Math.hypot(f.x - at.x, f.y - at.y) <= 1.5)) ?? matchStream(makeFix(at));
  const nameOf = c => waterNameAt(st, c % GN, Math.floor(c / GN)); // the stretch that way: below me, or up a branch
  // offered only where a stage would get me to a new place (not straight into a lake, say)
  const goes = (dir, branch) => { const t = followStage(S.L, h, dir, { branch }); return t.hours > 0 && (t.end.x !== h.x || t.end.y !== h.y); };
  const out = [], down = flowAt(at.x, at.y);
  if (down != null && !isMouth(at.x, at.y) && goes('down')) out.push({ key: 'follow:down', dir: down, say: `Follow ${nameOf(S.L.down[cellOf(at.x, at.y)])} downstream (up to 15 min)` });
  const ins = inflowsAt(at.x, at.y);
  for (const b of ins) {
    if (!goes('up', b)) continue;
    let c = cellOf(b.x, b.y); // the way this branch comes from, over a few cells
    for (let n = 0; n < 3; n++) { const up = inflowsAt(c % GN, Math.floor(c / GN)).sort((p, q) => S.L.acc[cellOf(q.x, q.y)] - S.L.acc[cellOf(p.x, p.y)])[0]; if (!up) break; c = cellOf(up.x, up.y); }
    const dir = bearing(at, { x: c % GN, y: Math.floor(c / GN) });
    out.push({ key: `follow:up:${b.x}_${b.y}`, dir, say: `Follow ${nameOf(cellOf(b.x, b.y))} upstream${ins.length > 1 ? `, the branch from the ${bearingWord(dir)}` : ''} (up to 15 min)` });
  }
  return out;
}
const STOP_WORDS = { fork: 'to where streams join', lake: 'to where it runs into a lake', outlet: 'to where it leaves a lake', falls: 'to a waterfall', spring: 'to a spring, where it rises', source: 'until it gave out at its source', edge: 'as far as I dare go that way' };
// Follow the stream a stage: about a quarter of an hour, or less if something stops me. The stretch
// walked goes on the map as known (fixes every few cells, one run).
function followStream(dir, branch) {
  const from = site(), knownBefore = S.sites.length;
  const trip = followStage(S.L, from, dir, { branch });
  if (!trip.hours) return log(trip.why === 'lake' ? 'It runs straight into a lake here.' : trip.why === 'source' ? 'This is where it rises; there’s no further up.' : 'There’s no stream right here to follow.', 'warn');
  const spent = onTheMove(trip.path, trip.hours);
  pass(spent, 260);
  let st = null;
  const run = [];
  trip.path.forEach(p => { // every cell of the water I walk along: the line runs where the water does
    if (!S.L.chan[cellOf(p.x, p.y)] || S.L.lake[cellOf(p.x, p.y)]) return;
    const r = addFix(p, 'followed', null, st?.id ?? null);
    st = r.st;
    if (run[run.length - 1] !== r.fix) run.push(r.fix);
  });
  if (st && run.length > 1) { (st.runs ??= []).push(dir === 'down' ? run : run.reverse()); S.streamVer = (S.streamVer ?? 0) + 1; }
  trip.path.forEach((p, i) => { if (i % 2 === 0) markSeen(p.x, p.y, 3); });
  noticeCrossings(trip.path);
  const stop = STOP_WORDS[trip.why];
  S.travelHint = st?.id ?? null;
  const way = trip.path.find(p => (p.x !== from.x || p.y !== from.y) && S.L.chan[cellOf(p.x, p.y)]) ?? from; // the stretch I set off along, not the one I left (at a fork)
  const dryWay = waterAt(S.L, groundNow(), cellOf(way.x, way.y))?.dry;
  arrive(trip.end.x, trip.end.y, `Followed ${dryWay ? 'the dry bed of ' : ''}${waterNameAt(st, way.x, way.y)} ${dir === 'down' ? 'downstream' : 'upstream'} for ${timeWords(spent, 'known')}${stop ? `, ${stop}` : ''}.`);
  S.travelHint = null;
  rememberTrip(from, trip.path, trip.hours, [], knownBefore);
}

// ------------------------------------------------------------ getting hurt on the way
//
// Every walk risks an injury (injury.js): the expected number over the way is the hazard of each cell
// times the time spent on it, and at most one happens per walk, on a cell picked in proportion. Ground I
// have walked before is safer (S.trod: every cell I've walked through). A limp slows every walk until it
// heals (about a tenth of its severity a day, faster asleep). Returns the hours the walk really took.
const limpFactor = () => 1 + 1.5 * (S.body.limp ?? 0);
function onTheMove(path, hours) {
  S.trod ??= new Set();
  const k = skyNow(), g = groundNow(), body = { fatigue: S.body.fatigue, energy: S.body.energy, sick: S.body.sick, limp: S.body.limp ?? 0 };
  const parts = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const c = cellOf(path[i].x, path[i].y), hz = hazardFactors(S.L, c, { lux: k.lux, weather: k.weather, snowCm: snowCm(S.L, g, c), litter: litterAt(S.world, S.L, g, c) }, body, S.trod.has(c));
    const h = hz.rate * stepHours(S.L, path[i - 1], path[i]);
    total += h; parts.push([c, h, hz.factors]);
  }
  for (const p of path) S.trod.add(cellOf(p.x, p.y));
  let spent = hours * limpFactor();
  if (total > 0 && S.rng.chance(1 - Math.exp(-total))) {
    let u = S.rng.next() * total, at = parts[parts.length - 1];
    for (const p of parts) if ((u -= p[1]) <= 0) { at = p; break; }
    spent += hurt(injuryAt(S.L, at[0], S.rng), k, { why: injuryReasons(at[2]), c: at[0] });
  }
  return spent;
}
// why it happened, in the character's words: the biggest factors at the spot (injury.js)
function reasonWords(why, k, c) {
  const micro = S.L.micro[c];
  const say = {
    dark: k.sunAlt < -6 ? 'I can’t see in the dark' : 'the light was going', steep: 'the slope is steep',
    underfoot: { scree: 'the scree is loose', outcrop: 'the rock is broken', streambed: 'the stream bed is slippery', claybank: 'the clay is slick', deadfall: 'the deadfall is a tangle', pond: 'the marsh hides the footing' }[micro] ?? (S.L.chan[c] >= 3 ? 'the river stones are slick' : 'the footing is bad'),
    weather: { rain: 'everything is slick with rain', storm: 'the storm', snow: 'the falling snow', blizzard: 'the blizzard', fog: 'the fog' }[k.weather] ?? 'the weather',
    snow: 'the snow hides the footing', litter: 'the leaves hide the holes', tired: 'I’m too tired', hungry: 'I’m weak with hunger', sick: 'I’m ill',
    limp: 'my ankle was already bad', unfamiliar: 'I don’t know this ground', 'the current': 'the current',
  };
  const w = why.map(r => say[r] ?? r);
  return w.length ? ` Probably because ${w.join(' and ')}.` : '';
}
// Soaked: clothes and everything carried (a fall in the water, a stream that took me).
function soakMe(level = 1) {
  S.body.clothes.wet = Math.max(S.body.clothes.wet, level);
  for (const it of S.inv) if (it.props.moisture !== undefined && it.kind !== 'food') it.props.moisture = Math.min(0.6, it.props.moisture + 0.3 * level);
}
function hurt({ kind, sev }, k, ctx = {}) {
  const why = reasonWords(ctx.why ?? [], k, ctx.c ?? cellOf(site().x, site().y));
  if (kind === 'ankle') {
    S.body.limp = Math.max(S.body.limp ?? 0, sev);
    log(`${sev < 0.3 ? 'Turned my ankle; it twinges, but it’ll carry me.' : sev < 0.6 ? 'Went over on my ankle. It’s swelling; I’ll be slow for a few days.' : 'Badly twisted my ankle. I can barely put weight on it.'}${why}`, 'warn');
    return 0.1 + 0.3 * sev;
  }
  if (kind === 'fall') {
    S.body.hands = clamp(S.body.hands + 0.05 + 0.25 * sev); S.body.fatigue = clamp(S.body.fatigue + 0.1 + 0.2 * sev); S.body.focus = clamp(S.body.focus - 0.1);
    log(`Fell hard: ${sev < 0.4 ? 'scraped palms and a bruised knee' : 'skinned hands and a hip that will be black tomorrow'}.${why}`, 'warn');
    return 0.15;
  }
  if (kind === 'cut') {
    S.body.germs = clamp(S.body.germs + 0.2);
    S.body.wound = { at: now(), sev };
    if (S.rng.chance(0.25 + 0.5 * sev)) S.body.pendingSick.push({ at: now() + 30, severity: 0.15 + 0.35 * sev, text: 'The cut on my shin is hot, swollen and weeping: it’s gone bad.', wound: true });
    log(`A broken branch tore a gash in my shin.${why} I should wash it soon.`, 'warn');
    return 0.1;
  }
  // a slip into the water: soaked, and maybe a wrenched ankle too
  soakMe(0.8);
  S.body.fatigue = clamp(S.body.fatigue + 0.05);
  if (sev > 0.5) S.body.limp = Math.max(S.body.limp ?? 0, 0.4 * sev);
  log(`Slipped on a wet stone and went down in the water: soaked, everything I carry with me${sev > 0.5 ? ', and my ankle wrenched' : ''}.${why}`, 'warn');
  return 0.1;
}

// On a lake's shore: walk it a stage either way, keeping the water on my left or my right.
function shoreOptions() {
  const h = site();
  if (!lakeside(h)) return [];
  const lake = NB8.map(([dx, dy]) => ({ x: h.x + dx, y: h.y + dy })).find(q => q.x >= 0 && q.y >= 0 && q.x < GN && q.y < GN && S.L.lake[cellOf(q.x, q.y)]);
  const name = waterName(waterKeyAt(S.L, lake.x, lake.y), 'lake', lake);
  return ['left', 'right'].map(side => {
    const t = shoreStage(S.L, h, side);
    if (!t.hours || (t.end.x === h.x && t.end.y === h.y)) return null;
    const ahead = t.path[Math.min(3, t.path.length - 1)];
    return { key: `shore:${side}`, dir: bearing(h, ahead), say: `Walk the shore of ${name}, the water on my ${side} (up to 15 min)` };
  }).filter(Boolean);
}
const SHORE_STOPS = { mouth: 'to where a stream runs in', outlet: 'to where a stream leaves it', round: 'all the way round, back where I started', edge: 'as far as I dare go that way', blocked: 'as far as the shore goes this way' };
// Walk the shore a stage: every cell of shore on the way, the lake in view from each cell of it.
function walkShore(side) {
  const from = site(), knownBefore = S.sites.length;
  const trip = shoreStage(S.L, from, side);
  if (!trip.hours) return log('There’s no shore here to walk.', 'warn');
  const spent = onTheMove(trip.path, trip.hours);
  pass(spent, 240);
  const lake = trip.path.map(p => NB8.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).find(q => q.x >= 0 && q.y >= 0 && q.x < GN && q.y < GN && S.L.lake[cellOf(q.x, q.y)])).find(Boolean);
  const key = waterKeyAt(S.L, lake.x, lake.y);
  trip.path.forEach((p, i) => { markSeen(p.x, p.y, 3); if (i % 2 === 0 || i === trip.path.length - 1) revealFeature(key, p, 1.7, true); });
  noteSeenFeatures();
  noticeCrossings(trip.path);
  const stop = SHORE_STOPS[trip.why];
  arrive(trip.end.x, trip.end.y, `Walked the shore of ${waterName(key, 'lake', lake)} for ${timeWords(spent, 'known')}${stop ? `, ${stop}` : ''}.`);
  rememberTrip(from, trip.path, trip.hours, [], knownBefore);
}

// Head straight for something: a suspected landmark, a known place, or any spot I pick on the map.
function travelTo(target, label) {
  const from = site();
  if (target.suspect && target.x === from.x && target.y === from.y) {
    // It should be right here, on this very cell: look instead of walking.
    const info = targetInfo(target);
    pass(0.1, 120);
    if (atTarget(from, info)) { info.sus.reached = true; return log(`Found ${info.sus.label}, right here.`, 'act'); }
    // listening hard on the spot, it's just next door after all (close by, that's exact): one step over
    const c = perceive(S.L, from, { time: timeOfDay(), sky: skyView(), boost: 1.4 }).find(k => k.key === info.sus.trueKey), g = c && suspicionFrom(c, from, S.rng);
    if (g && (g.est.x !== from.x || g.est.y !== from.y)) { info.sus.est = g.est; return travelTo({ ...g.est, suspect: info.sus.id }, label); }
    return missedTarget(target, from);
  }
  const thirsty = S.body.hyd < 0.55 && !waterHere(from); // standing at water, thirst is no reason to stop at the next
  let n = 0;
  const { sus, dest, st, area, truePos } = targetInfo(target);
  // Homing: every few steps (or when asked outright) a fresh fix on the target, if I can still see or hear it.
  const resense = sus ? (p, force) => { if (++n % 3 && !force) return null; const c = perceive(S.L, p, { time: timeOfDay(), sky: skyView(), boost: force ? 1.4 : 1 }).find(k => k.key === sus.trueKey); return c ? suspicionFrom(c, p, S.rng).est : null; } : null; // at the spot I stop and listen hard
  const want = sus?.group === 'water' ? waterKeyOf(sus.trueKey) : null;
  const arrived = sus ? p => (want && /^(lake|river|brook)-/.test(want) ? onWater(p, want) : atTarget(p, { truePos, sus }))
    : st ? p => !!S.L.chan[cellOf(p.x, p.y)] && (Math.hypot(p.x - target.x, p.y - target.y) <= 3 || matchStream(makeFix(p)) === st)
    : target.lake ? p => onWater(p, target.lake)
    : target.cliff ? p => { const esc = cliffIndex(), i = +target.cliff.slice(6); return NB8.some(([dx, dy]) => esc[cellOf(clamp(p.x + dx, 0, GN - 1), clamp(p.y + dy, 0, GN - 1))] === i); } : null;
  if (arrived && arrived(from)) return log(`I’m ${target.lake ? 'on the shore of' : 'at'} ${targetInfo(target).name} already.`, 'thought');
  // How long I expect it to take, going round what I know is in the way; a walk taking twice that stops.
  const predicted = mapHours(from, sus ? sus.id : dest ? dest.key : target.point ? 'point' : `stream:${target.stream ?? area}`, target);
  const budget = Number.isFinite(predicted) ? Math.min(3, Math.max(0.25, 2 * predicted)) : 3;
  const toWater = !!target.lake || (sus?.group === 'water' && /^lake-/.test(waterKeyOf(sus.trueKey)));
  const trip = walk(S.L, from, target, { rng: S.rng, maxHours: budget, resense, arrived, stopAtWater: thirsty, driftSd: dest ? 1.5 : 2.5, toWater });
  S.lastTrip = trip; // for looking into later: how likely each step was
  const knownBefore = S.sites.length;
  const hours = onTheMove(trip.path, trip.hours * (S.looking ? 1.25 : 1)); // looking as I go slows me down; a limp too
  if (S.looking) S.body.focus = clamp(S.body.focus - 0.05);
  pass(hours, 300);
  for (const sw of trip.sweeps ?? []) { // the current took me
    const m = Math.round(Math.hypot(sw.to.x - sw.from.x, sw.to.y - sw.from.y) * CELL / 10) * 10;
    log(`Mid-stream the current knocked my feet from under me and carried me ${m} m downstream before I could claw my way out. Soaked through, everything I carry with me.`, 'warn');
    soakMe(1);
    S.body.fatigue = clamp(S.body.fatigue + 0.15);
    if (S.rng.chance(0.4)) { const c = cellOf(sw.to.x, sw.to.y); pass(hurt({ kind: S.rng.chance(0.5) ? 'fall' : 'ankle', sev: clamp(S.rng.logNormal(0.3, 0.5), 0.05, 0.9) }, skyNow(), { why: ['the current'], c }), 100); }
  }
  const reached = st || area ? arrived(trip.end) : atTarget(trip.end, targetInfo(target));
  S.travelHint = reached ? st?.id ?? sus?.stream ?? null : null; // the stream I was after, only if this is it
  const { names, keys, ids } = noteCrossings(trip, S.travelHint);
  noticeCrossings(trip.path);
  const dur = timeWords(hours, 'known');
  const last = trip.crossings[trip.crossings.length - 1], endsOnWater = !!last && trip.end.x === last.x && trip.end.y === last.y;
  const stoppedAtWater = thirsty && endsOnWater;
  const before = new Set(ids.slice(0, endsOnWater ? -1 : undefined));
  const crossed = names.filter((_, i) => before.has(keys[i])); // water I ended up in wasn't crossed
  const where = S.L.veg[cellOf(trip.end.x, trip.end.y)] > 0.55 ? 'thick woodland' : S.L.veg[cellOf(trip.end.x, trip.end.y)] > 0.3 ? 'scrubby woodland' : 'open ground';
  const text = `${S.looking ? 'Walked, watching for ' + S.looking.label + ',' : 'Pushed'} ${label} for ${dur}, through ${where}${crossed.length ? `; crossed ${crossed.join(' and ')}` : ''}.${stoppedAtWater ? ' Parched, I stopped at the water.' : ''}${hours >= 2.9 && !stoppedAtWater && budget >= 3 ? ' Stopped to get my bearings.' : ''}`;
  arrive(trip.end.x, trip.end.y, text, () => { notePassing(trip.path); lookAlong(trip.path); });
  S.travelHint = null;
  rememberTrip(from, trip.path, hours, trip.crossings.map((c, i) => ({ ...c, id: ids[i] })), knownBefore);
  trip.path.forEach((p, i) => { if (i % 2 === 0) markSeen(p.x, p.y, 3); });
  noteSeenFeatures();
  const cutShort = !reached && budget < 3 && trip.hours >= budget - 1e-6;
  if (cutShort) log(explainTrip(S.L, trip.path, predicted, hours, { believedDist: distM(from, target), trueDist: distM(from, truePos), idx: cellOf, CELL, soFar: true }) ?? `This is taking much longer than I expected (${timeWords(hours, 'known')} so far). I stopped to rethink.`, 'thought');
  if (!reached && st) missedStream(target, st);
  else if (!reached && target.point && S.L.lake[cellOf(target.x, target.y)]) log('That spot is in the water; this is as near as I can get.', 'thought');
  else if (!reached && area) log(`Didn’t reach ${target.label}. By my reckoning it’s ${awayWords(lineHours(S.L, site(), target), 'guess')}, to the ${bearingWord(bearing(site(), target))}.`, 'thought');
  else if (!reached) missedTarget(target, from);
  else if (predicted) {
    const why = explainTrip(S.L, trip.path, predicted, hours, { believedDist: distM(from, target), trueDist: distM(from, truePos), idx: cellOf, CELL });
    if (why) log(why, 'thought');
  }
}


// water to drink at a cell: a lake, or a stream that isn't a dry bed today (under ice, I can break through)
const wetCell = c => !!S.L.lake[c] || (!!S.L.chan[c] && !waterAt(S.L, groundNow(), c).dry);
function waterHere(s) {
  const c = cellOf(s.x, s.y);
  if (wetCell(c) || s.micro === 'spring') return true;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = s.x + dx, y = s.y + dy; if (x >= 0 && y >= 0 && x < GN && y < GN && wetCell(cellOf(x, y))) return true; }
  return false;
}
function waterSource(s) {
  const c = cellOf(s.x, s.y);
  const lakeNear = [-1, 0, 1].some(dy => [-1, 0, 1].some(dx => { const x = s.x + dx, y = s.y + dy; return x >= 0 && y >= 0 && x < GN && y < GN && S.L.lake[cellOf(x, y)]; }));
  const by = m => S.world.water.find(w => w.micro === m);
  if (s.micro === 'spring') return by('spring') ?? { name: 'spring water', hidden: { pathogen: 0.06 } };
  if (S.L.chan[c] || !lakeNear) return by('streambank') ?? { name: 'stream water', hidden: { pathogen: 0.25 } };
  return by('pond') ?? { name: 'lake water', hidden: { pathogen: 0.5 } };
}

function look(s, skill) {
  const time = timeOfDay();
  const before = new Set(Object.keys(S.mem.entities));
  const out = observeSite(S.world, S.mem, { site: s.key, micro: s.micro, skill, time, cond: condNow(s) });
  for (const id of out.noticed) s.known.add(id);
  const fresh = Object.keys(S.mem.entities).filter(k => !before.has(k)).map(entity).filter(e => e && ((e.kind === 'animal' && e.cls !== 'invertebrate') || ['tree', 'shrub'].includes(e.form))).pop(); // memorable things only
  if (fresh) S.recentNotice = fresh.name;
  s.visits++;
  log(out.text, 'note');
}

// ------------------------------------------------------------ time, needs, body

// ------------------------------------------------------------ processes
//
// Every process (acts.js) names the state it reads and may change, by namespace. Here are the
// namespaces, bound to the game's state; 'here' is worked out from the place, the sky and the ground.
const HERE = {
  water: () => (waterHere(site()) ? (w => ({ name: w.name, pathogen: w.hidden?.pathogen ?? 0.2 }))(waterSource(site())) : null),
  fire: () => fireHere(),
  dark: () => isNight(),
  shelter: () => shelterHere(site(), groundNow()),
  wind: () => windAt(S.world, S.day, S.t),
  ambient: () => ambient(),
  waterTempC: () => ({ running: waterTempC(false), still: waterTempC(true) }),
  cond: () => condNow(),
  factors: () => siteFactors(S.world.seed, site().key, S.world.environment.microhabitats.find(x => x.id === site().micro)),
  marsh: () => smellsToday().some(x => x.kind === 'marsh' && Math.hypot(x.x - site().x, x.y - site().y) < 15),
  seeing: () => senseLimits(true) || null,
};
// Beyond these, any path names the game's own state by its key (sites, suspects, streams, day, t, ...).
const stateFor = (binding = {}) => stateOver({
  site: site, sky: skyNow, ground: groundNow, clock: () => ({ day: S.day, t: S.t, now: now() }), ...binding,
}, { here: HERE }, S);
let placeDice = null; // while the range of an action is worked out: the place's dice for that run (spread.js)
const realPlace = key => makeRng(`${S.world.seed}/${key}`);
const dice = () => ({ act: S.rng, place: placeDice ?? realPlace });
// State that is no process's business: the generated world and land, caches and version counters for
// redrawing, what the screen shows, the record of play. Processes reach these straight through.
const LIVE = new Set(['world', 'L', 'seed', 'preset', 'mats', 'ambient', '_sky', '_smells', '_smellDay', 'landMemo', 'routeMemo', 'pieceMemo', 'linkMemo', 'lakeMemo', 'segMemo',
  'seenVer', 'streamVer', 'namedVer', 'mapRoutes', 'mapView', 'mapPin', 'mapLand', 'showProps', 'record', 'lastTag', 'lastAct', 'lastTrip', 'spreadShown', 'goal', 'revealed']);
// (The memos above hold numbers, keyed by what they were worked out from, so they can be shared.) A memo
// holding the state's own things (the stream trees hold its fixes) is the process's own while it runs,
// starting empty, so nothing from its copy is kept; its key tells the game's when it's out of date.
const MEMOS = new Set(['treeMemo']);
// A process whose run needs the game's own helpers (the mental map, streams, perception, the journal):
// while it runs, the game's state is its view, so the helpers read and change the copy, within its
// contract. Its run must look everything up afresh (site(), not a place captured beforehand).
const hosted = fn => Object.assign((v, d) => { const real = S; S = v; try { return fn(v, d) ?? {}; } finally { S = real; } }, { hosted: true });
// Do a process: check it can be done, let its time pass (as of when it's done, the state it reads),
// run it on a copy of what it reads, put back what it changed, take what it used up, add what it made,
// and say what it has to say. The last one done is kept (S.lastAct) for looking into.
let depth = 0;
function perform(proc, binding = {}, { quiet = false, refusal = false } = {}) {
  let v = viewFor(proc, stateFor(binding));
  const ok = readyFor(proc, v);
  if (ok !== true) { if (refusal) return { refused: ok }; log(ok, 'warn'); return null; }
  const hours = hoursOf(proc, v);
  if (hours > 0) { pass(hours, kcalOf(proc, v)); v = viewFor(proc, stateFor(binding)); }
  const real = S, d = dice(), memo = {};
  const live = { has: k => k === 'rng' || LIVE.has(k) || MEMOS.has(k), get: k => (k === 'rng' ? d.act : MEMOS.has(k) ? memo[k] : real[k]), set: (k, x) => { if (MEMOS.has(k)) memo[k] = x; else real[k] = x; } };
  const actAt = !depth && !quiet ? d.act.copy() : null; // the dice as they stood, so the range can hold them
  depth++;
  let fx;
  try { fx = rehearse(proc, v, d, { live }); } catch (e) { if (/without declaring/.test(e.message) && !depth) console.error(`contract: ${e.message}`); throw e; } finally { depth--; }
  apply(fx, stateFor(binding));
  for (const it of fx.use) remove(S.inv.find(i => i.uid === it.uid));
  fx.made = fx.make.map(m => addItem(m.name, m.kind, m.props, m.from, m.extra));
  if (!quiet) for (const [text, kind] of fx.say) log(text, kind);
  if (!quiet && !depth && !TICKS.includes(proc)) S.lastAct = { id: proc.id, proc, binding: Object.keys(binding), view: v, fx, actAt, trip: proc === GAME.hike ? S.lastTrip : null };
  return fx;
}

// ------------------------------------------------------------ the range of what could have happened
//
// The last action, run again on the very view it ran on, with other dice (spread.js): this attempt's
// luck ('act'), the place's ('place'), or both. Whatever a run writes to live state (caches, the screen,
// the last action) goes to a scratch copy, so looking changes nothing in the game; the place's dice
// reach the game's own helpers through placeDice. A walk's steps get their own odds (walkOdds, geo.js).
function liveForSpread(d) {
  const real = S, scratch = {};
  return { has: k => k === 'rng' || LIVE.has(k) || MEMOS.has(k), get: k => (k === 'rng' ? d.act : k in scratch ? scratch[k] : MEMOS.has(k) ? undefined : real[k]), set: (k, x) => { scratch[k] = x; } };
}
const aroundSpread = (i, f, d) => { const was = placeDice; placeDice = d.place; try { return f(); } finally { placeDice = was; } };
function spreadLast(vary = 'act', n = null) {
  const a = S.lastAct;
  if (!a?.proc) return null;
  const hostedRun = !!a.proc.run.hosted, opts = { live: hostedRun ? liveForSpread : null, around: aroundSpread };
  const r = spread(a.proc, a.view, { n: n ?? (hostedRun ? 30 : 200), vary, actAt: a.actAt, place: realPlace, actual: a.fx, seed: `${S.seed}/spread/${S.day}/${S.t}`, ...opts });
  r.reproduces = a.actAt ? reproduces(a.proc, a.view, a.actAt, realPlace, a.fx, opts) : null;
  if (a.trip?.steps?.length) r.walk = walkOdds(S.L, a.trip, 100, `${S.seed}/odds/${S.day}/${S.t}`);
  return r;
}
const fmtN = x => (typeof x !== 'number' ? String(x) : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2).replace(/\.?0+$/, '') : x.toPrecision(2).replace(/\.?0+$/, ''));
const pct = x => `${Math.round(100 * x)}%`;
function leafWords(e) {
  if (e.present < 1) return `${e.actual === undefined ? 'not this time' : `<b>${esc(fmtN(e.actual))}</b>`} · <span>in ${pct(e.present)} of runs</span>${e.summary.kind === 'num' && e.summary.min !== e.summary.max ? `, ${fmtN(e.summary.q[0])}–${fmtN(e.summary.q[4])}` : e.summary.kind === 'num' ? `, ${esc(fmtN(e.summary.min))}` : ''}`;
  const s = e.summary, a = e.actual === undefined ? '' : `<b>${esc(fmtN(e.actual))}</b>`;
  if (!e.varies) return `${a || esc(fmtN(s.kind === 'num' ? s.min : Object.keys(s.counts)[0]))} <span class="hint">always</span>`;
  if (s.kind === 'num') return `${a}${a ? ' · ' : ''}${fmtN(s.q[0])}–${fmtN(s.q[4])}, median ${fmtN(s.q[2])}${s.same != null && s.same > 0 ? `, unchanged ${pct(s.same)}` : ''}${e.rank != null ? ` · <span class="${e.rank < 0.1 || e.rank > 0.9 ? 'odd' : ''}">rank ${pct(e.rank)}</span>` : ''}`;
  return `${a}${a ? ' · ' : ''}${Object.entries(s.counts).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${esc(k)} ${pct(v)}`).join(', ')}`;
}
const anyOdd = n => (n.leaf?.rank != null && n.leaf.varies && (n.leaf.rank < 0.1 || n.leaf.rank > 0.9)) || n.children.some(anyOdd);
function treeHTML(node, depth = 0) {
  const quiet = c => !c.children.length && c.leaf?.summary && !c.leaf.varies && /\((count)\)$/.test(c.path) && c.leaf.actual === 0; // nothing made, nothing used: not worth a line
  return node.children.filter(c => !quiet(c)).sort((a, b) => (b.children.length > 0) - (a.children.length > 0) || (b.leaf?.varies ?? false) - (a.leaf?.varies ?? false)).map(c => {
    if (!c.children.length) return `<li><span class="path">${esc(c.name)}</span>: ${c.leaf ? (c.leaf.summary ? leafWords(c.leaf) : esc(fmtN(c.leaf.value))) : ''}</li>`;
    const odd = anyOdd(c);
    return `<li><details${depth < 1 || odd || /^report\b/.test(c.path) ? ' open' : ''}><summary>${esc(c.name)}${c.leaf ? `: ${c.leaf.summary ? leafWords(c.leaf) : esc(fmtN(c.leaf.value))}` : ''}</summary><ul>${treeHTML(c, depth + 1)}</ul></details></li>`;
  }).join('');
}
function spreadHTML() {
  if (!S.showProps) return '';
  const sh = S.spreadShown, a = S.lastAct;
  const buttons = `<div class="row"><button class="ghost" data-spread="act">This attempt’s luck</button><button class="ghost" data-spread="place">The place’s luck</button><button class="ghost" data-spread="both">Both</button></div>`;
  const head = `<h3>What else could have happened</h3><p class="hint">The last action (${esc(a?.proc?.name ?? 'none yet')}) run again on what it read, with other dice. Ranks near 0% or 100% mark unusual luck.</p>${buttons}`;
  if (!sh || sh.act !== a) return `<div class="spread">${head}</div>`;
  const r = sh.result;
  if (!r) return `<div class="spread">${head}<p class="hint">Nothing to look into.</p></div>`;
  const vary = { act: 'this attempt’s luck', place: 'the place’s luck', both: 'both' }[r.vary];
  const unusual = r.unusual.length ? `<p>Unusual luck: ${r.unusual.map(e => `${esc(e.path)} ${esc(fmtN(e.actual))} (rank ${pct(e.rank)})`).join('; ')}.</p>` : '<p class="hint">Nothing unusual in what happened.</p>';
  const walk = r.walk ? `<details><summary>The walk: ${r.walk.steps.length} steps, ${r.walk.steps.filter(s => s.p < 0.9).length} of them open; surprisal ${r.walk.bits.toFixed(1)} bits</summary><ul>${r.walk.steps.filter(s => s.p < 0.9).map(s => `<li>step ${s.i + 1} from ${s.from.x},${s.from.y}: went ${s.took.x},${s.took.y} (${pct(s.p)})${s.others.length ? `; else ${s.others.slice(0, 3).map(o => `${o.cell} ${pct(o.p)}`).join(', ')}` : ''}</li>`).join('')}</ul></details>` : '';
  return `<div class="spread">${head}<p class="hint">${r.n} runs varying ${vary}${r.reproduces === true ? '; run again with the same dice, it comes out the same' : r.reproduces === false ? '; <span class="odd">run again with the same dice, it comes out differently (it depends on something outside what it read)</span>' : ''}${r.errors.length ? `; ${r.errors.length} runs failed: ${esc(r.errors[0])}` : ''}.</p>${unusual}
    <details open><summary>What it did</summary><ul class="tree">${treeHTML(r.outcome)}</ul></details>${walk}
    <details><summary>What it read (${r.inputList.length} values)</summary><ul class="tree">${treeHTML(r.inputs)}</ul></details></div>`;
}

// ------------------------------------------------------------ game-side processes
//
// Processes whose runs use the game's own helpers (see hosted), declared over the game's state by key.
// What they may touch, in bundles:
const TIME = ['day', 't', 'body', 'inv', 'sites', 'at', 'mind', 'lore', 'collapsed', 'uid', 'milestones', '+log']; // time passing: the ticks, and a collapse into sleep
const KNOW = ['mem', 'sites', 'at']; // what I've noticed, here and in my notes
const MAP = ['suspects', 'streams', 'seenLand', 'waterNames', 'segNames', 'cliffNames', 'walked', 'travelHint', 'trod', 'crossingsKnown', 'streamGaps', 'crossedWater', 'landNamed', 'recentNotice', 'fruitNoted', 'looking']; // the mental map and what I'm about
const foggy = v => (v.body.focus < 0.25 ? 'Too foggy to think it through. I need rest, water or food first.' : true);
const GAME = {
  poke: { id: 'poke', name: 'Poke around', reads: ['day', 't'], writes: ['body.germs', ...KNOW, 'inv', '+log'], hours: 0.5, kcal: 230, run: hosted(() => pokeAround(site())) },
  scan: { id: 'scan', name: 'Scan', reads: ['day', 't', 'inv'], writes: [...KNOW, ...MAP, 'body.focus', '+log'], hours: 0.5, kcal: 120,
    run: hosted(() => { S.body.focus = clamp(S.body.focus - 0.04); sense(site(), false, { scan: true }); }) },
  lookout: { id: 'lookout', name: 'Look out from up here', reads: ['day', 't', 'inv'], writes: [...KNOW, ...MAP, 'milestones.lookout', '+log'], hours: 0.5, kcal: 200,
    run: hosted(() => {
      const s = site();
      sense(s, true); markSeen(s.x, s.y, 50, { eye: lookoutEye(S.L, s) }); noteSeenFeatures();
      if (!S.milestones.lookout) { S.milestones.lookout = true; log('A view at last.', 'milestone'); }
    }) },
  look: { id: 'look', name: 'Look for something', reads: ['spec', 'day', 't', 'lore'], writes: [...KNOW, ...MAP, 'body', 'inv', 'uid', 'milestones', '+log'], hours: 0.5, kcal: 180, run: hosted(v => startLooking(v.spec)) },
  stopLooking: { id: 'stop-looking', name: 'Stop looking', reads: [], writes: ['looking', '+log'], run: hosted(() => { log(`Stopped looking for ${S.looking.label}.`, 'thought'); S.looking = null; }) },
  inspect: { id: 'inspect', name: 'Inspect and assess', reads: ['entity', 'lore', 'inv', 'day', 't'], writes: [...KNOW, 'body.focus', '+log'],
    hours: v => 0.25 + (v.body.focus >= 0.25 ? 0.15 : 0), kcal: 130, run: hosted(v => { const e = entity(v.entity); inspect(e); assess(e); }) },
  test: { id: 'test', name: 'Test something', reads: ['thing.uid', 'name'], writes: ['inv', '+log'], hours: 0.1, kcal: 120,
    run: hosted(v => { const it = byUid(v.thing.uid), T = testsFor(it).find(([k]) => k === v.name); it.notes[v.name] = T[1](); log(`${v.name} on the ${it.name}: ${it.notes[v.name]}.`); }) },
  gather: { id: 'gather', name: 'Collect', reads: ['index', 'option', 'day', 't', 'lore'], writes: [...KNOW, 'inv', 'uid', 'body', '+log'],
    hours: v => v.option.hours, kcal: v => v.option.kcal,
    run: hosted(v => { const g = gatherOptions(site())[v.index]; site().gathered = true; const it = g.fn(); touch([it], 0.5); log(`Gathered ${it.name}.`); }) },
  drop: { id: 'drop', name: 'Leave something behind', reads: ['thing.uid'], writes: ['inv', '+log'], run: hosted(v => { const it = byUid(v.thing.uid); remove(it); log(`Left the ${it.name} behind.`); }) },
  rename: { id: 'rename', name: 'Name a place', reads: ['place', 'name', 'origin'], writes: ['sites', 'at', '+log'],
    run: hosted(v => {
      const t = S.sites.find(x => x.key === v.place);
      log(v.origin ? `Decided to call ${t === site() ? 'this place' : 'the place I got that from'} ${v.name}. It goes on my map.` : `Decided to call this place ${v.name}.`);
      t.name = v.name; t.renamed = true;
    }) },
  think: { id: 'think', name: 'Think it through', reads: ['path'], writes: ['body.focus', '+log'], hours: 0.1, kcal: 110, ready: foggy, run: hosted(v => think(v.path)) },
  sleep: { id: 'sleep', name: 'Sleep till morning', reads: ['forced', 'ambientNow'], writes: TIME, run: hosted(v => sleepNow(v.forced)) },
  hike: { id: 'hike', name: 'Walk', reads: ['key'], writes: [...TIME, ...KNOW, ...MAP], run: hosted(v => hikeNow(v.key)) },
};
for (const p of Object.values(GAME)) p.reads = [...new Set([...p.reads, 'day', 't'])]; // every journal line is stamped with the time
const sleep = (forced = false) => perform(GAME.sleep, { forced, ambientNow: ambient() });
const hike = key => perform(GAME.hike, { key });

// ------------------------------------------------------------ the passing of time
//
// Time passes in half-hour ticks, and each tick runs every process in TICKS (acts.js) in turn: each
// reads the state it cares about and changes only its own; none calls another.
function pass(hours, kcal = 150) {
  const steps = Math.max(1, Math.ceil(hours / 0.5));
  const dt = hours / steps;
  for (let i = 0; i < steps; i++) {
    const was = skyNow();
    S.t += dt;
    if (S.t >= 24) { S.t -= 24; S.day++; } // past midnight
    for (const tick of TICKS) perform(tick, { tick: { dt, kcal }, was });
  }
  S.body.hyd = clamp(S.body.hyd); S.body.energy = clamp(S.body.energy);
  const cap = 1 - 0.6 * Math.max(0, 0.4 - S.body.hyd) / 0.4 - 0.4 * Math.max(0, 0.3 - S.body.energy) / 0.3 - 0.5 * S.body.sick - 0.3 * (S.body.chill ?? 0);
  S.body.focus = Math.min(S.body.focus, clamp(cap, 0.1, 1));
  if (S.body.hyd <= 0.02 || S.body.energy <= 0.02 || S.body.sick >= 0.95) collapse();
}

function collapse() {
  const why = S.body.hyd <= 0.02 ? 'thirst' : S.body.energy <= 0.02 ? 'hunger' : 'sickness';
  log(`Everything went grey. I lay down where I was and lost the rest of the day to ${why}.`, 'warn');
  S.collapsed++;
  S.body.hyd = Math.max(S.body.hyd, 0.35); S.body.energy = Math.max(S.body.energy, 0.12); S.body.sick = Math.min(S.body.sick, 0.6);
  sleep(true);
}

// Sleep, as a process (body.js): hour by hour from now until first light, the night as it comes (the
// air, the wind, rain or snow, the ground's wet and snow), what I'm sheltered by (a hut, or the trees
// and rocks here), lying on (a bed made here) and wearing (my clothes, wet or dry), a banked fire, and my
// body, give how well I sleep each hour; that sets how far tiredness, sickness, sore hands and a bad
// ankle mend, what shivering costs, how chilled I wake, and how wet or dry my clothes are by morning.
// The morning's words name what kept me awake.
function shelterHere(s, g) {
  if (s.hut) return SHELTERS.hut;
  const d = deciduousShare(S.world);
  return naturalShelter(S.L.veg[cellOf(s.x, s.y)], 1 - d + d * g.leaf, s.micro);
}
function sleepNow(forced = false) {
  const s = site(), c = cellOf(s.x, s.y);
  const banked = fireHere() && takeWood(2) === 2;
  const wakeDay = S.t >= dawnAt(S.world, S.day) ? S.day + 1 : S.day, wake = clamp(dawnAt(S.world, wakeDay) + 0.25, 4, 8.5); // up once there's light to see by
  const hours = (wakeDay - S.day) * 24 + wake - S.t;
  const biterKind = !banked && ['mosquito', 'gnat'].find(k => S.world.animals.some(a => a.traits.key === k && (waterHere(s) || a.habitats.some(h => h.micro === s.micro))));
  const meanSoak = (S.world.environment.precipMm / 365) / 0.15;
  const tally = { q: 0, n: 0, loss: {}, cause: {}, lowC: Infinity }, limpBefore = S.body.limp ?? 0;
  let day = S.day, t = S.t;
  for (let h = 0; h < hours - 1e-9; h += 1) {
    const dt = Math.min(1, hours - h), k = skyAt(S.world, day, t), g = groundAt(S.world, day);
    const env = { tempC: k.tempC, windMs: windAt(S.world, day, t).ms, precip: k.wet ? k.weather : null, groundWet: clamp(g.soak / (2 * meanSoak)), snowCm: snowCm(S.L, g, c), biters: !!biterKind && k.tempC >= 10 };
    const fireC = banked ? (s.hut ? 7 : 5) * Math.max(0.2, 1 - h / hours) : 0; // the banked fire, burning down
    const r = perform(SLEEP_HOUR, { night: env, shelter: shelterHere(s, g), fireC, dt }, { quiet: true }).report;
    tally.q += r.quality * dt; tally.n += dt; tally.lowC = Math.min(tally.lowC, k.tempC);
    for (const [why, v] of Object.entries(r.loss)) tally.loss[why] = (tally.loss[why] ?? 0) + v * dt;
    if (r.loss.cold > 0) tally.cause[r.coldCause] = (tally.cause[r.coldCause] ?? 0) + r.loss.cold * dt;
    t += dt; if (t >= 24) { t -= 24; day++; }
  }
  const q = tally.n ? tally.q / tally.n : 1;
  for (const it of S.inv) if (it.props.moisture !== undefined && it.kind !== 'food') dry(it, hours / 24, s.hut ? ambient() - 0.03 : ambient());
  S.body.hands *= Math.pow(0.55, 0.4 + 0.6 * q); S.body.callus *= 0.995; S.body.focus = clamp(0.4 + 0.7 * q, 0.3, 1); // a good night mends; a bad one, less
  if (limpBefore > 0 && !S.body.limp) log('My ankle feels sound again.', 'note');
  const seasonBefore = seasonOf(S.world, dayOfYear(S.world, S.day));
  S.day = wakeDay; S.t = wake;
  const seasonNow = seasonOf(S.world, dayOfYear(S.world, S.day));
  if (seasonNow !== seasonBefore) log(`${{ spring: 'The days are lengthening and the air has softened: spring.', summer: 'High summer now: long days, short nights.', autumn: 'The nights are drawing in: autumn.', winter: 'Winter: short days and hard nights.', 'wet season': 'The rains have come: the wet season.', 'dry season': 'The rains have stopped: the dry season.' }[seasonNow]}`, 'note');
  if (banked) s.fireUntil = now() + 1.5;
  // what kept me awake: the losses that cost most over the night, at most two
  const per = Object.fromEntries(Object.entries(tally.loss).map(([k, v]) => [k, v / Math.max(1, tally.n)]));
  const coldWhy = Object.entries(tally.cause).sort((a, b) => b[1] - a[1])[0]?.[0];
  const say = {
    cold: { ground: 'the bare ground drew the heat out of me', wind: 'the wind cut through me', wet: 'my clothes were wet through', air: `the night was cold (${Math.round(tally.lowC)} °C at its coldest)` }[coldWhy] ?? 'the cold',
    rain: `${skyNow().weather === 'snow' ? 'snow' : 'rain'} fell on me half the night`, wind: 'the wind roared all night', hot: 'it was too warm to settle',
    biters: `${biterKind === 'mosquito' ? 'mosquitoes' : 'gnats'} whined at my ears; smoke would have kept them off`, hunger: 'my empty stomach kept waking me', thirst: 'thirst kept waking me', pain: 'my ankle throbbed',
  };
  const reasons = Object.entries(per).filter(([, v]) => v >= 0.08).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => say[k]);
  const words = q >= 0.8 ? 'Slept warm and deep.' : q >= 0.55 ? 'Slept well enough.' : q >= 0.35 ? `A ${per.cold >= 0.15 ? 'cold' : 'restless'}, broken night.` : per.cold >= 0.3 ? 'Barely slept; cold to the bone.' : 'Barely slept.';
  const chill = S.body.chill >= 0.6 ? ' I woke shaking, stiff and grey with cold.' : S.body.chill >= 0.3 ? ' I woke chilled through.' : '';
  if (!forced) log(`${words}${reasons.length ? ` ${cap(reasons.join(', and '))}.` : ''}${chill}${banked ? ' Banked the fire with two pieces of wood; it was still glowing at dawn.' : ''}${s.hut && q >= 0.55 ? ' The hut kept the night out.' : ''}${s.bed && !s.hut && q >= 0.55 ? ' The bed of leaves helped.' : ''}`, 'act');
  if (S.body.chill >= 0.6 && S.body.sick < 0.3 && !S.body.pendingSick.some(p => p.chill) && S.rng.chance(S.body.chill - 0.4)) S.body.pendingSick.push({ at: now() + 12, severity: 0.15 + 0.2 * (S.body.chill - 0.6), text: 'A chill has settled on my chest: aching, shivery, coughing.', chill: true }); // a night too cold can make me ill (once, not again while I'm ill)
  for (const p of [...S.body.pendingSick]) if (now() >= p.at) { S.body.sick = clamp(S.body.sick + p.severity); S.body.pendingSick.splice(S.body.pendingSick.indexOf(p), 1); log(p.text, 'warn'); }
}

function bodyWords() {
  const w = [];
  const ch = S.body;
  w.push(S.body.hyd > 0.7 ? 'Not thirsty.' : S.body.hyd > 0.45 ? 'Thirsty.' : S.body.hyd > 0.2 ? 'Very thirsty; my head aches.' : 'Parched. I need water now.');
  w.push(S.body.energy > 0.68 ? 'Fed enough.' : S.body.energy > 0.45 ? 'Hungry.' : S.body.energy > 0.25 ? 'Very hungry; weak in the legs.' : 'Starving and shaky.');
  w.push(ch.fatigue < 0.3 ? 'Rested.' : ch.fatigue < 0.6 ? 'Getting tired.' : ch.fatigue < 0.85 ? 'Tired.' : 'Exhausted.');
  w.push(ch.hands < 0.25 ? 'Hands fine.' : ch.hands < 0.5 ? 'Palms sore.' : ch.hands < 0.8 ? 'Palms blistered.' : 'Blisters open; palms raw.');
  if (ch.callus > 0.25) w.push('Calluses forming.');
  if (S.body.limp > 0.05) w.push(S.body.limp < 0.3 ? 'Ankle a little sore.' : S.body.limp < 0.6 ? 'Limping on a swollen ankle.' : 'Hobbling; the ankle can barely take my weight.');
  if (S.body.wound && now() - S.body.wound.at < 48) w.push('A gash on my shin.');
  if (S.body.clothes.wet > 0.15) w.push(S.body.clothes.wet > 0.6 ? 'Clothes soaked through.' : 'Clothes damp.');
  if ((S.body.chill ?? 0) > 0.15) w.push(S.body.chill > 0.5 ? 'Chilled to the core; I can’t stop shivering.' : 'Still chilled.');
  w.push(ch.focus > 0.7 ? 'Thinking clearly.' : ch.focus > 0.4 ? 'Thinking feels slow.' : 'Thinking feels foggy.');
  const mt = S.body.macro.p + S.body.macro.f + S.body.macro.c;
  if (mt > 600 && S.body.macro.p / mt > 0.33) w.push('Too much lean food lately; I crave fat or starch.');
  else if (mt > 900 && S.body.macro.f / mt < 0.08) w.push('Craving something fatty.');
  if (S.body.gut > 1.1) w.push('Full.');
  if (S.body.germs > 0.35) w.push('Filthy hands.');
  if (S.showProps) w.push(`(hands: germs ${S.body.germs.toFixed(2)})`);
  if (S.body.sick > 0.1) w.push(S.body.sick > 0.6 ? 'Badly sick.' : S.body.sick > 0.3 ? 'Sick to my stomach.' : 'A bit queasy.');
  const wd = windNow();
  w.push(`${wd.strength < 0.35 ? 'A light breeze' : wd.strength < 0.7 ? 'A steady breeze' : 'A strong wind'} from the ${bearingWord(wd.from)}.`);
  return w;
}

// ------------------------------------------------------------ items

function addItem(name, kind, props, from, extra = {}) {
  const it = { uid: S.uid++, name, kind, props: { ...props }, from, notes: {}, provenance: { name: from?.name ?? name, source: from?.id }, ...extra };
  it.props.germs ??= GERMS[kind === 'food' ? props.chem?.cls : kind] ?? 0.05;
  S.inv.push(it);
  return it;
}
// ------------------------------------------------------------ germs
//
// Everything carries a germ load (0 clean … 1 filthy): soil on dug roots, gut contents of small
// creatures, rot on a carcass bone. Hands carry one too. Whatever touches mixes toward a common
// level: gathering, every preparation, eating, and (slowly) carrying things together. Moist food
// breeds more over time, faster in warmth; drying stops it. Heat kills; washing in water helps but
// leaves the water's own germs behind. Eating germs risks a sour gut a day later. (Lye: later.)
const GERMS = { egg: 0.15, fruit: 0.05, nut: 0.05, seed: 0.05, grain: 0.08, pod: 0.06, storage: 0.3, root: 0.3, leaf: 0.12, stem: 0.1, flower: 0.05, innerBark: 0.08, invertebrate: 0.3, fattyGrub: 0.3, shellfish: 0.45, mushroom: 0.15, lichen: 0.1, honey: 0.02,
  stone: 0.05, edge: 0.05, wood: 0.04, shoot: 0.03, stalk: 0.03, tindermat: 0.05, tinder: 0.05, bone: 0.4, finebone: 0.4, moss: 0.15, diggingstick: 0.15, board: 0.03, spindle: 0.03 };
const touch = (items, k = 0.4, hands = true) => mix(items, S.body, k, hands);
const waterGerms = () => waterSource(site()).hidden?.pathogen ?? 0.25;
const waterTempC = still => { const e = S.world.environment.meanTempC; return site().micro === 'spring' ? e : still ? e + 3 : Math.max(2, e - 1); };

// A food item carries its make-up (food.js) and mass in kg; preparation changes both.
function foodItem(name, chem, mass, labels, from, extra = {}) {
  return addItem(name, 'food', { chem: cloneChem(chem), mass }, from, { food: labels, base: name, prep: [], ...extra });
}
const has = kind => S.inv.some(i => i.kind === kind);
const bedding = () => S.inv.filter(i => i.kind === 'bedding' || i.kind === 'moss' || (i.kind === 'tindermat' && /^dry grass/.test(i.name)));
const ofKind = (...kinds) => S.inv.filter(i => kinds.includes(i.kind));
function takeWood(n) {
  let k = 0;
  for (const it of [...S.inv]) if (k < n && it.kind === 'wood') { S.inv.splice(S.inv.indexOf(it), 1); k++; }
  return k;
}
function remove(it) { const i = S.inv.indexOf(it); if (i >= 0) S.inv.splice(i, 1); }
const byUid = uid => S.inv.find(i => i.uid === Number(uid));

// What the character can tell at a glance about an item, plus anything learned by testing or use.
function impressions(it) {
  const p = it.props, out = [];
  if (p.straightness !== undefined) out.push(p.straightness > 0.86 ? 'straight' : p.straightness > 0.78 ? 'slightly crooked' : 'crooked');
  if (it.kind === 'spindle') out.push(`about ${Math.round(p.length)} cm long`);
  if (it.kind === 'board') out.push(p.life > 0.7 ? 'barely used' : p.life > 0.35 ? 'part burned through' : 'nearly burned through');
  if (it.kind === 'board' && p.socket > 0.6) out.push('socket burned in');
  if ((it.kind === 'shoot' || it.kind === 'diggingstick') && p.moisture > 0.3) out.push('still green');
  if (it.kind === 'diggingstick' && p.hardened) out.push('fire-hardened point');
  for (const v of Object.values(it.notes)) out.push(v);
  if (it.kind === 'food') { const e = entity(it.from.id); const l = e && S.lore[loreKey(e, it.from.part)]; if (l) out.push(loreWords(l)); }
  return out;
}

// ------------------------------------------------------------ food memory
// Keyed the way the character perceives things: a lookalike shares its model's memory.
const loreWords = l => (l.sick ? `made me sick ${l.sick > 1 ? `${l.sick} times` : 'once'}` : `ate fine ${l.ok > 1 ? `${l.ok} times` : 'once'}`);

// ------------------------------------------------------------ gathering what has been noticed here

function patchDensity(e, s) {
  const v = e.varying?.find(x => x.id === 'woodDensity');
  return v ? samplePatch(S.world, e.id, s.key, s.micro).traits.woodDensity : e.traits.woodDensity;
}
// kilocalories in a gathered portion (half an hour's foraging), converted to the reserve stock (24000 kcal ≈ 1)

function gatherOptions(s) {
  const opts = [], g = groundNow(), snowHere = snowCm(S.L, g, cellOf(s.x, s.y));
  const cutter = bestEdge();
  for (const m of S.mats) {
    if (!s.known.has(m.source)) continue;
    const e = entity(m.source);
    if (!e) continue;
    const nm = e.name;
    const needEdge = m.collect === 'flake';
    const softGround = ['streambank', 'pond', 'claybank', 'spring'].includes(s.micro) && /hands in soft ground/.test(e.parts?.find(x => x.part === m.part)?.collect ?? '');
    const needStick = m.collect === 'digging-stick' && !softGround && !bestStick();
    // the season (phenology.js) and the snow (ground.js): fruit only when it's ripe, nothing low down under deep snow
    const inSeason = e.kind === 'plant' ? partNow(S.world, e, m.part, g) : 1;
    const buried = snowHere > 15 && (['stone', 'moss', 'dry-grass', 'dead-stalk', 'lichen-tinder'].includes(m.material) || ['herb', 'grass', 'mushroom', 'moss'].includes(e.form) || /root|tuber|bulb|corm/.test(m.part));
    const add = (label, fn, hours = 0.3, kcal = 200) => opts.push({ label, part: label.replace(/ \(.*$/, '').replace(/ · .*$/, ''), species: nm, fn, hours, kcal, blocked: inSeason < 0.15 ? 'not in season now' : buried ? 'under the snow' : needEdge && !cutter ? 'needs a cutting edge' : needStick ? 'needs a digging stick' : null });
    switch (m.material) {
      case 'dead-wood':
        add(`Dead wood (${nm})`, () => addItem(`dead wood, ${nm}`, 'wood', { density: patchDensity(e, s), resin: m.props.resin, moisture: ambient() + 0.06 }, { id: e.id, name: nm, part: 'dead wood', site: s.key }), 0.3, 250);
        if (e.form === 'shrub') add(`Dead shoots (${nm})`, () => addItem(`dead shoot, ${nm}`, 'shoot', { density: patchDensity(e, s), moisture: ambient() + 0.02, straightness: 0.72 }, { id: e.id, name: nm, part: 'dead shoots', site: s.key }), 0.25);
        break;
      case 'live-wood':
        if (m.props.straight) add(`Green shoot (${nm})`, () => addItem(`green shoot, ${nm}`, 'shoot', { density: patchDensity(e, s), moisture: 0.55, straightness: 0.9 }, { id: e.id, name: nm, part: 'green shoot', site: s.key }), 0.3);
        break;
      case 'dead-stalk':
        add(`Dead stalk (${nm})`, () => addItem(`dead stalk, ${nm}`, 'stalk', { density: 0.3, moisture: ambient(), straightness: 0.95 }, { id: e.id, name: nm, part: 'dead stalk', site: s.key }), 0.2);
        break;
      case 'dry-grass': case 'fluff': case 'fungus-tinder': case 'lichen-tinder':
        add(`${cap(m.part)} (${nm})`, () => addItem(`${m.part}, ${nm}`, 'tindermat', { moisture: ambient() * (m.material === 'fungus-tinder' ? 0.9 : 0.6) }, { id: e.id, name: nm, part: m.part, site: s.key }), 0.25);
        break;
      case 'moss':
        add(`Moss (${nm})`, () => addItem(`moss, ${nm}`, 'moss', { moisture: ambient() + 0.2 }, { id: e.id, name: nm, part: 'moss', site: s.key }), 0.2);
        break;
      case 'outer-bark':
        if (m.props.papery) add(`Papery bark (${nm})`, () => addItem(`papery bark, ${nm}`, 'tindermat', { moisture: ambient() * 0.7 }, { id: e.id, name: nm, part: 'outer bark', site: s.key }), 0.25);
        break;
      case 'inner-bark':
        if (m.props.fiber > 0.4) add(`Inner bark for tinder (${nm})`, () => addItem(`inner bark for tinder, ${nm}`, 'tindermat', { moisture: ambient() + 0.1 }, { id: e.id, name: nm, part: 'inner bark', site: s.key }), 0.4);
        break;
      case 'stone':
        add(`Fist-sized stone (${nm})`, () => addItem(`stone, ${nm}`, 'stone', { fracture: m.props.fracture, flaws: m.props.flaws, hardness: m.props.hardness, mass: Math.round(S.rng.uniform(450, 1100)), rough: m.props.abrasive ? 0.85 : 0.35, spall: m.props.spall ?? 0.3 }, { id: e.id, name: nm, part: 'cobble', site: s.key }), 0.15);
        if (m.props.slab) add(`Flat slab (${nm})`, () => addItem(`flat slab, ${nm}`, 'slab', { mass: 6000, hardness: m.props.hardness }, { id: e.id, name: nm, part: 'slab', site: s.key }), 0.2, 300);
        break;
      case 'plant-food': {
        const part = e.parts.find(x => x.part === m.part);
        const lore = S.lore[loreKey(e, m.part)];
        if (part?.food && part.chem) add(`${cap(m.part)} to eat (${nm})${lore ? ` · ${loreWords(lore)}` : ''}`, () => foodItem(`${m.part} to eat, ${nm}`, part.chem, part.chem.gather * clamp(inSeason, 0.3, 1), part.food, { id: e.id, name: nm, part: m.part, site: s.key }), 0.5); // early or late in its season, less of it
        break;
      }
    }
  }
  const litterHere = litterAt(S.world, S.L, g, cellOf(s.x, s.y));
  if (litterHere > 0.3) opts.push({ label: 'Armful of dead leaves (bedding)', part: 'Bedding', species: 'fallen leaves', hours: 0.2, kcal: 150, fn: () => addItem('armful of dead leaves', 'bedding', { loft: 0.5, moisture: ambient() + (skyNow().wet ? 0.2 : 0) }, { name: 'fallen leaves', part: 'dead leaves', site: s.key }) });
  if (s.bones?.big) opts.push({ label: 'Big bone (from something large)', part: 'Bones', species: 'big animal', hours: 0.15, kcal: 150,
    fn: () => { s.bones.big--; return addItem('long bone', 'bone', { hardness: 3, size: 'big' }, { name: 'some large animal', part: 'long bone', site: s.key }); } });
  if (s.bones?.fine) opts.push({ label: 'Fine bones (from something small)', part: 'Bones', species: 'small animal', hours: 0.15, kcal: 150,
    fn: () => { s.bones.fine--; return addItem('fine bones', 'finebone', { hardness: 3, size: 'fine' }, { name: 'some small animal', part: 'fine bones', site: s.key }); } });
  for (const id of s.known) {
    const e = entity(id);
    if (e?.traits?.key === 'bee') {
      if (s.hive) opts.push({ label: 'Honeycomb from the hive', part: 'Honeycomb', species: e.name, hours: 0.5, kcal: 250, fn: () => { stung(e); return foodItem('honeycomb', e.honeyChem, e.honeyChem.gather, { raw: 'safe', cooked: 'safe' }, { id: e.id, name: e.name, part: 'honeycomb', site: s.key }, { animal: true }); } });
      continue;
    }
    if (e?.eggs && !s.eggsTaken?.includes(e.id) && e.habitats.some(h => h.micro === s.micro) && animalNow(e, condNow(s)).breeding) { // only while it's nesting // a clutch, once found here, is gone once taken
      const lore = S.lore[loreKey(e, 'eggs')];
      opts.push({ label: `${cap(e.eggs.nest)} (${e.name})${lore ? ` · ${loreWords(lore)}` : ''}`, part: 'Eggs', species: e.name, hours: 0.4, kcal: 120, fn: () => { (s.eggsTaken ??= []).push(e.id); return foodItem(`${e.name} eggs`, e.eggs.chem, e.eggs.chem.gather, e.eggs.food, { id: e.id, name: e.name, part: 'eggs', site: s.key }, { animal: true }); } });
    }
    if (e?.kind === 'animal' && e.cls === 'invertebrate' && e.food) {
      const lore = S.lore[loreKey(e, 'whole')];
      opts.push({ label: `A handful of ${e.name}${/s$/.test(e.name) ? '' : 's'} to eat${lore ? ` · ${loreWords(lore)}` : ''}`, part: 'Small creatures to eat', species: e.name, hours: 0.5, kcal: 180, fn: () => stung(e) || foodItem(`${e.name}s, a handful`, e.chem, e.chem.gather, e.food, { id: e.id, name: e.name, part: 'whole', site: s.key }, { animal: true }) });
    }
  }
  return opts;
}

function runningWaterHere() { const s = site(); return waterHere(s) && NB_CELLS(s).some(c => S.L.chan[c] > 0 && wetCell(c)); }
const NB_CELLS = s => { const out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = s.x + dx, y = s.y + dy; if (x >= 0 && y >= 0 && x < GN && y < GN) out.push(cellOf(x, y)); } return out; };

// Raiding a stinging insect's nest: smoke from a fire here keeps them sluggish; otherwise, stings.
function stung(e) {
  if (!/stings/.test(e.defense ?? '')) return null;
  if (fireHere()) { log(`Smoke from the fire kept the ${pluralize(e.name)} sluggish; only a sting or two.`); return null; }
  S.body.hands = clamp(S.body.hands + 0.2); S.body.sick = clamp(S.body.sick + 0.05);
  log(`Stung again and again by the ${pluralize(e.name)}. Smoke would have calmed them.`, 'warn');
  return null;
}

// ------------------------------------------------------------ tests

const DENSITY_WORDS = d => (d < 0.3 ? 'light; dents easily under a thumbnail' : d < 0.45 ? 'fairly light; dents with pressure' : d < 0.6 ? 'medium weight; hard to dent' : 'heavy and hard; won’t dent');
const MOIST_WORDS = (m, amb) => (m < amb + 0.025 ? 'snaps crisply: dry' : m < 0.25 ? 'snaps, but feels slightly damp' : 'bends: still green');

function testsFor(it) {
  const e = entity(it.from?.id);
  const field = name => e?.fieldTests?.find(([k]) => k.startsWith(name))?.[1];
  const T = [];
  const noisy = x => x + S.rng.normal(0, 0.04);
  if (['wood', 'shoot', 'stalk', 'board', 'spindle'].includes(it.kind)) {
    if (it.props.density !== undefined) T.push(['Thumbnail and heft', () => DENSITY_WORDS(noisy(it.props.density))]);
    T.push(['Snap test', () => MOIST_WORDS(noisy(it.props.moisture), ambient())]);
    if (field('Crush')) T.push(['Crush and smell', () => field('Crush')]);
  }
  if (it.kind === 'stone' || it.kind === 'slab') for (const n of ['Ring test', 'Test break', 'Scratch']) if (field(n)) T.push([n, () => field(n)]);
  if (it.kind === 'diggingstick') T.push(['Press the point with a thumbnail', () => { const h = noisy(it.props.hardness); return h > 0.7 ? 'won’t mark; hard as bone' : h > 0.55 ? 'barely marks' : h > 0.4 ? 'dents with effort' : 'dents easily; soft'; }]);
  if (it.kind === 'edge') T.push(['Inspect the edge', () => { const s = noisy(it.props.sharpness); return s > 0.8 ? 'keen edge' : s > 0.6 ? 'sharp edge' : s > 0.4 ? 'edge dulling' : 'dull edge'; }]);
  if (it.kind === 'board') T.push(['Inspect the notch', () => { const n = noisy(it.props.notch); return n > 0.75 ? 'clean notch' : n > 0.5 ? 'rough notch' : 'ragged notch'; }]);
  if (it.kind === 'tindermat' || it.kind === 'tinder') T.push(['Feel for dryness', () => (it.props.moisture < 0.08 ? 'bone dry' : it.props.moisture < 0.14 ? 'dry' : 'a little damp')]);
  if (it.kind === 'food') {
    const st = it.props.chem;
    if (!it.animal && field('Skin contact')) T.push([e.fieldTests.find(([k]) => k.startsWith('Skin contact'))[0], () => field('Skin contact')]);
    T.push(['Smell it', () => `${smellWords(st)}${it.props.germs > 0.5 && st.water > 0.5 ? '; and it smells off' : ''}`]);
    T.push(['Staged taste (lip, tongue, chew and spit)', () => tasteWords(st)]);
    T.push(['Bite and chew', () => textureWords(st)]);
  }
  return T;
}

// ------------------------------------------------------------ crafting slots

const bestEdge = () => ofKind('edge').sort((a, b) => b.props.sharpness - a.props.sharpness)[0] ?? null;
const hammerCandidates = () => ofKind('stone');

const RECIPES = [
  { id: 'knap', name: 'Knap flakes', blurb: 'Smash a stone on an anvil with a hammerstone.', slots: [['core', 'Stone to break', () => ofKind('stone')], ['hammer', 'Hammerstone', hammerCandidates]], ready: () => ofKind('stone').length >= 2 },
  { id: 'notch', name: 'Notch a hearth board', blurb: 'Split dead wood flat and cut a notch.', slots: [['wood', 'Dead wood', () => ofKind('wood')], ['edge', 'Cutting edge', () => ofKind('edge')]], ready: () => has('wood') && has('edge'), modes: [['quick', 'Quickly'], ['careful', 'Slowly and carefully']] },
  { id: 'refine', name: 'Touch up a notch', blurb: 'A slow pass to improve an existing notch.', slots: [['board', 'Hearth board', () => ofKind('board')], ['edge', 'Cutting edge', () => ofKind('edge')]], ready: () => has('board') && has('edge') },
  { id: 'carve', name: 'Carve a spindle', blurb: 'Trim a shoot straight and smooth.', slots: [['shoot', 'Shoot', () => ofKind('shoot')], ['edge', 'Cutting edge', () => ofKind('edge')]], ready: () => has('shoot') && has('edge') },
  { id: 'trim', name: 'Trim a spindle from a stalk', blurb: 'Snap a dead stalk to length; no tool needed.', slots: [['stalk', 'Dead stalk', () => ofKind('stalk')]], ready: () => has('stalk') },
  { id: 'tinder', name: 'Make a tinder bundle', blurb: 'Shred and fluff something dry into a nest.', slots: [['mat', 'Tinder material', () => ofKind('tindermat')]], ready: () => has('tindermat') },
  { id: 'bone', name: 'Smash a bone for splinters', blurb: 'Break a long bone with a hammerstone.', slots: [['bone', 'Bone', () => ofKind('bone')], ['hammer', 'Hammerstone', hammerCandidates]], ready: () => has('bone') && hammerCandidates().length > 0 },
  { id: 'digstick', name: 'Make a digging stick', blurb: 'A stout stick, its end shaped to a chisel point. Dense wood holds its point.', slots: [['stick', 'Stick', () => ofKind('shoot', 'wood')], ['tool', 'Shape it with', () => [...ofKind('edge'), ...ofKind('stone')]]], ready: () => (has('shoot') || has('wood')) && (has('edge') || has('stone')) },
  { id: 'harden', name: 'Fire-harden the digging stick', blurb: 'Turn the point slowly over the coals to drive out the water and harden it. Rushing it chars the tip.', slots: [['stick', 'Digging stick', () => ofKind('diggingstick')]], ready: () => has('diggingstick') && fireHere(), modes: [['quick', 'Quickly'], ['careful', 'Slowly and carefully']] },
  { id: 'pound', name: 'Pound food', blurb: 'Crack and mash it on a stone: frees locked fat, lets water and heat in, lets some poisons out.', slots: [['food', 'Food', () => ofKind('food')], ['stone', 'Pounding stone', () => ofKind('stone')]], ready: () => has('food') && has('stone') },
  { id: 'grind', name: 'Grind food to meal', blurb: 'Rub seeds, nuts or dried roots between two stones. Slow, but nothing is wasted.', slots: [['food', 'Food', () => ofKind('food').filter(f => f.props.chem.hard || f.props.chem.water < 0.3)]], ready: () => ofKind('stone').length >= 2 && ofKind('food').some(f => f.props.chem.hard || f.props.chem.water < 0.3) },
  { id: 'chop', name: 'Chop food small', blurb: 'Cut it into small pieces with an edge: water and heat get in faster, though the cells stay mostly whole.', slots: [['food', 'Food', () => ofKind('food')], ['edge', 'Cutting edge', () => ofKind('edge')]], ready: () => has('food') && has('edge') },
  { id: 'basin', name: 'Make a cooking basin', blurb: 'A rock hollow, or a pit lined with clay, to hold water for cooking with hot stones. It stays where it is.', slots: [], ready: () => !site().basin && waterHere(site()) && ['claybank', 'outcrop', 'streambed', 'scree', 'streambank'].includes(site().micro) },
  { id: 'stoneboil', name: 'Boil food with hot stones', blurb: 'Heat stones in the fire and drop them into the basin. Three or more bring it to a boil; some stones crack in the heat.', slots: [['food', 'Food', () => ofKind('food')]], ready: () => has('food') && fireHere() && !!site().basin && has('stone') },
  { id: 'wash', name: 'Wash something', blurb: 'Rinse it in the water. Cleaner, but no cleaner than the water.', slots: [['thing', 'Thing', () => S.inv]], ready: () => S.inv.length > 0 && waterHere(site()) },
  { id: 'scorch', name: 'Scorch a tool clean', blurb: 'Pass it through the flames.', slots: [['thing', 'Tool', () => S.inv.filter(i => ['stone', 'edge', 'bone', 'finebone', 'diggingstick'].includes(i.kind))]], ready: () => fireHere() && S.inv.some(i => ['stone', 'edge', 'bone', 'finebone', 'diggingstick'].includes(i.kind)) },
  { id: 'roast', name: 'Roast food in the coals', blurb: 'Dry heat: softens starch, kills parasites, drives off some poisons.', slots: [['food', 'Food', () => ofKind('food')]], ready: () => has('food') && fireHere(), modes: [['quick', 'Quickly'], ['careful', 'Slowly, turning it']] },
  { id: 'leach', name: 'Leach food in the stream', blurb: 'Wrap it and weigh it down in running water. Bitter things wash out, faster if it’s pounded first.', slots: [['food', 'Food', () => ofKind('food')]], ready: () => has('food') && runningWaterHere(), modes: [['2', 'Two hours'], ['8', 'Most of a day'], ['16', 'Overnight']] },
  { id: 'soak', name: 'Soak food in still water', blurb: 'Leave it in a pool or the shallows. Slower than running water.', slots: [['food', 'Food', () => ofKind('food')]], ready: () => has('food') && waterHere(site()), modes: [['2', 'Two hours'], ['8', 'Most of a day'], ['16', 'Overnight']] },
  { id: 'dryfood', name: 'Dry food', blurb: 'Spread it in the sun or near the fire. Lighter to carry, and lets some poisons escape if it was pounded.', slots: [['food', 'Food', () => ofKind('food')]], ready: () => has('food'), modes: [['sun', 'In the sun (4 h)'], ['fire', 'By the fire (2 h)']] },
  { id: 'drill', name: 'Drill for an ember', blurb: 'Spin the spindle in the notch between your palms.', slots: [['board', 'Hearth board', () => ofKind('board')], ['spindle', 'Spindle', () => ofKind('spindle')]], ready: () => has('board') && has('spindle'), modes: [['once', 'One attempt'], ['until', 'Keep going until I must stop']] },
];

const sel = {}; // chosen item per recipe slot
// Defaults use only what the character knows: the player's earlier choice, else the first item in the pack.
// (Sorting by true hidden properties would hand the player knowledge the character doesn't have.)
function pickSlot(recipe, slot, list) {
  const key = `${recipe}:${slot}`;
  const cur = list.find(i => i.uid === sel[key]);
  if (cur) return cur;
  if (slot === 'core') { const h = pickSlot(recipe, 'hammer', hammerCandidates()); return list.find(i => i !== h) ?? list[0]; }
  if (slot === 'hammer') { const known = list.filter(i => /scratches most/.test(i.notes.Scratch ?? '')); return known[0] ?? list[list.length - 1]; }
  // straightness and remaining length are visible at a glance, so preferring them leaks nothing
  if (slot === 'spindle') return [...list].sort((a, b) => (b.props.straightness - a.props.straightness) || (b.props.length - a.props.length))[0];
  if (slot === 'board') return [...list].sort((a, b) => b.props.life - a.props.life)[0];
  return list[0];
}

const flakeItem = (f, label) => addItem(label, 'edge', f.props, { id: f.provenance?.source, name: f.provenance?.name ?? '', part: label, site: site().key });

// Crafting (acts.js): the things chosen for each slot are bound to the process by slot name; then
// everything handled shares its germs (HANDLE), unless it was a rinse.
const KILL = { roast: 0.05, stoneboil: 0.01, harden: 0.2, scorch: 0.05 }; // heat: the share of germs left
function craft(id, mode) {
  const R = RECIPES.find(x => x.id === id);
  const pickd = Object.fromEntries(R.slots.map(([k, , list]) => [k, pickSlot(id, k, list())]));
  if (isNight()) return log('Too dark to work. Time to sleep.', 'warn');
  const uid0 = S.uid;
  const fx = craftSwitch(id, mode, pickd);
  if (!fx || CRAFTS[id]?.rinse) return;
  // everything handled together shares what's on it: the inputs still carried, what was made, my hands
  const handled = [...Object.values(pickd).filter(i => i && S.inv.includes(i)), ...S.inv.filter(i => i.uid >= uid0)].map(i => i.uid);
  perform(HANDLE, { handled, kill: KILL[id] ?? null }, { quiet: true });
}
function craftSwitch(id, mode, pickd) {
  switch (id) {
    case 'knap': {
      let { core, hammer } = pickd;
      if (core === hammer) {
        const other = ofKind('stone').find(i => i !== core);
        if (!other) return log('I need two stones: one to break and one to strike with.', 'warn');
        hammer = other;
        log(`Can’t strike a stone with itself; used the ${other.from.name} stone as the hammer.`);
      }
      const slab = ofKind('slab')[0];
      return perform(KNAP, { core, hammer, anvil: { props: { mass: slab ? 6000 : 1500 }, slab: !!slab } });
    }
    case 'pound': case 'grind': case 'chop': case 'roast': case 'leach': case 'soak': case 'dryfood': case 'stoneboil':
      return perform(PREPARE(id), { food: pickd.food, mode, stone: pickd.stone, edge: pickd.edge, stones: ofKind('stone') });
    case 'drill': return drill(pickd.board, pickd.spindle, mode === 'until');
    default: return perform(CRAFTS[id], { ...pickd, mode });
  }
}

// What a person would notice going wrong at the drill: the largest penalty in the performance score.
function drillTrouble(board, spindle) {
  const sk = S.body.skills.firecraft, b = board.props, sp = spindle.props;
  const pen = [
    [0.6 * -Math.log(Math.max(b.notch, 1e-3)), 'dust spills out of the ragged notch instead of piling up'],
    [-Math.log(Math.max(ROLES.hearth({ ...b, moisture: 0, resin: 0 }, sk), 1e-3)), 'the board is too hard; the socket only polishes and barely chars'],
    [-Math.log(Math.max(ROLES.hearth({ ...b, density: 0.3, resin: 0 }, sk), 1e-3)) - Math.log(Math.max(ROLES.spindle({ ...sp, straightness: 1, length: 70 }, sk), 1e-3)), 'the wood is damp; the smoke stays thin'],
    [-Math.log(Math.max(ROLES.spindle({ ...sp, moisture: 0, length: 70 }, sk), 1e-3)), 'the crooked spindle wobbles and skips out of the socket'],
    [-Math.log(Math.max(ROLES.hearth({ ...b, density: 0.3, moisture: 0 }, sk), 1e-3)), 'resin glazes the socket'],
    [0.4 * -Math.log(0.4 + 0.6 * b.socket), 'the new socket hasn’t burned in yet'],
    [-Math.log(Math.max(ROLES.spindle({ ...sp, moisture: 0, straightness: 1 }, sk), 1e-3)), 'the spindle is getting too short to spin well'],
  ].sort((a, b2) => b2[0] - a[0]);
  return pen[0][0] > 0.35 ? pen[0][1] : null;
}

// At the drill: one go after another (DRILL_ATTEMPT, acts.js) until an ember, a reason to stop, or
// (asked for one go) after the first; then one line for the lot, and the ember to the tinder (EMBER).
function drill(board, spindle, keepGoing) {
  const tally = {};
  let n = 0, stop = '', fx = null, glow = null;
  while (true) {
    if (!S.inv.includes(board)) { stop = 'the board has burned through'; break; }
    if (!S.inv.includes(spindle)) { stop = 'the spindle is worn too short'; break; }
    fx = perform(DRILL_ATTEMPT, { board, spindle }, { refusal: true });
    if (fx.refused) { stop = fx.refused; break; }
    n++;
    tally[fx.report.line] = (tally[fx.report.line] ?? 0) + 1;
    if (fx.report.ember != null) { glow = fx.report.ember; break; }
    if (!keepGoing) break;
  }
  const parts = Object.entries(tally).map(([k, v]) => (n > 1 ? `${v}× ${k}` : k));
  const trouble = n && glow == null && S.inv.includes(board) ? drillTrouble(board, spindle) : null;
  const tools = `with the ${spindle.from?.name ?? ''} spindle (${impressions(spindle).slice(0, 1).join('')}) on the ${board.from?.name ?? ''} board`;
  if (n) log(`${n > 1 ? `${n} attempts at the drill` : 'One attempt at the drill'} ${tools}: ${parts.join('; ')}.${trouble ? ` As far as I can tell, ${trouble}.` : ''}${stop ? ` Stopped: ${stop}.` : ''}`);
  else if (stop) log(`Can’t drill: ${stop}.`, 'warn');
  if (glow != null) return perform(EMBER, { ember: { props: { vigor: glow } }, tinder: ofKind('tinder')[0] ?? null, wood: ofKind('wood')[0] ?? null });
  return fx;
}

// ------------------------------------------------------------ survey: a formal count of what's in eyeshot

function shortDesc(e) {
  if (e.kind === 'stone') return e.cues.slice(0, 2).join('; ');
  if (e.kind === 'animal') return e.cues[0];
  const t = e.traits, b = [];
  b.push({ tree: 'tree', shrub: 'bush', herb: 'low plant', grass: t.habitat.moisture > 0.8 ? 'tall reed' : 'grass' }[t.form]);
  if (t.paperBark) b.push('papery white bark'); else if (t.resin > 0.5) b.push('resinous bark');
  if (t.umbel) b.push('umbrella-shaped flowers');
  if (t.squareStem) b.push('square stems');
  if (t.defense === 'stinging') b.push('stiff stinging hairs');
  if (t.defense === 'thorns') b.push('thorny');
  if (t.defense === 'silica') b.push('sharp-edged blades');
  const fruit = { berry: `${t.fruitColor} berries`, drupe: `${t.fruitColor} stonefruit`, nut: t.defense === 'tannin' ? 'acorn-like nuts' : 'nuts', pod: 'pods', seed: 'small seeds', grain: 'nodding seed heads' }[t.fruit];
  if (fruit) b.push(fruit);
  if (t.fluff) b.push('fluffy seed heads');
  if (t.spindleStalk && t.form === 'herb') b.push('tall dead stalks');
  if (b.length < 3) b.push(t.pace > 0.3 ? 'soft leaves' : t.pace < -0.3 ? 'leathery leaves' : 'plain leaves');
  return b.slice(0, 4).join(', ');
}
const memKeyE = e => e.lookalike?.mimics ?? e.id;
// What is present at a site (same abundance the field notes use), as { e, n }.
const presentAt = s => populationAt(S.world, s.micro, s.key, siteFactors(S.world.seed, s.key, S.world.environment.microhabitats.find(x => x.id === s.micro)), dice().place);
const noteKnown = (s, e) => knowIt(s, S.mem, e);

// ------------------------------------------------------------ poking around
//
// Turning stones and logs, peeling bark, prodding the leaf litter and dark corners of the underbrush.
// It finds what looking can't: grubs, beetles, worms, woodlice, crickets, snails, crayfish, and the small
// mushrooms of the litter, plus anything else small that lives here. A digging stick multiplies the
// ground covered by 1 + 1.5 × its hardness; poking blunts a soft stick faster than a hard one.
const bestStick = () => ofKind('diggingstick').sort((a, b) => b.props.hardness - a.props.hardness)[0] ?? null;
function pokeAround(s) {
  S.body.germs += 0.25 * (0.45 - S.body.germs); // soil and rot under the nails
  const stick = bestStick();
  const reach = stick ? 1 + 1.5 * stick.props.hardness : 1;
  const rows = [], fresh = [];
  noteTrail(S.mem, s.key);
  for (const { e, n } of presentAt(s)) {
    const small = (e.kind === 'animal' && e.cls === 'invertebrate') || e.cryptic;
    if (!small) continue;
    const p = 1 - Math.exp(-reach * n / (e.kind === 'animal' ? 25 : 10));
    if (!S.rng.chance(p)) continue;
    if (!S.mem.entities[memKeyE(e)]) fresh.push(e);
    rows.push({ n, text: lineFor(e, n) });
    noteKnown(s, e);
  }
  const bee = S.world.animals.find(a => a.traits.key === 'bee' && a.habitats.some(h => h.micro === s.micro));
  if (bee && !s.hive && ['woodland', 'deadfall', 'edge'].includes(s.micro) && S.rng.chance(0.25)) {
    s.hive = true; noteKnown(s, bee);
    rows.push({ n: 0.5, text: 'a hollow log humming with bees: a hive' });
  }
  if (stick) stick.props.hardness = Math.max(0.15, stick.props.hardness - 0.03 * (1 - stick.props.hardness));
  rows.sort((a, b) => b.n - a.n);
  const how = `turned stones and logs, peeled bark, prodded the litter${stick ? ' with the digging stick' : ' with my fingers'}`;
  const named = namingSentences(fresh, S.mem, s.key, entity, S.rng);
  log(rows.length ? `Poking around (${how}):\n${[...rows.map(r => r.text), ...named].join('\n')}` : `Poked around for half an hour (${how}); nothing worth having.`, 'survey');
}

const boneFinds = (s, effort) => findBones(S.world, s, effort, S.rng); // bones (acts.js)

// ------------------------------------------------------------ focused search

// Each focus matches only what the character can see. Returns a short detail string, or null.
const matOf = (e, cls) => S.mats.find(m => m.source === e.id && m.material === cls);
const FOCI = {
  spindle: { label: 'spindle wood', near: ['edge', 'woodland', 'glade'], nearLabel: 'bushes and tall plants',
    rank: e => (e.traits.spindleStalk ? 2 : 0),
    makeshift: e => e.kind === 'plant' && ['tree', 'shrub'].includes(e.form) ? 'only crooked dead twigs; would need a lot of trimming' : null, match: e => e.kind === 'plant' && (e.traits.spindleStalk && e.form === 'herb' ? 'tall, straight dead stalks' : e.form === 'shrub' && matOf(e, 'live-wood')?.props.straight ? 'straight shoots' : null) },
  hearth: { label: 'hearth-board wood', match: e => e.kind === 'plant' && ['tree', 'shrub'].includes(e.form) ? `fallen dead wood; ${e.cues.find(c => /bark/.test(c)) ?? 'bark unremarkable'}${e.traits.resin > 0.5 ? ' (resinous: poor for a hearth)' : ''}` : null,
    rank: e => (e.traits.resin > 0.5 ? -2 : 0) + (e.form === 'tree' ? 1 : 0),
    makeshift: e => e.kind === 'plant' && e.traits.spindleStalk && e.form === 'herb' ? 'thick dead stalks; a makeshift hearth at best' : null, near: ['woodland', 'edge'], nearLabel: 'trees' },
  stone: { label: 'stone for edges', near: ['outcrop', 'scree', 'streambed'], nearLabel: 'bare rock or gravel', rank: e => (/glassy|waxy/.test(e.cues[1]) ? 2 : /sugary/.test(e.cues[1]) ? 1 : 0), match: e => e.kind === 'stone' ? `${e.cues[1]}${/glassy|waxy|sugary/.test(e.cues[1]) ? ' (promising)' : ''}` : null },
  tinder: { label: 'tinder', near: ['glade', 'edge'], nearLabel: 'open grassy ground', rank: e => (e.traits?.paperBark ? 2 : e.traits?.fluff ? 1 : 0),
    makeshift: e => e.kind === 'plant' && ['tree', 'shrub'].includes(e.form) ? 'dead leaves and shredded bark, if dry' : e.form === 'moss' ? 'dry moss; weak alone' : null, match: e => e.kind === 'plant' && (e.traits.paperBark ? 'papery bark' : e.traits.fluff ? 'fluffy seed heads' : e.traits.tinderFungus ? 'hoof-shaped brackets, suede-like inside' : e.traits.sub === 'beard' ? 'dry, beard-like lichen' : e.form === 'grass' ? 'standing dry grass' : null) },
  fibre: { label: 'fibre', near: ['woodland', 'edge', 'streambank'], nearLabel: 'trees', rank: e => (e.traits?.fiberCue ? 1 : 0),
    makeshift: e => e.kind === 'plant' && e.form === 'grass' ? 'grass blades; weak but twistable' : null, match: e => e.kind === 'plant' && (e.traits.fiberCue ? 'long, stringy stems' : e.form === 'tree' ? 'inner bark (needs an edge to strip)' : null) },
  food: { label: 'food', near: ['edge', 'glade', 'streambank'], nearLabel: 'open, sunny ground', rank: e => (e.traits?.fruit === 'nut' ? 2 : ['berry', 'drupe'].includes(e.traits?.fruit) ? 1 : 0),
    makeshift: e => e.kind === 'plant' && e.form !== 'tree' && e.traits.pace > 0.2 ? 'soft leaves; barely food' : null, match: e => e.cryptic ? null : (e.kind === 'plant' && (e.form === 'mushroom' && e.parts[0]?.food ? 'mushrooms' : null) || e.kind === 'plant' && ({ berry: `${e.traits.fruitColor} berries`, drupe: `${e.traits.fruitColor} stonefruit`, nut: 'nuts', pod: 'pods', grain: 'seed heads' }[e.traits.fruit] ?? (e.traits.defense === 'sulfur' ? 'onion-like leaves' : null))) || (e.traits?.key === 'bee' ? 'follow them home: a hive means honey' : e.kind === 'animal' && e.food && e.food.cooked !== undefined ? 'small creatures to gather' : null) },
  bones: { label: 'bones', special: true, near: ['glade', 'outcrop', 'scree', 'streambed'], nearLabel: 'open ground, where bones would show' },
  sharp: { label: 'naturally sharp stone', special: true },
  game: { label: 'game sign', special: true },
};

// Point to the nearest place of the right kind for a focus, and remember it as somewhere to go.
function pointNear(s, F, lines) {
  let best = null;
  for (let r = 2; r <= 12 && !best; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = s.x + dx, y = s.y + dy;
    if (x < 0 || y < 0 || x >= GN || y >= GN) continue;
    if (F.near.includes(S.L.micro[cellOf(x, y)]) && (!best || Math.hypot(dx, dy) < best.d)) best = { x, y, d: Math.hypot(dx, dy) };
  }
  if (best) {
    const dir = bearingWord(bearing(s, best));
    let u = S.suspects.find(v => v.kind === 'patch' && Math.hypot(v.truePos.x - best.x, v.truePos.y - best.y) < 3);
    if (!u) S.suspects.push(u = { id: `u${S.suspects.length + 1}`, kind: 'patch', group: 'patch', trueKey: `patch-${best.x}-${best.y}`, truePos: { x: best.x, y: best.y }, est: { x: best.x, y: best.y }, err: 0.5, seenAt: { x: s.x, y: s.y }, channel: 'sight', obs: 1, label: uniqueName(SITE_NOUN[microAt(best.x, best.y)] ?? 'patch'), reached: false });
    lines.push(`nothing here, but ${F.nearLabel} ${timeWords(lineHours(S.L, s, best))} ${dir} (${u.label})`);
  } else lines.push(`nothing here, and no ${F.nearLabel} anywhere close`);
}

// ------------------------------------------------------------ looking for something in particular
//
// S.looking = { type, key, label }: a category of useful thing (FOCI), a thing I know by name, or
// something in the distance (water, high ground). Looking runs the matching action: a focused survey
// for visible things, a focused poke for things under stuff, a focused scan for the distance. It runs
// in full where I stand, and lightly in each patch I pass through while travelling, until I stop.
function startLooking(spec) {
  const [type, key] = spec.split(':');
  const label = type === 'focus' ? FOCI[key].label : type === 'entity' ? pluralize(entity(key).name) : key === 'water' ? 'water' : 'high ground';
  S.looking = { type, key, label };
  S.body.focus = clamp(S.body.focus - 0.03);
  lookHere(site(), false);
}
// Returns lines found; `passing` is the light version used on the move (no pointers, no "nothing").
function lookAt(s, passing) {
  const T = S.looking, lines = [];
  if (!T) return lines;
  if (T.type === 'distant') {
    for (const c of perceive(S.L, s, { time: timeOfDay(), sky: skyView(), boost: passing ? 1.2 : 1.6, lookout: !passing && isLookout(S.L, s.x, s.y) })) {
      const want = T.key === 'water' ? isWaterKind(c.kind) : ['hill', 'cliff'].includes(c.kind);
      if (!want) continue;
      const { sus, isNew, g } = associate(c, s);
      if (isNew) lines.push(`${cuePhrase(c, g, s)} (${sus.another ?? sus.label})`);
      else if (!passing) lines.push(`${sus.label} again, to the ${bearingWord(bearing(s, sus.est))}`);
    }
    if (!passing && T.key === 'high' && isLookout(S.L, s.x, s.y)) lines.unshift('this spot gives a view: worth looking out from');
    if (!passing && T.key === 'water' && waterHere(s)) lines.unshift('water right here');
    return lines;
  }
  if (T.type === 'entity') {
    const e = entity(T.key), hit = presentAt(s).find(r => r.e.id === e.id || r.e.lookalike?.mimics === e.id);
    if (hit) {
      const stick = bestStick(), reach = stick ? 1 + 1.5 * stick.props.hardness : 1;
      const p = e.cryptic ? 1 - Math.exp(-reach * hit.n / (e.kind === 'animal' ? 15 : 6)) : 0.92; // looking hard under things beats a general poke
      if (S.rng.chance(p)) {
        lines.push(lineFor(hit.e, hit.n)); noteKnown(s, hit.e);
        if (e.traits?.key === 'bee' && !s.hive && ['woodland', 'deadfall', 'edge'].includes(s.micro) && S.rng.chance(0.5)) { s.hive = true; lines.push('followed them to a hollow tree humming with bees: a hive'); }
      }
    }
    return lines;
  }
  const F = FOCI[T.key];
  if (T.key === 'game') {
    for (const a of S.world.animals.filter(a => a.cls !== 'invertebrate' && a.signs && a.habitats.some(h => h.micro === s.micro))) {
      if (!S.rng.chance(1 - Math.exp(-a.perKm2 * (passing ? 0.25 : 0.45)))) continue;
      const known = S.mem.entities[memKeyE(a)];
      for (const sign of [a.signs.track && `${a.signs.track.type}, about ${a.signs.track.lengthCm} cm`, a.signs.scat, a.signs.damage].filter(Boolean)) if (S.rng.chance(0.6)) lines.push(`${sign}${known ? ` (${a.name})` : ''}`);
    }
  } else if (T.key === 'bones') {
    lines.push(...boneLines(boneFinds(s, passing ? 0.5 : 1)));
    if (!passing && !lines.length) { if (F.near.includes(s.micro)) lines.push('none here'); else pointNear(s, F, lines); }
  } else if (T.key === 'sharp') {
    const here = presentAt(s).map(r => r.e.id);
    const m = S.mats.find(x => x.material === 'natural-edge' && here.includes(x.source));
    if (m) {
      const res = searchNaturalEdge(S.rng, S.body, { props: m.props, provenance: { name: m.sourceName, source: m.source } });
      if (res.flake) {
        addItem(`natural edge, ${m.sourceName}`, 'edge', res.flake.props, { id: m.source, name: m.sourceName, part: 'natural edge', site: s.key });
        lines.push(`a piece of broken ${m.sourceName} with a usable edge; took it`);
        if (!S.milestones.edge) { S.milestones.edge = true; log('My first cutting edge.', 'milestone'); }
      } else if (!passing) lines.push(`broken ${m.sourceName} stone, but nothing sharp enough`);
    } else if (!passing) pointNear(s, { near: ['scree', 'outcrop'], nearLabel: 'broken rock' }, lines);
  } else {
    const here = presentAt(s).filter(r => !r.e.cryptic);
    let rows = here.map(({ e, n }) => ({ e, n, detail: F.match(e) })).filter(r => r.detail);
    let makeshift = false;
    if (!passing && !rows.length && F.makeshift) { rows = here.map(({ e, n }) => ({ e, n, detail: F.makeshift(e) })).filter(r => r.detail); makeshift = rows.length > 0; }
    rows.sort((a, b) => ((F.rank?.(b.e) ?? 0) - (F.rank?.(a.e) ?? 0)) || (b.n - a.n));
    rows.forEach((r, i) => { lines.push(`${lineFor(r.e, r.n)}: ${r.detail}${i === 0 && rows.length > 1 ? ' (best bet here)' : ''}`); noteKnown(s, r.e); });
    if (makeshift) lines.unshift('nothing proper; the best of a bad lot:');
    if (!passing && !rows.length && F.near) pointNear(s, F, lines);
  }
  return lines;
}
function lookHere(s) {
  noteTrail(S.mem, s.key);
  const before = new Set(Object.keys(S.mem.entities));
  const lines = lookAt(s, false);
  const fresh = Object.keys(S.mem.entities).filter(k => !before.has(k)).map(entity).filter(Boolean);
  lines.push(...namingSentences(fresh, S.mem, s.key, entity, S.rng));
  log(`Looking for ${S.looking.label}:\n${lines.length ? lines.join('\n') : 'nothing here'}`, 'survey');
}
// While looking, glance over each patch passed on the way (about every 500 m). Finds become places.
function lookAlong(path) {
  if (!S.looking || path.length < 7) return;
  for (let i = 6; i < path.length - 2; i += 6) {
    const p = path[i];
    const probe = { x: p.x, y: p.y, micro: microAt(p.x, p.y), key: `p${p.x}_${p.y}`, known: new Set() };
    const lines = lookAt(probe, true);
    if (!lines.length) continue;
    const ms = newSite(p.x, p.y);
    for (const id of probe.known) ms.known.add(id);
    if (probe.bones) ms.bones = probe.bones;
    log(`On the way, at ${ms.name}: ${lines.join('; ')}.`, 'note');
  }
}

// Signals that break through a narrow focus: water, big animals, ripe-looking fruit.
function breakthroughs(s, focus) {
  if (focus !== 'food') {
    S.fruitNoted ??= {};
    const fruit = presentAt(s).find(({ e }) => e.kind === 'plant' && ['berry', 'drupe'].includes(e.traits.fruit) && !S.fruitNoted[e.id] && S.rng.chance(0.6));
    if (fruit) { S.fruitNoted[fruit.e.id] = true; log(`Even so, I couldn’t miss ${fruit.e.traits.fruitColor} fruit on ${S.mem.entities[memKeyE(fruit.e)] ? `the ${fruit.e.name}` : `a bush I haven’t named (${shortDesc(fruit.e)})`}.`, 'note'); noteKnown(s, fruit.e); }
  }
  const big = S.world.animals.filter(a => a.cls === 'large' && !a.signs?.distant && a.habitats.some(h => h.micro === s.micro)).find(a => S.rng.chance(1 - Math.exp(-a.perKm2 * 0.06)));
  if (big) {
    const known = S.mem.entities[memKeyE(big)];
    log(known ? `A ${big.name} crashed away through the brush ahead.` : `Something big crashed away through the brush ahead: a ${firstCueA(big)}.`, 'note');
  }
}
const firstCueA = a => `${a.traits.color} ${{ browser: 'long-legged hoofed animal', rooter: 'stocky bristled animal', predator: a.traits.pack ? 'doglike hunter' : 'catlike hunter' }[a.traits.key] ?? 'animal'}`;

// ------------------------------------------------------------ inspect and assess

function knownHere() {
  return [...site().known].map(entity).filter(Boolean).filter(e => !(e.kind === 'animal' && e.cls !== 'invertebrate'))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'plant' ? -1 : 1));
}
function learnedAbout(e) {
  const out = [];
  for (const it of S.inv.filter(i => i.from?.id === e.id)) for (const [k, v] of Object.entries(it.notes)) out.push(`${k.toLowerCase()} on the ${it.from.part}: ${v}`);
  for (const [k, l] of Object.entries(S.lore)) if (k.startsWith(`${e.lookalike?.mimics ?? e.id}:`)) out.push(`the ${k.split(':')[1]} ${loreWords(l)}`);
  return [...new Set(out)];
}
function inspect(e) {
  const parts = e.kind === 'plant' ? e.parts.map(p => p.part) : e.kind === 'stone' ? [] : e.products;
  const learned = learnedAbout(e);
  log(`Looked closely at the ${e.name}: ${e.cues.filter(c => !/^active:/.test(c)).join('; ')}.${parts.length ? ` Parts worth noting: ${parts.join(', ')}.` : ''}${learned.length ? ` What I’ve learned: ${learned.join('; ')}.` : ''}`, 'note');
}

// The character's educated guess from what's visible plus anything already learned. Costs focus.
function assess(e) {
  if (S.body.focus < 0.25) return log('Too foggy to think it through. I need rest, water or food first.', 'warn');
  S.body.focus = clamp(S.body.focus - 0.08);
  const cues = e.cues.join(' | ');
  const uses = [], risks = [], tests = [];
  const on = (re, list, text) => { if (re.test(cues)) list.push(text); };
  if (e.kind === 'plant') {
    const woody = ['tree', 'shrub'].includes(e.form);
    if (woody) { uses.push('dead wood for fuel; if it’s light and soft, a fire-drill hearth board'); tests.push('thumbnail-and-heft test on its dead wood'); }
    if (e.form === 'shrub') uses.push('straight shoots might make spindles once dry');
    on(/papery/, uses, 'papery bark: excellent tinder, burns even damp; containers');
    on(/resin/, uses, 'resin: glue and fire-starter (resinous wood makes a poor hearth board)');
    on(/dead stalks/, uses, 'straight dead stalks: ready-made fire-drill spindles');
    on(/stringy/, uses, 'stringy stems: fibre for cordage'); on(/stringy/, tests, 'twist test on the stems');
    on(/fluff/, uses, 'seed fluff: tinder');
    on(/cutting edges|grass/i, uses, 'dry blades for tinder and bedding');
    on(/umbrella/, risks, 'umbrella-flowered plants include some of the deadliest there are; I wouldn’t eat this without great care');
    on(/square stems/, uses, 'square stems and paired leaves: the mint family is mostly safe');
    on(/square stems/, tests, 'crush and smell');
    on(/stiff hairs/, risks, 'stinging hairs; cooking usually neutralizes them');
    on(/thorns/, uses, 'thorns: hooks and barriers');
    on(/clustered, raspberry-like/, uses, 'clustered berries like these are usually safe');
    on(/(white|yellow) berries/, risks, 'pale berries are often poisonous');
    on(/round, glossy (red|black|blue-black|orange) berries/, risks, 'unfamiliar berries: possibly fine, possibly not');
    on(/single hard stone/, uses, 'ripe stonefruit flesh is usually safe; the stones themselves often aren’t');
    on(/acorn/, uses, 'acorn-like nuts: rich food once leached of their bitterness');
    on(/husked nuts/, uses, 'nuts: rich, keeping food');
    on(/pods/, risks, 'pod seeds often need cooking to be safe');
    on(/nodding seed heads/, uses, 'grass seed: safe food, but slow to gather and grind');
    on(/grass-like leaves rising/, tests, 'crush and smell: an onion smell means wild onion; no smell, beware');
    if (!/grass/.test(e.form) && !/stonefruit|nuts|seed heads/.test(cues)) tests.push('skin contact, then a staged taste test, before eating any of it');
  } else if (e.kind === 'stone') {
    on(/glassy|waxy|glow/, uses, 'glassy or waxy stone may knap well into sharp flakes');
    on(/sugary|tough, fine-grained/, uses, 'tough stone: workable for flakes and a good hammerstone');
    on(/gritty/, uses, 'gritty stone: grinding and abrasion, poor for edges');
    on(/flat slabs|split cleanly/, uses, 'flat slabs: an anvil, or a deadfall trap');
    on(/crumbly/, risks, 'crumbly stone: useless for tools');
    on(/rusty|ochre/, uses, 'ochre: pigment');
    tests.push('test break, to see how it fractures', 'ring test, to find hidden cracks', 'scratch test, to judge hardness for a hammer');
  } else {
    on(/warning colours|warning colors/, risks, 'bold warning colours: likely toxic; avoid eating');
    on(/bristly hairs/, risks, 'bristly hairs can irritate skin and gut');
    on(/grub/, uses, 'grubs: low risk and very nourishing, best cooked');
    on(/slime|snail/, risks, 'snails carry parasites: cook thoroughly');
    on(/shells|mussel|shellfish/, uses, 'shellfish: good food; shells make scrapers and edges');
    on(/claws/, risks, 'pinching claws');
    if (!uses.length && !risks.length) uses.push('a small source of meat; cook it');
  }
  const learned = learnedAbout(e);
  const txt = [`Thinking about the ${e.name}.`,
    uses.length ? `Likely uses: ${uses.join('; ')}.` : 'Nothing obviously useful comes to mind.',
    risks.length ? `Risks: ${risks.join('; ')}.` : '',
    tests.length ? `Worth trying: ${[...new Set(tests)].join('; ')}.` : '',
    learned.length ? `What I already know: ${learned.join('; ')}.` : ''].filter(Boolean).join(' ');
  log(txt, 'thought');
}

// ------------------------------------------------------------ the picker (collect, inspect, assess)

let picker = null; // { kind: 'collect' | 'inspect' | 'assess', step: 'root' | 'part' | 'species', value }
function pickerHTML() {
  const s = site();
  if (picker.kind === 'collect') {
    const opts = gatherOptions(s);
    let title, buttons;
    if (picker.step === 'root') {
      const parts = [...new Set(opts.map(o => o.part))], species = [...new Set(opts.map(o => o.species))];
      title = 'Collect';
      buttons = opts.length ? `<h4>By part</h4><div class="gather">${parts.map(p => `<button data-pk="part" data-v="${esc(p)}">${esc(typo(p))}</button>`).join('')}</div>
        <h4>By species</h4><div class="gather">${species.map(x => `<button data-pk="species" data-v="${esc(x)}">${esc(typo(cap(x)))}</button>`).join('')}</div>`
        : '<p class="hint">Nothing noticed here that I can take. Survey first.</p>';
    } else {
      const list = opts.map((o, i) => [o, i]).filter(([o]) => (picker.step === 'part' ? o.part === picker.value : o.species === picker.value));
      title = picker.step === 'part' ? `Collect: ${picker.value}` : `Collect from the ${picker.value}`;
      buttons = `<div class="gather">${list.map(([o, i]) => `<button data-gather="${i}"${o.blocked || isNight() ? ' disabled' : ''}>${esc(typo(picker.step === 'part' ? cap(o.species) : o.part))}${o.label.includes(' · ') ? `<small>${esc(typo(o.label.split(' · ')[1]))}</small>` : ''}${o.blocked ? `<small>${esc(o.blocked)}</small>` : ''}</button>`).join('')}</div>`;
    }
    return pickerFrame(title, buttons);
  }
  if (picker.kind === 'make') return pickerFrame('Make', makeHTML());
  if (picker.kind === 'rest') return pickerFrame('Rest', `<div class="gather">${restOptions().map(([v, l]) => `<button data-rest="${v}">${esc(l)}</button>`).join('')}</div>`);
  if (picker.kind === 'look') {
    const known = Object.keys(S.mem.entities).map(entity).filter(e => e && !(e.kind === 'animal' && e.cls !== 'invertebrate')).sort((a, b) => a.name.localeCompare(b.name));
    const btn = (type, key, label) => `<button data-look="${type}:${key}">${esc(typo(cap(label)))}</button>`;
    return pickerFrame('Look for…', `<p class="hint">Half an hour here, then I keep an eye out in every patch I pass through until I stop looking. It slows travel a little.</p>
      <h4>Things to use</h4><div class="gather">${Object.entries(FOCI).map(([k, F]) => btn('focus', k, F.label)).join('')}</div>
      ${known.length ? `<h4>Things I know</h4><div class="gather">${known.map(e => btn('entity', e.id, pluralize(e.name))).join('')}</div>` : ''}
      <h4>In the distance</h4><div class="gather">${btn('distant', 'water', 'water')}${btn('distant', 'high', 'high ground')}</div>`);
  }
  const list = knownHere();
  const sub = '<p class="hint">A close look, then my best guess at uses, risks and useful tests (costs a little focus).</p>';
  return pickerFrame('Inspect', sub + (list.length ? `<div class="gather">${list.map(e => `<button data-${picker.kind}="${e.id}">${esc(typo(cap(e.name)))}</button>`).join('')}</div>` : '<p class="hint">Nothing noticed here yet. Survey first.</p>'));
}
function makeHTML() {
  const ready = RECIPES.filter(R => R.ready());
  return ready.length ? ready.map(R => `<div class="recipe"><h4>${esc(R.name)}</h4><p class="hint">${esc(typo(R.blurb))}</p>
      ${R.slots.map(([k, label, list]) => { const L = list(); const cur = pickSlot(R.id, k, L); return `<label>${esc(label)} <select data-slot="${R.id}:${k}">${L.map(i => `<option value="${i.uid}"${i === cur ? ' selected' : ''}>${esc(typo(i.name))}${impressions(i).length ? ` (${esc(typo(impressions(i).slice(0, 2).join(', ')))})` : ''}</option>`).join('')}</select></label>`; }).join('')}
      <div class="row">${(R.modes ?? [['go', 'Do it']]).map(([m, l]) => `<button data-craft="${R.id}" data-mode="${m}"${isNight() ? ' disabled' : ''}>${esc(l)}</button>`).join('')}</div></div>`).join('')
    : '<p class="hint">Nothing I can make with what I’m carrying. Gather materials, and think through a goal to see what’s needed.</p>';
}
// Rest: short rests recover some fatigue, sore hands and focus; "until morning" is a night's sleep.
function restOptions() {
  const O = [];
  if (!isNight()) O.push(['1', 'An hour'], ['2', 'Two hours']);
  else O.push(['1', 'An hour']);
  if (!isNight() && S.t < sunsetAt(S.day) - 0.5 && S.t >= 5) O.push(['dusk', 'Until dusk']);
  O.push(['morning', isNight() || S.t >= sunsetAt(S.day) ? 'Sleep until morning' : 'Until morning (skips the day)']);
  return O;
}
function restFor(choice) {
  if (choice === 'morning') return sleep();
  perform(REST, { hours: choice === 'dusk' ? sunsetAt(S.day) - S.t : Number(choice), dusk: choice === 'dusk' });
}
// ------------------------------------------------------------ the land under the map
//
// The landscape drawn as tools/render-landscapes.py draws it (shaded relief, grass to forest, bare
// steep ground, streams and lakes), one pixel per cell, faded in only where I've seen the land: what
// was in view from each place I've stood (by the same sightlines that decide what landmarks I see, so
// a long way over open ground, little in thick forest, nothing behind a ridge), more from a lookout,
// and the ground close along the way I walked. S.mapLand: 'seen' (the default), 'all' (the whole
// map, which gives the game away), 'off'.
const waterUp = (x, y) => { const c = cellOf(x, y); return S.L.lake[c] ? S.L.filled[c] - S.L.elev[c] : 0; }; // a lake's surface stands above its bed: sight aims at the water
function markSeen(x, y, r, view = null) { // view: { eye } to reveal only what's in sight out to r
  S.seenLand ??= new Uint8Array(GN * GN);
  if (view) { const k = skyNow(); r = Math.max(2, Math.round(Math.min(r, k.visibility / CELL) * (0.2 + 0.8 * seeingFar(k.lux)))); } // less by night, in fog or rain
  let changed = false;
  const at = { x: Math.round(x), y: Math.round(y) };
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = at.x + dx, ny = at.y + dy, d = Math.hypot(dx, dy) / r;
    if (nx < 0 || ny < 0 || nx >= GN || ny >= GN || d > 1) continue;
    let k = Math.min(1, 3.3 * (1 - d)); // full strength over the inner 70%, then a soft edge
    if (view && d * r > 2) k *= Math.min(1, 1.5 * sightline(S.L, at, { x: nx, y: ny }, view.eye, waterUp(nx, ny) + 0.5));
    const v = Math.round(255 * k), c = cellOf(nx, ny);
    if (v > S.seenLand[c]) { S.seenLand[c] = v; changed = true; }
  }
  if (changed) S.seenVer = (S.seenVer ?? 0) + 1;
}
const canDraw = typeof document !== 'undefined' && typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent);
function landImage() {
  const mode = S.mapLand ?? 'seen';
  if (mode === 'off' || !canDraw) return null;
  for (const t of S.sites) if (!S.seenLand?.[cellOf(t.x, t.y)]) markSeen(t.x, t.y, 20, { eye: 1.7 });
  const key = `${mode}/${S.seenVer ?? 0}`;
  if (S.landMemo?.key === key) return S.landMemo.url;
  const cv = document.createElement('canvas'); cv.width = cv.height = GN;
  const ctx = cv.getContext('2d'); if (!ctx) return null;
  const img = ctx.createImageData(GN, GN), L = S.L, at = (x, y) => L.elev[cellOf(clamp(x, 0, GN - 1), clamp(y, 0, GN - 1))];
  const CH = [[110, 160, 205], [70, 125, 195], [40, 95, 180]];
  for (let y = 0; y < GN; y++) for (let x = 0; x < GN; x++) {
    const c = cellOf(x, y), shade = Math.max(0.35, Math.min(1.25, 1 - (at(x + 1, y) - at(x - 1, y) + at(x, y + 1) - at(x, y - 1)) / 60)); // lit from the northwest
    const v = L.veg[c];
    let col = L.slope[c] > 0.35 ? [150, 140, 130] : [214 - 120 * v, 200 - 60 * v, 150 - 90 * v]; // bare rock; tan grass to dark forest
    col = col.map(k => k * shade);
    if (L.lake[c]) col = [90, 140, 190]; else if (L.chan[c]) col = CH[L.chan[c] - 1];
    img.data.set([...col.map(k => clamp(Math.round(k), 0, 255)), mode === 'all' ? 255 : S.seenLand?.[c] ?? 0], 4 * c);
  }
  ctx.putImageData(img, 0, 0);
  S.landMemo = { key, url: cv.toDataURL() };
  return S.landMemo.url;
}
// ------------------------------------------------------------ lakes and cliffs as I've seen them
//
// Lakes are areas and cliffs are lines on my map, drawn from the cells of them I've seen (the same
// sight-based record as the land underlay), grouped into connected pieces. A lake piece is shaded in;
// a cliff piece is a line along it, with ticks on its downhill side. Each is named when I first see
// it (in game logic, so names don't depend on how often the map is drawn), and a tap on one heads for
// its nearest part. Lakes keep the names they go by in the journal; a cliff takes the name of the
// cliff I'd already spotted there, if any.
const SEEN = 128; // how clearly a cell must have been seen to go on the map
const isCliff = c => S.L.slope[c] > 0.35;
function cliffIndex() { // cell -> index in landscape's escarpments (as in the landmark keys cliff-i), or -1
  if (S.L._escOf) return S.L._escOf;
  const esc = new Int16Array(GN * GN).fill(-1), seen = new Uint8Array(GN * GN);
  for (let c0 = 0; c0 < GN * GN; c0++) {
    if (!isCliff(c0) || seen[c0]) continue;
    const g = [c0]; seen[c0] = 1;
    for (let k = 0; k < g.length; k++) for (const [dx, dy] of NB8) { const x = (g[k] % GN) + dx, y = Math.floor(g[k] / GN) + dy, n = cellOf(x, y); if (x >= 0 && y >= 0 && x < GN && y < GN && !seen[n] && isCliff(n)) { seen[n] = 1; g.push(n); } }
    const cx = g.reduce((a, c) => a + (c % GN), 0) / g.length, cy = g.reduce((a, c) => a + Math.floor(c / GN), 0) / g.length;
    const i = S.L.features.escarpments.findIndex(e => e.cells === g.length && e.x === Math.round(cx) && e.y === Math.round(cy)); // landscape.js rounds its centroids
    if (i >= 0) for (const c of g) esc[c] = i;
  }
  return (S.L._escOf = esc);
}
// Seeing a lake or a cliff as a landmark shows me how it lies: the cells of it in my line of sight,
// out to sight range (a cliff face stands up, so it shows where flat ground wouldn't).
function revealFeature(key, from, eye, fromEdge = false) {
  const esc = cliffIndex(), cliff = key.startsWith('cliff-'), want = cliff ? +key.slice(6) : key;
  S.seenLand ??= new Uint8Array(GN * GN);
  const k = skyNow(), reach = Math.min(4000, k.visibility) * seeingFar(k.lux); // by night or in fog, only what's close
  let changed = false;
  for (let c = 0; c < GN * GN; c++) {
    if (cliff ? esc[c] !== want : !(S.L.lake[c] && waterKeyAt(S.L, c % GN, Math.floor(c / GN)) === want)) continue;
    if (S.seenLand[c] >= 255) continue;
    const q = { x: c % GN, y: Math.floor(c / GN) };
    if (Math.hypot(q.x - from.x, q.y - from.y) * CELL > reach) continue;
    if (sightline(S.L, { x: Math.round(from.x), y: Math.round(from.y) }, q, eye, cliff ? 8 : waterUp(q.x, q.y) + 0.5, { fromEdge }) > 0.1) { S.seenLand[c] = 255; changed = true; }
  }
  if (changed) S.seenVer = (S.seenVer ?? 0) + 1;
}
// Name lakes and cliffs I can now see. Called wherever the seen land grows.
function noteSeenFeatures() {
  if ((S.namedVer ?? -1) === (S.seenVer ?? 0)) return;
  S.namedVer = S.seenVer ?? 0;
  const esc = cliffIndex();
  S.cliffNames ??= {};
  for (let c = 0; c < GN * GN; c++) {
    if ((S.seenLand?.[c] ?? 0) < SEEN) continue;
    const x = c % GN, y = Math.floor(c / GN);
    if (S.L.lake[c]) { const key = waterKeyAt(S.L, x, y); if (!S.waterNames[key]) waterName(key, 'lake', { x, y }); }
    else if (esc[c] >= 0 && !S.cliffNames[`cliff-${esc[c]}`]) {
      const key = `cliff-${esc[c]}`, u = S.suspects.find(v => v.trueKey === key);
      S.cliffNames[key] = u ? u.label : uniqueName('cliff');
    }
  }
}
// Connected pieces of seen cells passing `test`, each with its true key. Memoized on the seen land.
function seenPieces(kind) {
  const memo = `${kind}/${S.seenVer ?? 0}`;
  if (S.pieceMemo?.[kind]?.key === memo) return S.pieceMemo[kind].pieces;
  const esc = cliffIndex(), test = kind === 'lake' ? c => S.L.lake[c] : c => esc[c] >= 0, done = new Uint8Array(GN * GN), pieces = [];
  for (let c0 = 0; c0 < GN * GN; c0++) {
    if (done[c0] || !test(c0) || (S.seenLand?.[c0] ?? 0) < SEEN) continue;
    const g = [c0]; done[c0] = 1;
    for (let k = 0; k < g.length; k++) for (const [dx, dy] of NB8) { const x = (g[k] % GN) + dx, y = Math.floor(g[k] / GN) + dy, n = cellOf(x, y); if (x >= 0 && y >= 0 && x < GN && y < GN && !done[n] && test(n) && (S.seenLand[n] ?? 0) >= SEEN && (kind === 'lake' || esc[n] === esc[c0])) { done[n] = 1; g.push(n); } }
    if (kind === 'cliff' && g.length < 3) continue; // fewer cells than that reads as a blot, not a line: the landmark ring stands for it
    const cells = g.map(c => ({ x: c % GN, y: Math.floor(c / GN) })), key = kind === 'lake' ? waterKeyAt(S.L, cells[0].x, cells[0].y) : `cliff-${esc[c0]}`;
    pieces.push({ id: `${kind}:${cells[0].x}_${cells[0].y}`, kind, key, cells, name: (kind === 'lake' ? S.waterNames[key] : S.cliffNames?.[key]) ?? `the ${kind}`, x: cells.reduce((a, q) => a + q.x, 0) / cells.length, y: cells.reduce((a, q) => a + q.y, 0) / cells.length });
  }
  (S.pieceMemo ??= {})[kind] = { key: memo, pieces };
  return pieces;
}
// A cliff piece as a line: its cells ordered along their main axis, averaged in short bins, with a
// tick on the downhill side at each bend.
function cliffLine(piece) {
  const { cells } = piece, mx = piece.x, my = piece.y;
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of cells) { sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; sxy += (q.x - mx) * (q.y - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang), along = q => (q.x - mx) * ux + (q.y - my) * uy;
  const bins = new Map();
  for (const q of cells) { const b = Math.round(along(q) / 2.5); const a = bins.get(b) ?? { x: 0, y: 0, n: 0 }; a.x += q.x; a.y += q.y; a.n++; bins.set(b, a); }
  const pts = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, a]) => ({ x: a.x / a.n, y: a.y / a.n }));
  if (pts.length === 1) pts.unshift({ x: pts[0].x - ux, y: pts[0].y - uy }), pts.push({ x: pts[1].x + ux * 2, y: pts[1].y + uy * 2 });
  const el = (x, y) => S.L.elev[cellOf(clamp(Math.round(x), 0, GN - 1), clamp(Math.round(y), 0, GN - 1))];
  const down = el(mx - uy * 3, my + ux * 3) < el(mx + uy * 3, my - ux * 3) ? 1 : -1; // which side of the line is lower
  return { pts, nx: -uy * down, ny: ux * down };
}
function headForFeature(id) {
  const kind = id.split(':')[0], piece = seenPieces(kind).find(q => q.id === id), from = site();
  if (!piece) return;
  const near = piece.cells.reduce((a, q) => (Math.hypot(q.x - from.x, q.y - from.y) < Math.hypot(a.x - from.x, a.y - from.y) ? q : a));
  travelTo({ x: near.x, y: near.y, [kind]: piece.key, label: piece.name }, `toward ${piece.name}`);
}

const LAND_MODES = { seen: 'Land: as I’ve seen it', all: 'Land: the whole map', off: 'Land: none' };

// The Map: tap a place or landmark to hike there; tap a sequence of them to choose a route.
// Text and markers keep one size on screen whatever the zoom or the size of the window: labels are
// MAP_PX screen pixels, fs is that size in grid cells, and everything else is drawn in fs.
const MAP_PX = 15;
function mapSide() { // the side, in screen pixels, of the square the map is drawn in
  const r = document.querySelector('#map .mapsvg')?.getBoundingClientRect(), side = r ? Math.min(r.width, r.height) : 0;
  return side > 0 ? side : Math.min(document.querySelector('#map')?.clientWidth || 400, 576);
}
let measureCtx = null;
function textWidth(fs) { // label width in map units, at label size fs
  if (canDraw && !measureCtx) { measureCtx = document.createElement('canvas').getContext('2d'); if (measureCtx) measureCtx.font = `${MAP_PX}px Archivo, "Helvetica Neue", Arial, sans-serif`; }
  return t => (measureCtx ? measureCtx.measureText(t).width / MAP_PX : 0.56 * t.length) * fs;
}
// A lake as I picture it: circles on the parts of it I've seen, each as big as fits inside the lake's
// shore there, so together they round out into its shape without showing the grid. Biggest first;
// a circle is added for any seen cell not yet inside one, its centre nudged a little (fixed per cell)
// so the edge looks natural.
function lakeDistance() { // for each lake cell, the distance (in cells) from its centre to the nearest dry cell's edge
  if (S.L._lakeDist) return S.L._lakeDist;
  const D = new Float32Array(GN * GN);
  for (let c = 0; c < GN * GN; c++) {
    if (!S.L.lake[c]) continue;
    const x = c % GN, y = Math.floor(c / GN);
    let best = 16;
    for (let r = 1; r < best; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if ((nx < 0 || ny < 0 || nx >= GN || ny >= GN || !S.L.lake[cellOf(nx, ny)]) && Math.hypot(dx, dy) < best) best = Math.hypot(dx, dy);
    }
    D[c] = best - 0.5;
  }
  return (S.L._lakeDist = D);
}
function lakeShapes() {
  const memo = `${S.seenVer ?? 0}`;
  if (S.lakeMemo?.key === memo) return S.lakeMemo.lakes;
  const D = lakeDistance(), by = new Map();
  for (const q of seenPieces('lake')) { const e = by.get(q.key) ?? { key: q.key, name: q.name, id: q.id, cells: [] }; e.cells.push(...q.cells); by.set(q.key, e); }
  const lakes = [...by.values()].map(e => {
    const jit = (x, y, k) => (((Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453) % 1) + 1) % 1 - 0.5;
    const order = [...e.cells].sort((p, q) => D[cellOf(q.x, q.y)] - D[cellOf(p.x, p.y)] || p.y - q.y || p.x - q.x);
    const circles = [];
    for (const c of order) {
      if (circles.some(k => Math.hypot(k.x - c.x, k.y - c.y) <= k.r)) continue;
      const r = Math.max(0.6, D[cellOf(c.x, c.y)]), j = Math.min(0.35, r * 0.2);
      circles.push({ x: c.x + jit(c.x, c.y, 1) * j, y: c.y + jit(c.x, c.y, 2) * j, r: r * (0.92 + 0.16 * (jit(c.x, c.y, 3) + 0.5)) });
    }
    const big = circles[0];
    return { ...e, circles, x: big.x, y: big.y };
  });
  S.lakeMemo = { key: memo, lakes };
  return lakes;
}
// Walking time drawn as a length: a scale bar of a round number of minutes on open, level ground
// (about 5 km/h), between about 60 and 160 px long at the current zoom.
function scaleBar(span) {
  const pxPerCell = mapSide() / span, cellsPerMin = 5000 / 60 / CELL;
  const mins = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180].find(m => m * cellsPerMin * pxPerCell >= 60) ?? 180;
  const px = Math.round(mins * cellsPerMin * pxPerCell);
  const say = mins < 60 ? `${mins} min` : `${mins / 60} h`; // exact: a scale needs the number, not "a few minutes"
  return `<span class="scalebar" aria-label="Scale: ${say} walking on open ground"><i style="width:${px}px"></i>${say} on open ground</span>`;
}
// crossings I know of and haven't stood on (one I've stood on is a place, marked as such)
const knownCrossings = () => (S.crossingsKnown ?? []).filter(q => !S.sites.some(t => t.x === q.x && t.y === q.y)).map(q => ({ ...q, key: `crossing:${q.x}_${q.y}`, name: 'crossing', cells: [q] }));
// where I crossed a stream and haven't since walked along it there: the crossing isn't joined to the
// rest of the stream by anything but a guess, so it keeps a marker of its own until it is
const crossedMarks = (M, crossings) => S.streams.flatMap(st => st.fixes.filter(f => f.how === 'crossed' && !(st.runs ?? []).some(r => r.includes(f)))
  .map(f => ({ x: f.x, y: f.y, key: `crossed:${f.x}_${f.y}`, kind: 'crossed', name: 'where I crossed', cells: [f] })))
  .filter(q => !M.nodes.some(v => !v.unmarked && v.x === q.x && v.y === q.y) && !crossings.some(c => c.x === q.x && c.y === q.y));
// A stream as drawn: unbroken lines from each source down, a new line wherever walked gives way to
// guessed. Each piece: whether it was walked (known), its fixes (pts), whether it starts afresh, and
// which of its fixes the line is drawn through (keep): on a walked stretch, the ones that matter (ends,
// forks, waterfalls, springs, mouths, outlets, places marked on the map) and one in ten between; on a
// guessed one, all of them.
function streamLines(t, keyCells) {
  const downOf = new Map(t.segs.map(sg => [sg[0], sg])), ins = new Map(), drawn = new Set(), pieces = [];
  for (const sg of t.segs) ins.set(sg[1], (ins.get(sg[1]) ?? 0) + 1);
  const draw = (sg, fresh) => { const last = pieces[pieces.length - 1]; if (!fresh && last && last.known === !!sg.known) last.pts.push(sg[1]); else pieces.push({ known: !!sg.known, pts: [sg[0], sg[1]], fresh }); };
  for (const src of t.segs.map(sg => sg[0]).filter(f => !ins.has(f))) {
    let f = src, fresh = true;
    while (downOf.has(f) && !drawn.has(f)) { const sg = downOf.get(f); drawn.add(f); draw(sg, fresh); fresh = false; f = sg[1]; }
  }
  for (const sg of t.segs) if (!drawn.has(sg[0])) draw(sg, true); // a loop with no source (rare)
  for (const q of pieces) {
    const key = q.known ? q.pts.map((f, k) => k).filter(k => k === 0 || k === q.pts.length - 1 || waterMark(q.pts[k]) || (ins.get(q.pts[k]) ?? 0) >= 2 || keyCells.has(`${q.pts[k].x},${q.pts[k].y}`)) : q.pts.map((f, k) => k);
    q.keep = [];
    for (const k of key) { const last = q.keep[q.keep.length - 1] ?? 0; for (let m = last + 10; m < k - 4; m += 10) q.keep.push(m); if (!q.keep.length || q.keep[q.keep.length - 1] !== k) q.keep.push(k); } // one cell in ten between the ones that matter
  }
  return { pieces, downOf, ins };
}
const keyCellsNow = () => new Set(S.sites.filter(t => !unmarked(t)).map(t => `${t.x},${t.y}`));

// What the map shows, as data: places and landmarks (drawn or not, marked as a fork, spring and so on,
// here), the links between them, streams as the lines drawn (the fixes each passes through), lakes,
// cliffs, crossings, where I crossed, the arrows for following water or a shore, the pin, and every
// target a tap can head for, in the order the map stacks them. The drawing (mapHTML) is made from the
// same pieces; tests read this.
function mapData() {
  const M = mentalMap(), hi = M.nodes.findIndex(v => v.site === S.at), here = M.nodes[hi];
  const lakes = lakeShapes(), cliffs = seenPieces('cliff'), crossings = knownCrossings(), crossed = crossedMarks(M, crossings), keyCells = keyCellsNow();
  const streams = streamTrees().map(t => ({ id: t.id, name: t.name, hike: `stream:${t.id}`, lone: t.lone.map(f => ({ x: f.x, y: f.y })),
    lines: streamLines(t, keyCells).pieces.map(q => ({ known: q.known, cells: q.pts.map(f => ({ x: f.x, y: f.y })), drawn: q.keep.map(k => ({ x: q.pts[k].x, y: q.pts[k].y })) })) }));
  const nodes = M.nodes.map((v, i) => ({ i, key: v.key, name: v.name, x: v.x, y: v.y, kind: v.site !== undefined ? 'site' : 'sus', site: v.site, sus: v.sus, mark: v.mark ?? null, certainty: v.certainty, here: i === hi, drawn: !v.unmarked }));
  const follows = followOptions().concat(shoreOptions()).map(o => ({ key: o.key, dir: o.dir, say: o.say }));
  const targets = [
    ...lakes.map(q => ({ hike: q.id, kind: 'lake', name: q.name })), ...cliffs.map(q => ({ hike: q.id, kind: 'cliff', name: q.name })),
    ...streams.map(t => ({ hike: t.hike, kind: 'stream', name: t.name })),
    ...crossings.map(q => ({ hike: `go:${q.x}_${q.y}`, kind: 'crossing', name: 'crossing' })), ...crossed.map(q => ({ hike: `go:${q.x}_${q.y}`, kind: 'crossed', name: 'where I crossed' })),
    ...nodes.filter(v => v.drawn && !v.here).map(v => ({ hike: v.key, kind: v.kind, name: v.name, mark: v.mark, certainty: v.certainty })),
    ...follows.map(o => ({ hike: o.key, kind: 'follow', name: o.say })),
    ...(S.mapPin ? [{ hike: `go:${S.mapPin.x}_${S.mapPin.y}`, kind: 'pin', name: 'the spot I picked' }] : []),
  ];
  return { here: { x: here.x, y: here.y, name: here.name }, nodes, edges: M.edges.map(e => ({ a: e.a, b: e.b, kind: e.kind, certainty: e.certainty, hours: e.hours })), streams,
    lakes: lakes.map(q => ({ key: q.key, hike: q.id, name: q.name, cells: q.cells.length })), cliffs: cliffs.map(q => ({ key: q.key, hike: q.id, name: q.name, cells: q.cells.length })),
    crossings: crossings.map(q => ({ x: q.x, y: q.y, kind: q.kind })), crossed: crossed.map(q => ({ x: q.x, y: q.y })), follows, pin: S.mapPin ?? null, targets, segNames: Object.values(S.segNames ?? {}).map(g => g.name) };
}

function mapHTML() {
  const M = mentalMap();
  const hi = M.nodes.findIndex(v => v.site === S.at), here = M.nodes[hi];
  const xs = M.nodes.map(v => v.x), ys = M.nodes.map(v => v.y);
  let x0 = Math.min(...xs) - 4, y0 = Math.min(...ys) - 4, span = Math.max(Math.max(...xs) - x0 + 4, Math.max(...ys) - y0 + 4, 16);
  x0 -= (span - (Math.max(...xs) + 4 - x0)) / 2; y0 -= (span - (Math.max(...ys) + 4 - y0)) / 2; // centre the narrower way
  if (S.mapView) ({ x: x0, y: y0, span } = S.mapView);
  const fs = MAP_PX * span / mapSide(), u = px => px * fs / MAP_PX; // u: screen pixels in map units
  const routes = !!S.mapRoutes, trees = streamTrees(), lakes = lakeShapes();
  const cliffs = seenPieces('cliff').map(q => ({ ...q, line: cliffLine(q) }));
  const radius = i => fs * (i === hi ? 0.65 : 0.45);
  const chev = (x, y, dx, dy, k = fs * 0.4) => `M${x - dx * k + dy * k} ${y - dy * k - dx * k}L${x + dx * k} ${y + dy * k}L${x - dx * k - dy * k} ${y - dy * k + dx * k}`;
  // marks every `gap` px of screen along a polyline, starting half a gap in (stream chevrons, cliff ticks)
  const along = (pts, gapPx, start = gapPx / 2) => {
    const out = [], gap = u(gapPx);
    let next = u(start);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], l = Math.hypot(b.x - a.x, b.y - a.y);
      while (next <= l && l > 0) { const t = next / l; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / l, dy: (b.y - a.y) / l }); next += gap; }
      next -= l;
    }
    return { marks: out, carry: next / fs * MAP_PX };
  };

  // ---- labels, in priority order; all but where I stand are dropped rather than crowd others
  const textW = textWidth(fs), items = [];
  const pin = S.mapPin, pinSay = pin && `Go here (${timeWords(routeHours(here, pin), 'guess')})`;
  items.push({ i: hi, rank: 0 });
  if (pin) items.push({ pin: true, rank: 0 });
  for (const q of [...lakes, ...cliffs].sort((a, b) => b.cells.length - a.cells.length)) if (!items.some(t => t.feature?.key === q.key)) items.push({ feature: q, rank: 1 });
  const crossings = knownCrossings(), crossed = crossedMarks(M, crossings);
  for (const q of crossings) items.push({ feature: q, rank: 1.5 });
  for (const q of crossed) items.push({ feature: q, rank: 4.5 });
  M.nodes.forEach((v, i) => { if (i === hi || v.unmarked) return; if (v.site !== undefined) items.push({ i, rank: 2, weight: S.sites[v.site].visits ?? 0 }); else items.push({ i, rank: v.certainty === 'unknown' ? 4 : 3, weight: S.suspects.find(x => x.id === v.sus)?.obs ?? 0 }); });
  items.sort((a, b) => a.rank - b.rank || (b.weight ?? 0) - (a.weight ?? 0));
  for (const t of items) {
    if (t.pin) { t.text = pinSay; t.at = { x: pin.x, y: pin.y - u(10) }; t.r = u(9); t.h = fs; }
    else if (t.feature) { const q = t.feature; t.text = typo(q.name.replace(/^the /, '')); t.at = q.kind === 'cliff' ? q.line.pts[Math.floor(q.line.pts.length / 2)] : { x: q.x, y: q.y }; t.r = fs * 0.3; t.h = fs * 0.9; }
    else { const v = M.nodes[t.i]; t.text = `${typo(v.name.replace(/^the /, ''))}${v.certainty === 'unknown' ? '?' : ''}`; t.at = v; t.r = radius(t.i); t.h = fs; }
  }
  const follows = followOptions().concat(shoreOptions());
  const segs = trees.flatMap(t => t.segs).concat(routes ? M.edges.map(e => [M.nodes[e.a], M.nodes[e.b]]) : [])
    .concat(follows.map(o => { const r = o.dir * Math.PI / 180; return [here, { x: here.x + Math.sin(r) * fs * 2.6, y: here.y - Math.cos(r) * fs * 2.6 }]; }));
  const spots = placeLabels(items.map(t => ({ x: t.at.x, y: t.at.y, r: t.r, w: textW(t.text) * (t.feature ? 0.9 : 1), h: t.h, optional: t.rank > 0 })), {
    segs, discs: M.nodes.filter(v => !v.unmarked).map(v => ({ x: v.x, y: v.y, r: radius(M.nodes.indexOf(v)) })).concat(pin ? [{ x: pin.x, y: pin.y - u(10), r: u(9) }] : []), bounds: { x0, y0, x1: x0 + span, y1: y0 + span },
  });
  const labelOf = new Map(), featureLabels = [];
  let pinLabel = '';
  items.forEach((t, k) => {
    const b = spots[k]; if (!b) return;
    if (t.pin) pinLabel = `<text x="${b.x0}" y="${b.y1 - fs * 0.22}" font-size="${fs}">${esc(typo(t.text))}</text>`;
    else if (t.feature) featureLabels.push(`<text class="flabel ${t.feature.kind}" x="${b.x0}" y="${b.y1 - fs * 0.2}" font-size="${fs * 0.9}">${esc(t.text)}</text>`);
    else labelOf.set(t.i, `<text x="${b.x0}" y="${b.y1 - fs * 0.22}" font-size="${fs}">${esc(t.text)}</text>`);
  });

  // ---- lakes: circles fitted inside their shores; cliffs: a line along them, ticks on the low side every 16 px
  const nearCell = q => q.cells.reduce((a, c) => (Math.hypot(c.x - here.x, c.y - here.y) < Math.hypot(a.x - here.x, a.y - here.y) ? c : a));
  const area = (q, kind) => { const say = `Head for ${q.name} (${timeWords(routeHours(here, nearCell(q)), 'guess')})`; return `<g class="feature ${kind}" data-hike="${q.id}" role="button" tabindex="0" aria-label="${esc(typo(say))}"><title>${esc(typo(say))}</title>`; };
  const Lk = lakes.map(q => area(q, 'lake') + q.circles.map(k => `<circle cx="${k.x.toFixed(2)}" cy="${k.y.toFixed(2)}" r="${k.r.toFixed(2)}"/>`).join('') + '</g>').join('');
  const Cl = cliffs.map(q => { const { pts, nx, ny } = q.line, d = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join(''), t = u(7);
    return area(q, 'cliff') + `<path class="face" d="${d}" stroke-width="${u(3.5)}"/>` + along(pts, 16).marks.map(m => `<line class="tick" x1="${m.x}" y1="${m.y}" x2="${m.x + nx * t}" y2="${m.y + ny * t}" stroke-width="${u(2)}"/>`).join('') + `<path class="hit" d="${d}" stroke-width="${fs * 2.2}"/></g>`; }).join('');
  // names of stretches of stream: along the straight line from one end of the stretch to the other,
  // turned to read left to right, just beside it; left off where the stretch is too short to hold it
  const SL = Object.values(S.segNames ?? {}).map(g => {
    const dx = g.bottom.x - g.top.x, dy = g.bottom.y - g.top.y, len = Math.hypot(dx, dy), w = textW(g.name) * 0.9;
    if (len < w * 0.8) return '';
    let a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (a > 90) a -= 180; else if (a < -90) a += 180;
    // beside the line on whichever side keeps the words off the markers there (left off if neither does)
    const r = a * Math.PI / 180, ux = Math.sin(r), uy = -Math.cos(r), tx = Math.cos(r), ty = Math.sin(r), cx = (g.top.x + g.bottom.x) / 2, cy = (g.top.y + g.bottom.y) / 2;
    const boxes = spots.filter(Boolean), pad = fs * 0.4;
    const clear = side => { const ox = cx + ux * side * u(9), oy = cy + uy * side * u(9); return [-0.5, -0.25, 0, 0.25, 0.5].every(k => { const px = ox + tx * k * w, py = oy + ty * k * w; return M.nodes.every(v => v.unmarked || Math.hypot(px - v.x, py - v.y) > radius(M.nodes.indexOf(v)) + fs * 0.55) && boxes.every(b => px < b.x0 - pad || px > b.x1 + pad || py < b.y0 - pad || py > b.y1 + pad); }); };
    const side = clear(1) ? 1 : clear(-1) ? -1 : 0;
    if (!side) return '';
    const mx = cx + ux * (side > 0 ? u(7) : -u(16)), my = cy + uy * (side > 0 ? u(7) : -u(16)); // the text's baseline: above the line, or below it
    return `<text class="flabel stream" text-anchor="middle" x="${+mx.toFixed(2)}" y="${+my.toFixed(2)}" font-size="${fs * 0.9}" transform="rotate(${+a.toFixed(1)} ${+mx.toFixed(2)} ${+my.toFixed(2)})">${esc(typo(g.name))}</text>`;
  }).join('');
  // crossings: a pair of short bars across the water, like a bridge on a map
  const X = crossings.map(q => {
    const r = (flowAt(q.x, q.y) ?? 0) * Math.PI / 180, fx = Math.sin(r), fy = -Math.cos(r), k = u(7), g = u(3);
    const bar = o => `<line x1="${q.x + fx * o - fy * k}" y1="${q.y + fy * o + fx * k}" x2="${q.x + fx * o + fy * k}" y2="${q.y + fy * o - fx * k}"/>`;
    const say = `Head for the crossing (${timeWords(routeHours(here, q), 'guess')}): ${CROSSING_WORDS[q.kind]}`;
    return `<g class="crossing" data-hike="go:${q.x}_${q.y}" role="button" tabindex="0" aria-label="${esc(typo(say))}"><title>${esc(typo(say))}</title><g stroke-width="${u(3)}">${bar(-g)}${bar(g)}</g><circle class="hit" cx="${q.x}" cy="${q.y}" r="${fs * 1.45}"/></g>`;
  }).join('');
  const XD = crossed.map(q => { const say = `Head for where I crossed (${timeWords(routeHours(here, q), 'guess')})`; return `<g class="crossed" data-hike="go:${q.x}_${q.y}" role="button" tabindex="0" aria-label="${esc(typo(say))}"><title>${esc(typo(say))}</title><circle cx="${q.x}" cy="${q.y}" r="${fs * 0.3}" stroke-width="${u(2.5)}"/><circle class="hit" cx="${q.x}" cy="${q.y}" r="${fs * 1.45}"/></g>`; }).join('');
  const land = landImage();

  // ---- streams: smooth lines down the drainage, chevrons every 70 px pointing downstream (spaced along
  // each stream from its source down, so a long stream keeps one rhythm); lone fixes are short arrows.
  // A walked stretch has a fix on every cell, but the line is drawn through only the ones that matter
  // (forks, ends, springs, falls, mouths, outlets, places marked on the map) and one cell in ten
  // between, as a curve leaving each in the way the water runs there (a cubic Hermite spline).
  const unit = (x, y) => { const l = Math.hypot(x, y); return l ? { x: x / l, y: y / l } : { x: 0, y: 1 }; };
  const curve = (pts, flow) => { // Bezier pieces through pts leaving each the way the water runs there; also sampled, for chevrons
    // One direction per point, used on both sides of it (so the line never kinks there). Where the
    // water's own direction is far off the line to a neighbouring point (it turns sharply just there,
    // between points ten cells apart), the point takes the direction from its neighbour before to the
    // one after instead, so the curve doesn't loop.
    const tan = pts.map((p, k) => {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], cr = unit(b.x - a.x, b.y - a.y);
      const ok = [[a, p], [p, b]].every(([q, r]) => q === r || (flow[k].x * (r.x - q.x) + flow[k].y * (r.y - q.y)) / Math.hypot(r.x - q.x, r.y - q.y) > 0.5);
      return ok ? flow[k] : cr;
    });
    let d = `M${pts[0].x} ${pts[0].y}`;
    const fine = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, t0 = tan[k - 1], t1 = tan[k];
      const c0 = { x: a.x + t0.x * L / 3, y: a.y + t0.y * L / 3 }, c1 = { x: b.x - t1.x * L / 3, y: b.y - t1.y * L / 3 };
      d += `C${+c0.x.toFixed(2)} ${+c0.y.toFixed(2)} ${+c1.x.toFixed(2)} ${+c1.y.toFixed(2)} ${b.x} ${b.y}`;
      for (let j = 1; j <= 8; j++) { const t = j / 8, m = 1 - t; fine.push({ x: m * m * m * a.x + 3 * m * m * t * c0.x + 3 * m * t * t * c1.x + t * t * t * b.x, y: m * m * m * a.y + 3 * m * m * t * c0.y + 3 * m * t * t * c1.y + t * t * t * b.y }); }
    }
    return { d, fine };
  };
  const keyCells = keyCellsNow();
  const W = trees.map(t => {
    const near = nearestOnStream(t, here), say = `Head for ${t.name} (${timeWords(routeHours(here, near), 'guess')})`;
    const { pieces, downOf } = streamLines(t, keyCells), marks = [];
    const tangent = (q, k) => { // the way the water runs at q.pts[k]: across three cells either side as walked, else as seen there
      const f = q.pts[k];
      if (!q.known && f.flow != null) { const r = f.flow * Math.PI / 180; return unit(Math.sin(r), -Math.cos(r)); }
      let dn = f; for (let n = 0; n < 3 && downOf.has(dn); n++) dn = downOf.get(dn)[1];
      const up = q.pts[Math.max(0, k - 3)];
      return unit(dn.x - up.x, dn.y - up.y);
    };
    let carry = 35;
    const lines = pieces.map(q => {
      const idx = q.keep;
      const { d, fine } = curve(idx.map(k => q.pts[k]), idx.map(k => tangent(q, k)));
      const r = along(fine, 70, q.fresh ? 35 : carry); marks.push(...r.marks); carry = r.carry;
      return `<path class="flow${q.known ? ' known' : ''}" d="${d}" stroke-width="${u(3.5)}"/><path class="hit" d="${d}" stroke-width="${fs * 2.2}"/>`;
    })
      .concat(t.lone.map(f => { const r = (f.flow ?? 180) * Math.PI / 180, dx = Math.sin(r), dy = -Math.cos(r), k = u(20); marks.push({ x: f.x + dx * k * 0.7, y: f.y + dy * k * 0.7, dx, dy }); return `<line class="flow lone" x1="${f.x - dx * k}" y1="${f.y - dy * k}" x2="${f.x + dx * k}" y2="${f.y + dy * k}" stroke-width="${u(3.5)}"/><line class="hit" x1="${f.x - dx * k}" y1="${f.y - dy * k}" x2="${f.x + dx * k}" y2="${f.y + dy * k}" stroke-width="${fs * 2.2}"/>`; }));
    return `<g class="stream" data-hike="stream:${t.id}" role="button" tabindex="0" aria-label="${esc(typo(say))}"><title>${esc(typo(say))}</title>${lines.join('')}${marks.map(m => `<path class="chev" d="${chev(m.x, m.y, m.dx, m.dy, u(6))}" stroke-width="${u(3.5)}"/>`).join('')}</g>`;
  }).join('');

  // ---- at a stream: white arrows from here to follow it a stage; downstream has its head at the
  // far end, each upstream branch a chevron at its far end pointing back downstream, like fletching
  const F = follows.map(o => {
    const r = o.dir * Math.PI / 180, dx = Math.sin(r), dy = -Math.cos(r), a = { x: here.x + dx * fs * 0.8, y: here.y + dy * fs * 0.8 }, b = { x: here.x + dx * fs * 2.6, y: here.y + dy * fs * 2.6 };
    const head = o.key === 'follow:down' || o.key.startsWith('shore:') ? chev(b.x - dx * u(4), b.y - dy * u(4), dx, dy, u(6)) : chev(b.x - dx * u(2), b.y - dy * u(2), -dx, -dy, u(6));
    const shape = `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><path d="${head}"/>`;
    return `<g class="follow" data-hike="${o.key}" role="button" tabindex="0" aria-label="${esc(typo(o.say))}"><title>${esc(typo(o.say))}</title><g class="edge-of" stroke-width="${u(6)}">${shape}</g><g class="face" stroke-width="${u(3)}">${shape}</g><line class="hit" x1="${here.x + dx * fs * 0.9}" y1="${here.y + dy * fs * 0.9}" x2="${b.x}" y2="${b.y}" stroke-width="${fs * 2.2}"/></g>`;
  }).join('');

  // ---- routes (behind the Routes button): trails, guessed shortcuts and where landmarks were seen from
  const E = !routes ? '' : M.edges.map(e => {
    const A = M.nodes[e.a], B = M.nodes[e.b], mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, len = Math.hypot(A.x - B.x, A.y - B.y);
    let ang = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180; // keep the time label upright, along the line
    return `<line class="edge ${e.certainty}${e.stub ? ' stub' : ''}" data-link="${e.kind}" data-a="${e.a}" data-b="${e.b}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke-width="${fs * 0.12}"><title>${esc(typo(`${cap(A.name)} – ${B.name}: ${timeWords(e.hours, e.certainty)}${e.crossings.length ? `, crossing ${e.crossings.map(c => c.name).join(' and ')}` : ''}`))}</title></line>`
      + (len > fs * 4.5 ? `<text class="etime" x="${mx}" y="${my}" dy="${-fs * 0.3}" font-size="${fs * 0.8}" text-anchor="middle" transform="rotate(${ang.toFixed(1)} ${mx} ${my})">${esc(timeWords(e.hours, e.certainty))}</text>` : '');
  }).join('');

  // ---- places and landmarks
  const Nd = M.nodes.map((v, i) => {
    if (v.unmarked) return '';
    const e = M.edges.find(x => (x.a === hi && x.b === i) || (x.b === hi && x.a === i));
    const t = timeWords(e ? e.hours : routeHours(here, v), e ? e.certainty : v.certainty === 'known' ? 'guess' : v.certainty);
    const say = i === hi ? `${cap(v.name)} (here)` : `${v.site !== undefined ? 'Head back to' : 'Head for'} ${v.name} (${t})`;
    return `<g ${i === hi ? '' : `data-hike="${v.key}" role="button" tabindex="0" `}aria-label="${esc(typo(say))}" data-i="${i}" class="node ${v.site !== undefined ? 'site' : 'sus'}${v.mark ? ` ${v.mark}` : ''} ${v.certainty}${i === hi ? ' here' : ''}"><title>${esc(typo(say))}</title><circle cx="${v.x}" cy="${v.y}" r="${radius(i)}" stroke-width="${fs * 0.12}"/>${i === hi ? '' : `<circle class="hit" cx="${v.x}" cy="${v.y}" r="${fs * 1.45}"/>`}${labelOf.get(i) ?? ''}</g>`; // hit: a finger-sized target (about 44 px across)
  }).join('');

  // ---- a spot I've picked: tap it to go
  const P = !pin ? '' : `<g class="pin" data-hike="go:${pin.x}_${pin.y}" role="button" tabindex="0" aria-label="${esc(typo(pinSay))}"><title>${esc(typo(pinSay))}</title><path d="M${pin.x} ${pin.y}l${-u(7)} ${-u(14)}a${u(7.5)} ${u(7.5)} 0 1 1 ${u(14)} 0z" stroke-width="${u(2)}"/><circle class="hit" cx="${pin.x}" cy="${pin.y - u(14)}" r="${fs * 1.45}"/>${pinLabel}</g>`;

  const svg = `<svg class="mapsvg" style="--u: ${fs}px" viewBox="${x0} ${y0} ${span} ${span}" role="group" aria-label="My map; north is up. Tap a place to hike there, or tap anywhere to pick a spot.">${land ? `<image class="land" href="${land}" x="-0.5" y="-0.5" width="${GN}" height="${GN}" preserveAspectRatio="none"/>` : ''}${Lk}${E}${Cl}${W}${X}${XD}${SL}${featureLabels.join('')}${Nd}${F}${P}</svg>`;
  const tools = `<div class="map-tools">${scaleBar(span)}${S.mapView ? '<button class="ghost" data-mapfit="1">Fit</button>' : ''}<button class="ghost" data-maproutes="1">${routes ? 'Routes: shown' : 'Routes: hidden'}</button><button class="ghost" data-mapland="1">${LAND_MODES[S.mapLand ?? 'seen']}</button></div>`;
  return `${svg}${tools}<p class="hint">North is up. Tap a place, landmark, stream, lake or cliff to head for it; tap anywhere else to drop a pin, then tap the pin to go there. Drag to pan; pinch or scroll to zoom. Filled dots: places I’ve been; rings: things I’ve seen or heard (“?”: heard only). Blue: lakes as I picture them, springs, and streams, solid where I’ve walked along them, chevrons pointing downstream. Lines with ticks: cliffs, ticks on the low side. At a stream, the white arrows by me follow it a stretch. Not every name is shown when the map is crowded; zoom in for more.</p>`;
}
// A tap on the map: hike straight to that node.
function hikeNow(key) {
  if (key.startsWith('stream:')) return headForStream(key.slice(7));
  if (key.startsWith('lake:') || key.startsWith('cliff:')) return headForFeature(key);
  if (key.startsWith('go:')) { // a spot I picked on the map
    const [x, y] = key.slice(3).split('_').map(Number), h = site();
    if (S.mapPin?.x === x && S.mapPin?.y === y) S.mapPin = null;
    if (x === h.x && y === h.y) return log('That’s where I am.', 'thought');
    return travelTo({ x, y, point: true, label: 'the spot I picked' }, `toward a spot to the ${bearingWord(bearing(h, { x, y }))}`);
  }
  if (key.startsWith('shore:')) return walkShore(key.slice(6));
  if (key.startsWith('follow:')) { const [, dir, b] = key.split(':'); return followStream(dir, b ? { x: +b.split('_')[0], y: +b.split('_')[1] } : null); }
  const M = mentalMap(), v = M.nodes.find(n => n.key === key);
  if (!v || v.site === S.at) return;
  if (v.sus) { const u = S.suspects.find(x => x.id === v.sus); travelTo({ ...u.est, suspect: u.id }, `toward ${u.label}`); }
  else travelTo({ x: v.x, y: v.y, site: v.site }, `back to ${v.name}`);
}
function pickerFrame(title, body) {
  return `<div class="picker"><div class="picker-head"><h4>${esc(typo(title))}</h4>${picker.step !== 'root' ? '<button class="ghost" data-pk="back">Back</button>' : ''}<button class="ghost" data-pk="close">Close</button></div>${body}</div>`;
}

// ------------------------------------------------------------ actions in this place

function hereActions() {
  const s = site(), A = [];
  const night = isNight();
  A.push({ id: 'survey', label: 'Survey', hint: 'visible local resources', disabled: night });
  A.push(S.looking ? { id: 'look', label: `Looking for ${S.looking.label} (✕)`, hint: 'tap to stop looking', cls: 'looking' } : { id: 'look', label: 'Look', hint: 'for something in particular', disabled: night });
  A.push({ id: 'poke', label: 'Poke', hint: `around under stuff${bestStick() ? ', with the digging stick' : ''}`, disabled: night });
  A.push({ id: 'scan', label: 'Scan', hint: night ? 'listen in the dark' : 'the distance' });
  A.push({ id: 'make', label: 'Make', hint: 'from what’s on hand' });
  A.push({ id: 'inspect', label: 'Inspect', hint: 'something in particular', disabled: night });
  A.push({ id: 'collect', label: 'Collect', hint: 'something I can carry', disabled: night });
  if (waterHere(s)) A.push({ id: 'drink', label: 'Drink', hint: '' });
  if (waterHere(s)) A.push({ id: 'washhands', label: 'Wash my hands', hint: S.body.germs > 0.3 ? 'they’re filthy' : '' });
  if (isLookout(S.L, s.x, s.y)) A.push({ id: 'lookout', label: 'Look out from up here', hint: '½ h; climb a tree if I must', disabled: night || skyNow().sunAlt < 3 });
  if (fireHere()) A.push({ id: 'feed', label: 'Feed the fire', hint: 'uses dead wood', disabled: !has('wood') });
  const trees = [...s.known].some(id => ['tree', 'shrub'].includes(entity(id)?.form));
  if (!s.hut && trees) A.push({ id: 'hut', label: 'Build a debris hut', hint: '3½ h', disabled: night });
  if (bedding().length) A.push({ id: 'bed', label: s.bed ? 'Add to the bed' : 'Make up a bed', hint: 'from leaves, moss or dry grass carried' });
  A.push({ id: 'rest', label: 'Rest', hint: 'an hour, till dusk, or the night' });
  return A;
}

function doHere(id) {
  const s = site();
  switch (id) {
    case 'survey': perform(SURVEY); break;
    case 'poke': perform(GAME.poke); break;
    case 'collect': case 'inspect': case 'make': case 'rest': picker = { kind: id, step: 'root' }; break;
    case 'look': if (S.looking) perform(GAME.stopLooking); else picker = { kind: 'look', step: 'root' }; break;
    case 'scan': perform(GAME.scan); break;
    case 'lookout': perform(GAME.lookout); break;
    case 'washhands': perform(WASH_HANDS); break;
    case 'drink': perform(DRINK); break;
    case 'feed': perform(FEED_FIRE, { wood: ofKind('wood')[0] }); break;
    case 'bed': perform(MAKE_BED, { stuff: bedding() }); break;
    case 'hut': perform(BUILD_HUT); break;
  }
}

// Eating (acts.js): the food, and what I've learned of eating it before.
const eat = it => perform(EAT, { food: it });

// ------------------------------------------------------------ plans (goal tree with mental cost)

function nodeLabel(n) {
  if (n.type === 'item') return n.name;
  if (n.type === 'process') return n.name;
  if (n.type === 'any') return 'any one of these';
  return n.slot.role;
}
function think(path) {
  const n = nodeAt(path);
  S.body.focus = clamp(S.body.focus - 0.06);
  S.revealed[S.goal].add(path);
  if (n.type === 'material') { const h = lookHint(n.slot); log(h ? `For the ${n.slot.role}: look for ${h}.` : thought(n), 'thought'); }
  else if (n.type === 'any') log(`Any of these would do: ${n.options.map(nodeLabel).join(', or ')}.`, 'thought');
  else log(thought(n), 'thought');
}
let treeCache = {};
function tree() {
  if (treeCache[S.goal]) return treeCache[S.goal];
  if (S.goal.startsWith('proc:')) { // root at a process: expand the item it makes, keep that branch
    const P = PROCESSES.find(x => x.id === S.goal.slice(5));
    const t = expandGoal(P.makes[0].item, null, 7);
    return (treeCache[S.goal] = t.options.find(o => o.id === P.id) ?? t);
  }
  return (treeCache[S.goal] = expandGoal(S.goal, null, 7));
}
function children(n) { return n.type === 'item' ? n.options : n.type === 'process' ? n.needs : n.type === 'any' ? n.options : []; }
function nodeAt(path) {
  let n = tree();
  for (const i of path.split('/').slice(1)) n = children(n)[Number(i)];
  return n;
}
function planHTML(n = tree(), path = 'root', depth = 0) {
  const open = S.revealed[S.goal].has(path);
  const kids = children(n);
  const isLeaf = n.type === 'material' || (n.type === 'item' && (!kids.length || n.truncated));
  const label = depth === 0 ? (n.type === 'process' ? n.name : `To get ${n.name}`) : nodeLabel(n);
  let h = `<li class="plan-node ${n.type}"><span class="plan-label">${esc(typo(cap(label)))}</span>`;
  if (!open && !(n.type === 'item' && n.truncated)) h += ` <button class="think" data-think="${path}">Think it through</button>`;
  if (open && !isLeaf && kids.length) h += `<ul>${kids.map((k, i) => planHTML(k, `${path}/${i}`, depth + 1)).join('')}</ul>`;
  return h + '</li>';
}

// ------------------------------------------------------------ rendering

// Append only new entries: re-rendering the whole journal every click gets slow in long games.
let journalShown = 0, journalDay = 0;
function renderJournal() {
  const box = $('#journal');
  if (journalShown > S.log.length || journalShown === 0) { box.innerHTML = ''; journalShown = 0; journalDay = 0; }
  let h = '';
  for (const e of S.log.slice(journalShown)) {
    if (e.day !== journalDay) { h += `<h3 class="day">Day ${e.day}</h3>`; journalDay = e.day; }
    h += `<p class="entry ${e.kind}"><time>${clock(e.t)}</time>${esc(e.text)}</p>`;
  }
  const first = box.childElementCount;
  if (h) box.insertAdjacentHTML('beforeend', h);
  journalShown = S.log.length;
  return h ? box.children[first] : null; // the first element this action added (a day heading, if the day turned)
}

// The hidden truth about an item, for the "show exact properties" view.
function exactProps(it) {
  if (it.kind === 'food') return [...describeState(it.props.chem, it.props.mass), `germs ${it.props.germs.toFixed(2)}`];
  const fmt = v => (typeof v === 'number' ? (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 1000) / 1000) : Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v));
  const kv = Object.entries(it.props).map(([k, v]) => `${k} ${fmt(v)}`);
  return kv.length ? [kv.join('; ')] : ['no hidden properties'];
}
function itemRow(it) {
  const imp = impressions(it);
  const tests = testsFor(it).filter(([k]) => !it.notes[k]);
  const exact = S.showProps ? exactProps(it) : [];
  return `<li class="item"><div class="item-head"><span class="item-name">${esc(typo(cap(it.name)))}</span>${it.kind === 'food' ? `<button data-eat="${it.uid}">${fireHere() ? 'Roast and eat' : 'Eat'}</button>` : ''}<button class="ghost" data-drop="${it.uid}" aria-label="Drop ${esc(it.name)}">Drop</button></div>
    ${it.from?.site && S.sites.some(t => t.key === it.from.site) ? `<button class="ghost origin" data-origin="${esc(it.from.site)}">${(() => { const t = S.sites.find(x => x.key === it.from.site); return t.renamed ? `From ${esc(typo(t.name))} · rename` : 'Name where this came from'; })()}</button>` : ''}
    ${imp.length ? `<p class="imp">${esc(typo(imp.join('; ')))}</p>` : ''}
    ${exact.length ? `<ul class="exact">${exact.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${tests.length ? `<div class="tests">${tests.map(([k]) => `<button class="test" data-test="${it.uid}" data-name="${esc(k)}">${esc(typo(k))}</button>`).join('')}</div>` : ''}</li>`;
}

// Replace a panel's markup only when it changed: rebuilding the DOM is the slow part of a redraw
// (most of a click's cost in tests), and most actions leave most panels as they were.
const lastHTML = new Map();
function setHTML(sel, html) {
  if (lastHTML.get(sel) === html && $(sel).innerHTML !== '') return;
  lastHTML.set(sel, html);
  $(sel).innerHTML = html;
}
// A test page can leave the screen undrawn (window.__noDraw): the game runs the same, and the test reads
// its state through __hk (mapData, journal, actions) or draws once with __hk.draw() when it checks the
// drawing itself.
function render(force = false) {
  if (!S || (window.__noDraw && !force)) return;
  const s = site(), e = S.world.environment;
  { const k = skyNow(), tod = timeOfDay();
    $('#when').textContent = `Day ${S.day}, ${clock(S.t)}${tod === 'night' ? ', night' : tod === 'dusk' && k.sunAlt < 3 ? ', dusk' : ''} · ${k.season} · ${WEATHER_WORDS[k.weather]}, ${Math.round(k.tempC)}°C${tod === 'night' && k.moon.alt > 0 && k.moon.illum > 0.05 ? ` · ${moonWords(k.moon.phase)}` : ''}`; }
  setHTML('#where', `<span class="place" data-rename="1" title="Rename this place">${esc(typo(cap(s.name)))}</span>${fireHere() ? ' <span class="fire">fire burning</span>' : ''}${s.hut ? ' <span class="tag">hut</span>' : ''}`);
  $('#world-line').textContent = typo(`${cap(e.biome)}; ${e.leanSeason === 'winter' ? 'cool nights' : 'warm days'}`);

  const fresh = renderJournal();
  if (fresh) { // put the top edge of what this action wrote at the top of the log
    const j = $('#journal-wrap');
    j.scrollTop += fresh.getBoundingClientRect().top - j.getBoundingClientRect().top - parseFloat(getComputedStyle(j).paddingTop || 0);
  }

  setHTML('#body', `<ul class="words">${bodyWords().map(w => `<li>${esc(typo(w))}</li>`).join('')}</ul><label class="toggle"><input type="checkbox" data-toggle="props"${S.showProps ? ' checked' : ''}> Show exact properties of what I carry, and the range of what could have happened</label>${spreadHTML()}
    <div class="row"><button class="ghost" id="new-game">New world</button><button class="ghost" data-record="copy">Copy game record</button></div>
    <details class="record"><summary>Game record (${(S.record ?? []).length} actions)</summary><p class="hint">The world seed and every choice so far: replaying it from the start screen reproduces this game exactly. “Copy game record” fills this box.</p><textarea id="record-text" readonly rows="4"></textarea></details>`);

  const items = Object.keys(ITEMS).filter(k => PROCESSES.some(p => p.makes.some(m => m.item === k))).sort((a, b) => ITEMS[a].name.replace(/^an? /, '').localeCompare(ITEMS[b].name.replace(/^an? /, '')));
  const procs = [...PROCESSES].sort((a, b) => a.name.localeCompare(b.name));
  const opt = (v, l) => `<option value="${v}"${v === S.goal ? ' selected' : ''}>${esc(typo(l))}</option>`;
  setHTML('#plans', `<label class="goal-pick">Think about <select id="goal"><optgroup label="Things to make or get">${items.map(k => opt(k, cap(ITEMS[k].name.replace(/^an? /, '')))).join('')}</optgroup><optgroup label="Ways of doing things">${procs.map(p => opt(`proc:${p.id}`, p.name)).join('')}</optgroup></select></label>
    <p class="hint">Thinking a step through costs a little focus. Thoughts go in the journal.</p><ul class="plan">${planHTML()}</ul>`);

  const acts = hereActions();
  const gather = gatherOptions(s);
  setHTML('#here', `<div class="actions">${acts.map(a => `<button data-here="${a.id}"${a.cls ? ` class="${a.cls}"` : ''}${a.disabled ? ' disabled' : ''}>${esc(typo(a.label))}${a.hint ? `<small>${esc(a.hint)}</small>` : ''}</button>`).join('')}</div>
    ${picker ? pickerHTML() : ''}
`);

  setHTML('#map', mapHTML());

  setHTML('#pack', S.inv.length ? `<ul class="items">${S.inv.map(itemRow).join('')}</ul>` : '<p class="hint">Empty hands.</p>');

  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === tab));
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('active', p.dataset.panel.split(' ').includes(tab)));
}

// ------------------------------------------------------------ map pan and zoom
// Drag pans; a second finger pinches; the wheel zooms about the pointer. The view is kept in
// S.mapView ({ x, y, span } in grid cells) and the map is redrawn when a gesture ends, so labels
// re-size to the new scale.
const mapGesture = { pts: new Map(), start: null, moved: false, swallowClick: false };
function viewOf(svg) { const [x, y, span] = svg.getAttribute('viewBox').split(' ').map(Number); return { x, y, span }; }
function toUser(svg, v, cx, cy) { // screen point → grid cell, for a square viewBox drawn with "meet"
  const r = svg.getBoundingClientRect(), side = Math.min(r.width, r.height) || 1;
  return { x: v.x + (cx - r.left - (r.width - side) / 2) / side * v.span, y: v.y + (cy - r.top - (r.height - side) / 2) / side * v.span, side };
}
function setView(svg, v) { v.span = clamp(v.span, 6, 260); svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.span} ${v.span}`); S.mapView = v; }
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', ev => {
    const svg = ev.target.closest?.('.mapsvg'); if (!svg) return;
    mapGesture.pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    mapGesture.start = { v: viewOf(svg), pts: new Map(mapGesture.pts), svg };
    if (mapGesture.pts.size === 1) mapGesture.moved = false;
  });
  document.addEventListener('pointermove', ev => {
    const g = mapGesture; if (!g.start || !g.pts.has(ev.pointerId)) return;
    g.pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const { svg, v } = g.start, P = [...g.pts.values()], P0 = [...g.start.pts.values()];
    if (P.length === 1 && P0.length === 1) {
      const dx = P[0].x - P0[0].x, dy = P[0].y - P0[0].y;
      if (Math.hypot(dx, dy) > 4) g.moved = true;
      if (!g.moved) return;
      const side = toUser(svg, v, 0, 0).side;
      setView(svg, { x: v.x - dx / side * v.span, y: v.y - dy / side * v.span, span: v.span });
    } else if (P.length >= 2 && P0.length >= 2) {
      g.moved = true;
      const d0 = Math.hypot(P0[0].x - P0[1].x, P0[0].y - P0[1].y) || 1, d1 = Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y) || 1;
      const m0 = toUser(svg, v, (P0[0].x + P0[1].x) / 2, (P0[0].y + P0[1].y) / 2);
      const span = v.span * d0 / d1, mid = { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 };
      const r = svg.getBoundingClientRect(), side = Math.min(r.width, r.height) || 1;
      setView(svg, { x: m0.x - (mid.x - r.left - (r.width - side) / 2) / side * span, y: m0.y - (mid.y - r.top - (r.height - side) / 2) / side * span, span });
    }
  });
  const end = ev => {
    const g = mapGesture; if (!g.pts.has(ev.pointerId)) return;
    g.pts.delete(ev.pointerId);
    if (g.pts.size) { g.start = { v: viewOf(g.start.svg), pts: new Map(g.pts), svg: g.start.svg }; return; }
    if (g.moved) { g.swallowClick = true; setTimeout(() => { g.swallowClick = false; }, 50); render(); }
    g.start = null;
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  let wheelTimer = null;
  document.addEventListener('wheel', ev => {
    const svg = ev.target.closest?.('.mapsvg'); if (!svg) return;
    ev.preventDefault();
    const v = viewOf(svg), at = toUser(svg, v, ev.clientX, ev.clientY), k = Math.exp(ev.deltaY * 0.0015);
    setView(svg, { x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k, span: v.span * k });
    clearTimeout(wheelTimer); wheelTimer = setTimeout(render, 160);
  }, { passive: false });
  // a new window size, or the map's tab coming into view, re-sizes its text
  const box = document.querySelector('#map');
  if (box && typeof ResizeObserver !== 'undefined') {
    let last = 0;
    new ResizeObserver(() => { const side = mapSide(); if (S && Math.abs(side - last) > 2) { last = side; setHTML('#map', mapHTML()); } }).observe(box);
  }
}

// ------------------------------------------------------------ events

// ------------------------------------------------------------ the game record
//
// Everything that happens follows from the world seed and the player's choices, so a record of the
// seed and each choice reproduces a game exactly. Each action is the data of what was tapped (or
// the value chosen); `act` applies one, and replaying a record runs them in order on a fresh game.
const BUILD = 'hk-2026-10-26d'; // game logic version: a record replays faithfully only on the build that made it
function record(d) {
  S.record ??= [];
  S.record.push({ day: S.day, t: Math.round(S.t * 100) / 100, d });
}
function gameRecord() {
  return JSON.stringify({ game: 'hands-and-knowledge', version: S.world.version, build: BUILD, seed: S.seed, preset: S.preset ?? '', actions: S.record ?? [] });
}
function replay(text) {
  const rec = JSON.parse(text);
  if (rec.game !== 'hands-and-knowledge') throw new Error("not a Connecticut Commuter in Cro-Magnon's Cave game record");
  const ch = checkWorld(rec.seed, rec.preset || null, { withOutlook: false });
  newGame(rec.seed, rec.preset || null, ch);
  journalShown = 0; picker = null; lastHTML.clear();
  for (const a of rec.actions) { act({ ...a.d }); record({ ...a.d }); }
  if (rec.build && rec.build !== BUILD) log(`This record was made with build ${rec.build}; this is ${BUILD}, so the replay may drift from the original.`, 'warn');
  return rec;
}

document.addEventListener('click', ev => {
  const b = ev.target.closest('button, [data-rename], [data-hike]');
  if (!b && S && ev.target.closest?.('.mapsvg') && !mapGesture.swallowClick) { // a tap on open map: drop a pin there
    const svg = ev.target.closest('.mapsvg'), p = toUser(svg, viewOf(svg), ev.clientX, ev.clientY);
    S.mapPin = { x: clamp(Math.round(p.x), 0, GN - 1), y: clamp(Math.round(p.y), 0, GN - 1) };
    return render();
  }
  if (!b || !S) return;
  if (mapGesture.swallowClick && b.closest('.mapsvg')) return; // the end of a drag isn't a click
  const d = b.dataset;
  if (d.tab) { tab = d.tab; return render(); }
  if (d.mapfit) { S.mapView = null; return render(); } // view settings, not game actions
  if (d.maproutes) { S.mapRoutes = !S.mapRoutes; return render(); }
  if (d.spread) { S.spreadShown = { act: S.lastAct, result: spreadLast(d.spread) }; return render(); } // looking into the last action, not a game action
  if (d.mapland) { const m = Object.keys(LAND_MODES); S.mapLand = m[(m.indexOf(S.mapLand ?? 'seen') + 1) % m.length]; return render(); }
  if (d.record === 'copy') { const t = gameRecord(); navigator.clipboard?.writeText(t).then(() => log('Copied the game record.', 'thought'), () => {}); $('#record-text').value = t; $('#record-text').select(); return; }
  if (d.origin) { // name the place an item came from: it keeps a marker on the map from now on
    const t = S.sites.find(x => x.key === d.origin);
    const inp = document.createElement('input');
    inp.className = 'rename'; inp.value = t.renamed ? t.name : ''; inp.placeholder = 'a name for that place';
    b.replaceWith(inp);
    inp.focus(); inp.select();
    const done = () => { const v = inp.value.trim(); if (v && v !== t.name) { const a = { originOf: t.key, nameTo: v }; act(a); record(a); } lastHTML.clear(); render(); };
    inp.addEventListener('keydown', k => { if (k.key === 'Enter') inp.blur(); if (k.key === 'Escape') { inp.value = ''; inp.blur(); } });
    inp.addEventListener('blur', done, { once: true });
    return;
  }
  if (d.rename) {
    lastHTML.delete('#where'); // the place name is about to be replaced by an input
    const s = site();
    const inp = document.createElement('input');
    inp.className = 'rename'; inp.value = s.name;
    b.replaceWith(inp);
    inp.focus(); inp.select();
    const done = () => { const v = inp.value.trim(); if (v && v !== s.name) { const a = { renameTo: v }; act(a); record(a); } render(); };
    inp.addEventListener('keydown', k => { if (k.key === 'Enter') inp.blur(); if (k.key === 'Escape') { inp.value = s.name; inp.blur(); } });
    inp.addEventListener('blur', done, { once: true });
    return;
  }
  const { i: _, ...a } = { ...d }; // data-i numbers a map marker for the tests; it isn't part of the action
  if (act(a)) { record(a); render(); }
});

// Apply one player action (the data of what was tapped). Returns false if it wasn't an action.
function act(d) {
  if (d.originOf) { if (!S.sites.some(x => x.key === d.originOf)) return false; perform(GAME.rename, { place: d.originOf, name: d.nameTo, origin: true }); return true; }
  if (d.renameTo) { perform(GAME.rename, { place: site().key, name: d.renameTo, origin: false }); return true; }
  if (d.goalPick !== undefined) { S.goal = d.goalPick; S.revealed[S.goal] ??= new Set(); return true; }
  if (d.slotPick) { sel[d.slotPick] = Number(d.value); return true; }
  if (d.here) doHere(d.here);
  else if (d.gather !== undefined) { const g = gatherOptions(site())[Number(d.gather)]; perform(GAME.gather, { index: Number(d.gather), option: { hours: g.hours, kcal: g.kcal } }); }
  else if (d.pk) {
    if (d.pk === 'close') picker = null;
    else if (d.pk === 'back') picker = { kind: picker.kind, step: 'root' };
    else picker = { kind: 'collect', step: d.pk, value: d.v };
  }
  else if (d.rest) { picker = null; restFor(d.rest); }
  else if (d.hike) { picker = null; hike(d.hike); }
  else if (d.inspect) perform(GAME.inspect, { entity: d.inspect });
  else if (d.look) { picker = null; perform(GAME.look, { spec: d.look }); }
  else if (d.craft) craft(d.craft, d.mode);
  else if (d.test) perform(GAME.test, { thing: byUid(d.test), name: d.name });
  else if (d.eat) eat(byUid(d.eat));
  else if (d.drop) perform(GAME.drop, { thing: byUid(d.drop) });
  else if (d.think) perform(GAME.think, { path: d.think });
  else return false;
  return true;
}
document.addEventListener('keydown', ev => { // map markers work from the keyboard too
  const g = ev.target.closest?.('[data-hike]');
  if (g && S && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); const a = { hike: g.dataset.hike }; act(a); record(a); render(); }
});
document.addEventListener('change', ev => {
  if (!S) return;
  const t = ev.target;
  if (t.dataset.toggle === 'props') { S.showProps = t.checked; return render(); } // a view setting, not a game action
  const a = t.id === 'goal' ? { goalPick: t.value } : t.dataset.slot ? { slotPick: t.dataset.slot, value: t.value } : null;
  if (a) { act(a); record(a); render(); }
});

// ------------------------------------------------------------ start screen

let checked = null;
function randomSeed() { return Math.random().toString(36).slice(2, 7); }
function showCheck() {
  const seed = $('#seed').value.trim() || randomSeed();
  $('#seed').value = seed;
  const preset = $('#preset').value;
  const out = $('#profile');
  out.innerHTML = '<p class="hint">Reading the land…</p>';
  setTimeout(() => {
    checked = { seed, preset, ...checkWorld(seed, preset) };
    const { world, outlook: o } = checked;
    const e = world.environment;
    const odds = `For a beginner, roughly: ${o.text.water}, ${o.text.food}, ${o.text.fire}.`;
    out.innerHTML = `<p><strong>${esc(typo(cap(e.biome)))}</strong> on ${esc(e.bedrockLabel)}. ${e.meanTempC < 10 ? 'Cold nights.' : e.meanTempC > 18 ? 'Hot days.' : 'Mild weather.'}</p>
      <p>${esc(typo(odds))}</p><p class="hint">Indicative: a few quick trial runs of a sensible start, not a promise.</p>
      <div class="row"><button id="begin">Begin here</button><button class="ghost" id="reroll">Try another world</button></div>`;
  }, 20);
}
document.addEventListener('click', ev => {
  if (ev.target.id === 'check') showCheck();
  if (ev.target.id === 'reroll') { $('#seed').value = randomSeed(); showCheck(); }
  if (ev.target.id === 'replay') {
    try {
      const rec = replay($('#replay-text').value);
      $('#start').hidden = true; $('#app').hidden = false;
      log(`Replayed a game record: world ${rec.seed}, ${rec.actions.length} actions.`, 'thought');
      render();
    } catch (e) { $('#replay-msg').textContent = `Couldn’t replay that: ${e.message}`; }
  }
  if (ev.target.id === 'begin' && checked) {
    newGame(checked.seed, checked.preset, checked);
    journalShown = 0; lastHTML.clear();
    $('#start').hidden = true;
    $('#app').hidden = false;
    render();
  }
  if (ev.target.id === 'new-game') { $('#app').hidden = true; $('#start').hidden = false; }
});

// Debug hook for automated testing; harmless in play.
if (typeof window !== 'undefined') window.__hk = { state: () => S, ROLES, render, act, // test hooks
  draw: () => render(true), mapData, spreadLast, journal: () => S.log.map(e => e.text), actions: () => hereActions(), recordText: () => gameRecord(),
  replay(text) { const rec = replay(text); $('#start').hidden = true; $('#app').hidden = false; render(); return rec; },
  start(seed, preset = '') { checked = { seed, preset, ...checkWorld(seed, preset || null, { withOutlook: false }) }; newGame(seed, preset || null, checked); journalShown = 0; lastHTML.clear(); $('#start').hidden = true; $('#app').hidden = false; render(); } };

export function boot() {
  $('#seed').value = randomSeed();
  if (!window.__testPage) showCheck(); // a test picks its own world; it needn't wait on a random one
}
boot();
