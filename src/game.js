// game.js — a playable slice of the first days, built on the generator, notes, process network and crafting model.

import { generateWorld, samplePatch } from './generator.js';
import { hazard } from './life.js';
import { newMemory, observeSite, namingSentences, noteTrail } from './notes.js';
import { makeRng, clamp } from './rng.js';
import { siteFactors } from './variation.js';
import { generateLandscape, N as GN, CELL } from './landscape.js';
import { outlook } from './outlook.js';
import { windFor, smellSources, smellAt } from './smell.js';
import { cloneChem, expose, nutrients, harm, tasteWords, smellWords, textureWords, describeState, COMPOUNDS, PREP } from './food.js';
import { chooseSpawn, perceive, suspicionFrom, walk, followWater, stepHours, isLookout, bearingWord, bearing, distM, CUE_WORDS, loudWords, waterKeyAt, waterKeyOf, lineHours as rawLineHours } from './geo.js';
import { trailGraph, firstClear, streamLine, suspectedCrossings, timeWords, awayWords, explainTrip } from './mentalmap.js';
import { materialsOf, expandGoal, thought, ITEMS, lookHint, PROCESSES } from './process.js';
import { newCharacter, rest, dry, ROLES, knapFlakes, notchHearth, refineNotch, carveSpindle, makeTinder, handDrill, lightFire, searchNaturalEdge, splinterBone, estimateFire } from './craft.js';

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
const isNight = () => S.t >= 21 || S.t < 5;
const site = () => S.sites[S.here];
const entity = id => [...S.world.stones, ...S.world.plants, ...S.world.animals].find(e => e.id === id);
const fireHere = () => (site().fireUntil ?? -1) > now();

function log(text, kind = 'act') {
  S.log.push({ day: S.day, t: S.t, text: typo(text), kind });
}

// ------------------------------------------------------------ world setup

// The start-screen outlook (trial walks) is only for showing; a replay or a test start can skip it.
function checkWorld(seed, preset, { withOutlook = true } = {}) {
  const world = generateWorld(seed, { ...(preset ? { preset } : {}), mcSamples: 150 });
  const est = estimateFire(world);
  const water = world.water.filter(w => w.micro !== 'anywhere');
  const L = generateLandscape(world);
  const spawn = chooseSpawn(L, seed);
  return { world, est, water, L, spawn, outlook: withOutlook ? outlook(world, L, spawn, est, seed) : null };
}

function newGame(seed, preset, checked) {
  lhMemo.clear();
  for (const k of Object.keys(sel)) delete sel[k];
  checked = checked ?? checkWorld(seed, preset);
  const world = checked.world;
  S = {
    world, seed, preset, rng: makeRng(`${seed}/game`),
    ch: { ...newCharacter(), germs: 0.1 }, mem: newMemory(), day: 1, t: 6.5,
    hyd: 0.8, energy: 0.75, sick: 0, pendingSick: [], gut: 0, macro: { p: 0, f: 0, c: 0 }, showProps: false,
    sites: [], here: 0, inv: [], log: [], uid: 1,
    goal: 'fire', revealed: { fire: new Set() },
    milestones: {}, mats: materialsOf(world), lore: {},
    ambient: clamp(0.05 + 0.07 * world.environment.water, 0.05, 0.35),
    collapsed: 0, L: checked.L, suspects: [], attentive: false,
    waterNames: {}, waterPts: {}, walked: {}, recentNotice: null,
  };
  const first = newSite(checked.spawn.x, checked.spawn.y);
  first.name = 'where I woke';
  S.here = 0;
  look(first, 0.5);
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
// Like species: the first hill is "the hill". A second gets a word for how it looks ("the wooded
// hill"), or, lacking anything distinctive, something noticed recently ("the grouse hill") or its
// direction from its namesake ("the north hill"). Water is named by body: every crossing of one stream
// shares its name. A second place on the same water is "upstream" or "downstream" of the first.
const SITE_NOUN = { woodland: 'wood', edge: 'thicket', glade: 'clearing', streambank: 'stream bank', streambed: 'gravel bar', pond: 'marsh', outcrop: 'rocks', scree: 'scree', claybank: 'clay bank', spring: 'spring', deadfall: 'deadfall' };
const LANDMARK_NOUN = { hill: 'hill', cliff: 'cliff', lake: 'lake', waterfowl: 'lake', falls: 'falls', cascade: 'cascade', rapids: 'river', river: 'river', stream: 'stream', brook: 'brook', 'river trace': 'tree line' };
const namesInUse = () => new Set([...S.sites.map(t => t.name), ...S.suspects.map(u => u.label), ...Object.values(S.waterNames)]);
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
function uniqueName(base, pos, visual = []) {
  const used = namesInUse(), plain = `the ${base}`;
  S.lastTag = null;
  if (!used.has(plain)) return plain;
  const namesake = [...S.sites, ...S.suspects.map(u => ({ ...u.est, name: u.label }))].find(t => t.name === plain);
  const dir = namesake && (namesake.x !== pos.x || namesake.y !== pos.y) ? bearingWord(bearing(namesake, pos)) : null;
  const nearby = S.sites.length && Math.hypot(site().x - pos.x, site().y - pos.y) * CELL < 1000; // a recent sighting only tags somewhere close
  const tags = [...visual.map(t => [t, 'visual']), [nearby ? S.recentNotice : null, 'notice'], [dir, 'dir']];
  for (const [t, why] of tags) if (t && !used.has(`the ${t} ${base}`)) { S.lastTag = { tag: t, why }; return `the ${t} ${base}`; }
  S.lastTag = { why: 'other' };
  for (const o of ['other', 'third', 'fourth', 'fifth']) if (!used.has(`the ${o} ${base}`)) return `the ${o} ${base}`;
  return `${plain} ${used.size}`;
}
function waterName(wkey, kind, pos) {
  if (S.waterNames[wkey]) return S.waterNames[wkey];
  const noun = /^lake/.test(wkey) ? 'lake' : /^falls/.test(wkey) ? (kind === 'cascade' ? 'cascade' : 'falls') : /^brook/.test(wkey) ? 'brook' : ['river', 'rapids'].includes(kind) ? 'river' : 'stream';
  return (S.waterNames[wkey] = uniqueName(noun, pos, looksOf(noun, pos.x, pos.y)));
}
function notePoint(wkey, p) { if (/^(river|brook)/.test(wkey)) { const a = (S.waterPts[wkey] ??= []); if (!a.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 3)) a.push({ x: p.x, y: p.y }); } }
function waterSiteName(wname, x, y) {
  const first = S.sites.find(t => t.name === wname || t.name.startsWith(`${wname},`));
  if (!first) return wname;
  const up = S.L.elev[cellOf(x, y)] > S.L.elev[cellOf(first.x, first.y)];
  const tag = up ? 'upstream' : 'downstream';
  return S.sites.some(t => t.name === `${wname}, ${tag}`) ? `${wname}, ${bearingWord(bearing(first, { x, y }))}` : `${wname}, ${tag}`;
}

const placeNameFor = (u, x, y) => (u.group === 'water' && u.kind !== 'river trace' ? waterSiteName(u.label, x, y) : u.label);

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
  S.sites.forEach((t, i) => nodes.push({ key: t.key, name: t.name, x: t.x, y: t.y, site: i, certainty: 'known' }));
  const segs = links.map(e => [S.sites[e.a], S.sites[e.b]]);
  const hang = (v, prefer, kind) => { // link v to the preferred place, or the nearest one that doesn't cross the map
    const t = firstClear(v, [...new Set([...prefer, ...byDistance(v)])], segs);
    links.push({ a: S.sites.indexOf(t), b: nodes.length, kind }); segs.push([t, v]); nodes.push(v);
  };
  for (const u of S.suspects) {
    if (u.reached) continue;
    hang({ key: u.id, name: u.label, x: u.est.x, y: u.est.y, sus: u.id, water: u.group === 'water', certainty: (u.channel === 'sound' && u.obs < 2) || u.channel === 'smell' ? 'unknown' : 'guess' }, byDistance(u.seenAt ?? u.est).slice(0, 1), 'sighting');
  }
  for (const f of frontierPoints()) { // a landmark already marks the way, so no stub beside it
    if (nodes.some(v => v.sus && Math.hypot(v.x - f.x, v.y - f.y) < HEX_D / 3)) continue;
    hang({ ...f, frontier: true, certainty: 'guess' }, [], 'stub');
  }
  const streams = Object.entries(S.waterPts).filter(([, p]) => p.length >= 2).map(([key, p]) => ({ key, name: S.waterNames[key], line: streamLine(p) }));
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
// The unexplored: a background hexagonal lattice of points about 1 km apart. Points near places I've
// been count as explored and are ignored; the unexplored points next to explored ones ring the known
// area. Of that ring, one point per eighth of the compass (seen from the middle of where I've been),
// the one nearest a place I've been, goes on the map as a direction to strike out in.
const HEX_D = 13; // cells (~1 km)
const WIND16 = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
function hexLattice() {
  if (S.hexPts) return S.hexPts;
  const pts = [];
  for (let r = 0, y = 3; y < GN - 2; r++, y = 3 + r * HEX_D * Math.sqrt(3) / 2) {
    for (let x = 3 + (r % 2 ? HEX_D / 2 : 0); x < GN - 2; x += HEX_D) {
      const p = { i: pts.length, x: Math.round(x), y: Math.round(y) };
      if (!S.L.lake[cellOf(p.x, p.y)]) pts.push(p);
    }
  }
  return (S.hexPts = pts);
}
function frontierPoints() {
  const pts = hexLattice();
  const explored = p => S.sites.some(t => Math.hypot(t.x - p.x, t.y - p.y) < 0.75 * HEX_D);
  const ex = new Set(pts.filter(explored).map(p => p.i));
  const cx = S.sites.reduce((s, t) => s + t.x, 0) / S.sites.length, cy = S.sites.reduce((s, t) => s + t.y, 0) / S.sites.length;
  const pick = new Map(); // sector -> [point, distance to the nearest place I've been]
  for (const p of pts) {
    if (ex.has(p.i) || !pts.some(q => ex.has(q.i) && Math.hypot(q.x - p.x, q.y - p.y) < 1.15 * HEX_D)) continue;
    const sector = Math.round(bearing({ x: cx, y: cy }, p) / 45) % 8, d = Math.min(...S.sites.map(t => Math.hypot(t.x - p.x, t.y - p.y)));
    if (!pick.has(sector) || d < pick.get(sector)[1]) pick.set(sector, [p, d]);
  }
  const out = [], used = new Set();
  for (const [p] of [...pick.values()].sort((a, b) => a[0].i - b[0].i)) {
    const near = S.sites.reduce((a, b) => (Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a));
    let name = `the unknown ${WIND16[Math.round(bearing(near, p) / 22.5) % 16]}`;
    for (let k = 2; used.has(name); k++) name = `${name.replace(/ \d+$/, '')} ${k}`;
    used.add(name);
    out.push({ key: `hex-${p.i}`, x: p.x, y: p.y, name });
  }
  return out;
}

// What I expect a trip to take: the time I walked it in (drawn on the map or not), else the mapped
// link if there is one, else a guess along the line.
function mapHours(from, key, target) {
  if (S.walked[edgeKey(from.key, key)]) return S.walked[edgeKey(from.key, key)].hours;
  const M = mentalMap();
  const a = M.nodes.findIndex(v => v.key === from.key), b = M.nodes.findIndex(v => v.key === key);
  const e = M.edges.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  return e ? e.hours : lineHours(S.L, from, target);
}

// Sites are real positions. Reuse a known site within a cell rather than making a near-duplicate.
function newSite(x, y, name) {
  const near = S.sites.find(t => Math.abs(t.x - x) <= 1 && Math.abs(t.y - y) <= 1);
  if (near) return near;
  const micro = microAt(x, y);
  const s = { key: `p${x}_${y}`, x, y, micro, name: name ?? uniqueName(SITE_NOUN[micro] ?? micro, { x, y }, looksOf('site', x, y)), known: new Set(), visits: 0, hut: false, fireUntil: -1 };
  S.sites.push(s);
  return s;
}

// ------------------------------------------------------------ distant cues and suspected landmarks

const COMPASS_RANDOM = () => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.floor(S.rng.next() * 8)];
const timeOfDay = () => (isNight() ? 'night' : S.t < 8 ? 'dawn' : S.t >= 18 ? 'dusk' : 'day');
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
  if (sus) { sus.obs++; noteSeenFrom(sus, from); return { sus, isNew: false }; }
  const w = windNow(), dir = (w.from + S.rng.normal(0, 25)) * Math.PI / 180, dist = c.trueDist * Math.exp(S.rng.normal(0, 0.6)) / CELL;
  const est = { x: clamp(Math.round(from.x + Math.sin(dir) * dist), 0, GN - 1), y: clamp(Math.round(from.y - Math.cos(dir) * dist), 0, GN - 1) };
  S.lastTag = null;
  const label = wkey ? waterName(wkey, 'lake', est) : uniqueName(SMELL_NOUN[c.kind] ?? 'smell', est, []);
  sus = { id: `u${S.suspects.length + 1}`, kind: wkey ? 'lake' : c.kind, group: wkey ? 'water' : 'smell', trueKey: wkey ?? c.key, truePos: { x: c.x, y: c.y }, est, seenAt: { x: from.x, y: from.y }, channel: 'smell', obs: 1, label, reached: false, source: c.source };
  S.suspects.push(sus);
  return { sus, isNew: true };
}

// A landmark goes on the map hanging off where I've had the closest look at it.
function noteSeenFrom(sus, from) {
  if (!sus.seenAt || Math.hypot(from.x - sus.est.x, from.y - sus.est.y) < Math.hypot(sus.seenAt.x - sus.est.x, sus.seenAt.y - sus.est.y)) sus.seenAt = { x: from.x, y: from.y };
}
// Data association: is this cue one I already suspect? If not, a new named suspect.
function associate(c, from) {
  const g = suspicionFrom(c, from, S.rng);
  const kindGroup = isWaterKind(c.kind) ? 'water' : c.kind;
  let sus = S.suspects.find(u => u.trueKey === c.key) ?? S.suspects.find(u => u.group === kindGroup && Math.hypot(u.est.x - g.est.x, u.est.y - g.est.y) * CELL < Math.max(700, 0.35 * g.dist));
  if (sus) {
    const w = c.channel === 'sight' ? 0.6 : 0.3; // sightings sharpen the estimate more than sounds
    sus.est = { x: Math.round(sus.est.x * (1 - w) + g.est.x * w), y: Math.round(sus.est.y * (1 - w) + g.est.y * w) };
    sus.obs++;
    noteSeenFrom(sus, from);
    return { sus, isNew: false, g };
  }
  const named = isWaterKind(c.kind) && c.kind !== 'river trace';
  const known = named && S.waterNames[waterKeyOf(c.key)];
  S.lastTag = null;
  const label = named ? waterName(waterKeyOf(c.key), c.kind, g.est) : uniqueName(LANDMARK_NOUN[c.kind] ?? c.kind, g.est, looksOf(c.kind, c.x, c.y));
  // another of a kind I named here or at the last place: say how this one differs
  const noun = named ? label.split(' ').pop() : LANDMARK_NOUN[c.kind] ?? c.kind, recent = (S.mem.trail ?? []).slice(-2);
  let another = null;
  if (!known && S.lastTag && (S.landNamed?.[noun] ?? []).some(x => recent.includes(x.site) && x.label !== label)) {
    const t = S.lastTag, how = t.why === 'visual' ? `is ${t.tag}` : t.why === 'notice' ? `is near where I saw the ${t.tag}` : t.why === 'dir' ? `lies further ${t.tag}` : 'is a different one';
    another = `another ${noun}; this one ${how}. I’ll call this one ${label}`;
  }
  if (!known) ((S.landNamed ??= {})[noun] ??= []).push({ site: site()?.key, label });
  if (named && c.channel === 'sight') notePoint(waterKeyOf(c.key), g.est);
  sus = { id: `u${S.suspects.length + 1}`, kind: c.kind, group: kindGroup, trueKey: c.key, truePos: { x: c.x, y: c.y }, est: g.est, seenAt: { x: from.x, y: from.y }, channel: c.channel, obs: 1, label, reached: false, another };
  S.suspects.push(sus);
  return { sus, isNew: true, g };
}
function sense(s, lookout = false, { scan = false, focus = null } = {}) {
  let all = perceive(S.L, s, { time: timeOfDay(), lookout, boost: scan ? 1.6 : focus === 'water' ? 1.4 : 1 });
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
      const calls = S.world.animals.filter(a => a.signs?.call && a.cls !== 'invertebrate' && S.rng.chance(clamp(a.perKm2 / 15) * (timeOfDay() === 'day' ? 0.5 : 1))).slice(0, 3)
        .map(a => { const sig = S.mem.signs?.[`call:${a.signs.call}`]; const who = sig?.linked ? ` (${entity(sig.linked)?.name ?? 'something'})` : ''; return `${a.signs.call}${who} to the ${COMPASS_RANDOM()}, ${a.cls === 'large' ? 'some way off' : 'close'}`; });
      if (calls.length) report.push(`Calls: ${calls.join('; ')}.`);
      log(report.length ? `Scanning and listening:\n${report.join('\n')}` : 'Scanned and listened for half an hour. Nothing beyond the immediate.', 'survey');
    } else log(report.length ? `From up here:\n${report.join('\n')}` : 'From up here I can see a long way, but nothing I haven’t already noted.', 'survey');
  } else if (report.length) log(report.join(' '), 'note');
}

// ------------------------------------------------------------ travel

function arrive(x, y, how, onTheWay = null) {
  const s = newSite(x, y);
  noteTrail(S.mem, s.key);
  S.here = S.sites.indexOf(s);
  if (how) log(how); // the walk first, then what it found
  const fresh = S.sites[S.sites.length - 1] === s && s.visits === 0;
  for (const u of S.suspects) if (!u.reached && atTarget({ x, y }, { truePos: u.truePos, sus: u })) {
    u.reached = true;
    if (fresh && s.name !== 'where I woke') s.name = placeNameFor(u, x, y); // the place takes the landmark's name
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
      const wkey = waterKeyAt(S.L, best.x, best.y);
      const wname = waterName(wkey, S.L.chan[cellOf(best.x, best.y)] >= 3 ? 'river' : 'stream', best);
      notePoint(wkey, best);
      newSite(wx, wy, waterSiteName(wname, wx, wy));
      const first = !S.milestones.water;
      log(`${first ? 'Water! ' : ''}${best.lake ? 'A lake' : 'A watercourse'} just to the ${bearingWord(bearing(s, best))}, ${timeWords(best.d * CELL / 3000)} away: ${wname}. Marked it.`, first ? 'act' : 'note');
      for (const u of S.suspects) if (!u.reached && u.group === 'water' && Math.hypot(u.truePos.x - best.x, u.truePos.y - best.y) <= 4) u.reached = true;
      waterFound();
    }
  }
  if (S.looking) {
    S.ch.focus = clamp(S.ch.focus - 0.03);
    lookHere(s);
    breakthroughs(s, S.looking.key);
    if (S.looking.type !== 'distant') sense(s, false, { focus: 'water' });
  } else {
    look(s, 0.4);
    sense(s);
  }
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
    for (const c of perceive(S.L, path[i], { time: timeOfDay() })) {
      if (c.channel !== 'sight' || !['hill', 'cliff', 'lake'].includes(c.kind) || c.trueDist > 900) continue;
      const { sus, isNew } = associate(c, path[i]);
      if (isNew) passed.push(`${sus.label} (${bearingWord(bearing(path[i], sus.est))})`);
    }
  }
  if (passed.length) log(`On the way I passed ${passed.join(', ')}.`, 'note');
}
// Every stream crossed on a walk gets its body-of-water name; the crossing is remembered on the edge.
function noteCrossings(trip) {
  const names = [], keys = [];
  for (const c of trip.crossings) {
    const wkey = waterKeyAt(S.L, c.x, c.y);
    if (!wkey) continue;
    const n = waterName(wkey, c.size >= 3 ? 'river' : 'stream', c);
    notePoint(wkey, c);
    if (!keys.includes(wkey)) { keys.push(wkey); names.push(n); }
  }
  if (keys.length) S.crossedWater = true; // the milestone is logged on arrival, after the walk's own line
  return { names, keys };
}
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
function rememberLeg(fromKey, toKey, hours, keys) {
  if (fromKey === toKey) return;
  const k = edgeKey(fromKey, toKey), old = S.walked[k];
  S.walked[k] = { hours: old ? 0.5 * (old.hours + hours) : hours, crossings: [...new Set([...(old?.crossings ?? []), ...keys])] };
}
// A walk is remembered as legs between the places it passed: a place I already knew that the path
// comes within PASS_R cells (about 150 m) of splits the walk there, so trails run through the places
// they really go by. Each leg's share of the time is its share of the walk's estimated time.
const PASS_R = 2;
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
  const at = crossings.map(c => ({ i: path.findIndex(p => p.x === c.x && p.y === c.y), key: waterKeyAt(S.L, c.x, c.y) })).filter(c => c.key);
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
  const fr = target.frontier ? frontierPoints().find(f => f.key === target.frontier) : null;
  return { sus, dest, fr, truePos: sus?.truePos ?? dest ?? fr, name: sus?.label ?? dest?.name ?? fr?.name ?? 'there' };
}
// Am I at it? For water, being at its edge counts: a lake or a river is bigger than its marker.
function atTarget(p, info) {
  if (!info.truePos) return false;
  if (Math.hypot(p.x - info.truePos.x, p.y - info.truePos.y) <= 2) return true;
  const u = info.sus;
  if (u?.group === 'water' && u.kind !== 'river trace') {
    const want = waterKeyOf(u.trueKey);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = p.x + dx, y = p.y + dy; if (x >= 0 && y >= 0 && x < GN && y < GN && waterKeyAt(S.L, x, y) === want) return true; }
  }
  return false;
}
// Didn't get there: say so, with a revised direction and walking time.
function missedTarget(target, from) {
  const { sus, name } = targetInfo(target), here = site();
  let est = { x: target.x, y: target.y }, how;
  if (sus) {
    const c = perceive(S.L, here, { time: timeOfDay(), boost: 1.4 }).find(k => k.key === sus.trueKey);
    if (c) { const g = suspicionFrom(c, here, S.rng); sus.est = est = g.est; how = `I can still ${c.channel === 'sound' ? 'hear' : 'see'} it`; }
    else if (Math.hypot(here.x - sus.est.x, here.y - sus.est.y) <= 2) { sus.est = est = { x: Math.round(sus.est.x + (sus.est.x - from.x) * 0.5), y: Math.round(sus.est.y + (sus.est.y - from.y) * 0.5) }; how = 'no sign of it where I expected; probably further on'; }
    else { est = sus.est; how = 'by my reckoning'; }
  } else how = 'by my reckoning';
  if (Math.hypot(here.x - est.x, here.y - est.y) < 1) return;
  log(`Didn’t reach ${name}. ${cap(how)}: ${awayWords(lineHours(S.L, here, est), sus && sus.channel === 'sound' && sus.obs < 2 ? 'unknown' : 'guess')}, to the ${bearingWord(bearing(here, est))}.`, 'thought');
}

// Head straight for something: a suspected landmark, a known place, or the edge of the unexplored.
function travelTo(target, label) {
  const from = site();
  const thirsty = S.hyd < 0.55;
  let n = 0;
  const { sus, dest, truePos } = targetInfo(target);
  const resense = sus ? p => { if (++n % 6) return null; const c = perceive(S.L, p, { time: timeOfDay() }).find(k => k.key === sus.trueKey); return c ? suspicionFrom(c, p, S.rng).est : null; } : null;
  const predicted = mapHours(from, sus ? sus.id : dest ? dest.key : target.frontier, target);
  const trip = walk(S.L, from, target, { rng: S.rng, maxHours: 3, resense, stopAtWater: thirsty, driftSd: dest ? 1.5 : 2.5 });
  const knownBefore = S.sites.length;
  const hours = trip.hours * (S.looking ? 1.25 : 1); // looking as I go slows me down
  if (S.looking) S.ch.focus = clamp(S.ch.focus - 0.05);
  pass(hours, 300);
  const { names, keys } = noteCrossings(trip);
  const dur = timeWords(hours, 'known');
  const stoppedAtWater = thirsty && trip.crossings.length && trip.end.x === trip.crossings[trip.crossings.length - 1].x && trip.end.y === trip.crossings[trip.crossings.length - 1].y;
  const where = S.L.veg[cellOf(trip.end.x, trip.end.y)] > 0.55 ? 'thick woodland' : S.L.veg[cellOf(trip.end.x, trip.end.y)] > 0.3 ? 'scrubby woodland' : 'open ground';
  const text = `${S.looking ? 'Walked, watching for ' + S.looking.label + ',' : 'Pushed'} ${label} for ${dur}, through ${where}${names.length ? `; crossed ${names.join(' and ')}` : ''}.${stoppedAtWater ? ' Parched, I stopped at the water.' : ''}${hours >= 2.9 && !stoppedAtWater ? ' Stopped to get my bearings.' : ''}`;
  const reached = atTarget(trip.end, targetInfo(target));
  arrive(trip.end.x, trip.end.y, text, () => { notePassing(trip.path); lookAlong(trip.path); });
  rememberTrip(from, trip.path, hours, trip.crossings, knownBefore);
  if (!reached) missedTarget(target, from);
  else if (predicted) {
    const why = explainTrip(S.L, trip.path, predicted, hours, { believedDist: distM(from, target), trueDist: distM(from, truePos), idx: cellOf, CELL });
    if (why) log(why, 'thought');
  }
}

const targetRef = v => (v.sus ? { suspect: v.sus } : v.site !== undefined ? { site: v.site } : v.frontier ? { frontier: v.key } : {});

function followTheWater(dir) {
  const from = site();
  const trip = followWater(S.L, from, dir, 2.5);
  if (!trip.hours) return log(`Can’t do that from here: ${trip.stopped}.`, 'warn');
  pass(trip.hours, 260);
  const dur = trip.hours < 1 ? `${Math.round(trip.hours * 60)} minutes` : `${trip.hours.toFixed(1).replace(/\.0$/, '')} hours`;
  const endsInLake = trip.path.some(p => S.L.lake[cellOf(p.x, p.y)]), knownBefore = S.sites.length;
  arrive(trip.end.x, trip.end.y, `Followed the water ${dir === 'down' ? 'downstream' : 'upstream'} for ${dur}${endsInLake ? ', past the edge of a lake' : ''}${trip.stopped ? `; ${trip.stopped}` : ''}.`);
  rememberTrip(from, trip.path, trip.hours, [], knownBefore);
}

function waterHere(s) {
  const c = cellOf(s.x, s.y);
  if (S.L.chan[c] || s.micro === 'spring') return true;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = s.x + dx, y = s.y + dy; if (x >= 0 && y >= 0 && x < GN && y < GN && (S.L.lake[cellOf(x, y)] || S.L.chan[cellOf(x, y)])) return true; }
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
  const time = S.t < 8 ? 'dawn' : S.t >= 18 ? 'dusk' : 'day';
  const before = new Set(Object.keys(S.mem.entities));
  const out = observeSite(S.world, S.mem, { site: s.key, micro: s.micro, skill, time });
  for (const id of out.noticed) s.known.add(id);
  const fresh = Object.keys(S.mem.entities).filter(k => !before.has(k)).map(entity).filter(e => e && ((e.kind === 'animal' && e.cls !== 'invertebrate') || ['tree', 'shrub'].includes(e.form))).pop(); // memorable things only
  if (fresh) S.recentNotice = fresh.name;
  s.visits++;
  log(out.text, 'note');
}

// ------------------------------------------------------------ time, needs, body

function pass(hours, kcal = 150) {
  const steps = Math.max(1, Math.ceil(hours / 0.5));
  const dt = hours / steps;
  for (let i = 0; i < steps; i++) {
    S.t += dt;
    if (S.t >= 24) { S.t -= 24; S.day++; } // past midnight
    S.hyd -= dt * (0.032 + 0.02 * Math.max(0, kcal - 150) / 250 + 0.02 * S.sick);
    S.energy -= dt * kcal / 24000; // the stock holds about ten days of reserves
    S.gut = Math.max(0, S.gut - 0.12 * dt); // a stomach-full clears in half a day or so
    if (S.inv.length > 1) touch(S.inv, 0.01 * dt, false); // things carried together share what's on them
    const warm = Math.pow(2, (S.world.environment.meanTempC - 20) / 10);
    for (const it of S.inv) if (it.kind === 'food' && it.props.chem.water > 0.5) it.props.germs = Math.min(1, it.props.germs + dt * 0.008 * warm * (1 - it.props.germs));
    const fade = Math.exp(-dt / 24); for (const k of ['p', 'f', 'c']) S.macro[k] *= fade; // roughly the last day's diet
    const nearFire = fireHere();
    for (const it of S.inv) if (it.props.moisture !== undefined && it.kind !== 'food') dry(it, (dt / 24) * (nearFire ? 3 : 1), S.ambient);
    for (const p of [...S.pendingSick]) if (now() >= p.at) {
      S.sick = clamp(S.sick + p.severity);
      S.pendingSick.splice(S.pendingSick.indexOf(p), 1);
      if (p.lore) S.lore[p.lore].sick++;
      log(p.text, 'warn');
    }
  }
  S.hyd = clamp(S.hyd); S.energy = clamp(S.energy);
  const cap = 1 - 0.6 * Math.max(0, 0.4 - S.hyd) / 0.4 - 0.4 * Math.max(0, 0.3 - S.energy) / 0.3 - 0.5 * S.sick;
  S.ch.focus = Math.min(S.ch.focus, clamp(cap, 0.1, 1));
  if (S.hyd <= 0.02 || S.energy <= 0.02 || S.sick >= 0.95) collapse();
}

function collapse() {
  const why = S.hyd <= 0.02 ? 'thirst' : S.energy <= 0.02 ? 'hunger' : 'sickness';
  log(`Everything went grey. I lay down where I was and lost the rest of the day to ${why}.`, 'warn');
  S.collapsed++;
  S.hyd = Math.max(S.hyd, 0.35); S.energy = Math.max(S.energy, 0.12); S.sick = Math.min(S.sick, 0.6);
  sleep(true);
}

function sleep(forced = false) {
  const s = site();
  const banked = fireHere() && takeWood(2) === 2;
  const cold = S.world.environment.meanTempC < 10;
  let q = 0.5 + (s.hut ? 0.3 : 0) + (banked ? 0.3 : 0) - (cold && !s.hut && !banked ? 0.25 : 0);
  const biters = S.world.environment.meanTempC >= 8 && !banked && S.world.animals.some(a => ['mosquito', 'gnat'].includes(a.traits.key) && (waterHere(s) || a.habitats.some(h => h.micro === s.micro)));
  if (biters) q -= 0.15;
  q = clamp(q, 0.15, 1);
  const hoursToMorning = S.t < 6 ? 6 - S.t : 30 - S.t;
  for (const it of S.inv) if (it.props.moisture !== undefined && it.kind !== 'food') dry(it, hoursToMorning / 24, S.ambient);
  rest(S.ch);
  S.ch.fatigue = clamp(S.ch.fatigue + (1 - q) * 0.35);
  S.hyd = clamp(S.hyd - 0.12); S.energy = clamp(S.energy - 0.035);
  S.sick = clamp(S.sick - 0.25 * q);
  if (S.t >= 6) S.day++;
  S.t = 6;
  if (banked) s.fireUntil = now() + 1.5;
  const words = q >= 0.8 ? 'Slept warm and deep.' : q >= 0.55 ? 'Slept well enough.' : q >= 0.35 ? 'A cold, broken night.' : 'Barely slept; cold to the bone.';
  if (!forced) log(`${words}${biters ? ` ${S.world.animals.some(a => a.traits.key === 'mosquito') ? 'Mosquitoes' : 'Gnats'} whined at my ears half the night; smoke would have kept them off.` : ''}${banked ? ' Banked the fire with two pieces of wood; it was still glowing at dawn.' : ''}${s.hut ? ' The hut kept the wind off.' : ''}`, 'act');
  for (const p of [...S.pendingSick]) if (now() >= p.at) { S.sick = clamp(S.sick + p.severity); S.pendingSick.splice(S.pendingSick.indexOf(p), 1); log(p.text, 'warn'); }
}

function bodyWords() {
  const w = [];
  const ch = S.ch;
  w.push(S.hyd > 0.7 ? 'Not thirsty.' : S.hyd > 0.45 ? 'Thirsty.' : S.hyd > 0.2 ? 'Very thirsty; my head aches.' : 'Parched. I need water now.');
  w.push(S.energy > 0.68 ? 'Fed enough.' : S.energy > 0.45 ? 'Hungry.' : S.energy > 0.25 ? 'Very hungry; weak in the legs.' : 'Starving and shaky.');
  w.push(ch.fatigue < 0.3 ? 'Rested.' : ch.fatigue < 0.6 ? 'Getting tired.' : ch.fatigue < 0.85 ? 'Tired.' : 'Exhausted.');
  w.push(ch.hands < 0.25 ? 'Hands fine.' : ch.hands < 0.5 ? 'Palms sore.' : ch.hands < 0.8 ? 'Palms blistered.' : 'Blisters open; palms raw.');
  if (ch.callus > 0.25) w.push('Calluses forming.');
  w.push(ch.focus > 0.7 ? 'Thinking clearly.' : ch.focus > 0.4 ? 'Thinking feels slow.' : 'Thinking feels foggy.');
  const mt = S.macro.p + S.macro.f + S.macro.c;
  if (mt > 600 && S.macro.p / mt > 0.33) w.push('Too much lean food lately; I crave fat or starch.');
  else if (mt > 900 && S.macro.f / mt < 0.08) w.push('Craving something fatty.');
  if (S.gut > 1.1) w.push('Full.');
  if (S.ch.germs > 0.35) w.push('Filthy hands.');
  if (S.showProps) w.push(`(hands: germs ${S.ch.germs.toFixed(2)})`);
  if (S.sick > 0.1) w.push(S.sick > 0.6 ? 'Badly sick.' : S.sick > 0.3 ? 'Sick to my stomach.' : 'A bit queasy.');
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
const GERMS = { fruit: 0.05, nut: 0.05, seed: 0.05, grain: 0.08, pod: 0.06, storage: 0.3, root: 0.3, leaf: 0.12, stem: 0.1, flower: 0.05, innerBark: 0.08, invertebrate: 0.3, fattyGrub: 0.3, shellfish: 0.45, mushroom: 0.15, lichen: 0.1, honey: 0.02,
  stone: 0.05, edge: 0.05, wood: 0.04, shoot: 0.03, stalk: 0.03, tindermat: 0.05, tinder: 0.05, bone: 0.4, finebone: 0.4, moss: 0.15, diggingstick: 0.15, board: 0.03, spindle: 0.03 };
function touch(items, k = 0.4, hands = true) {
  const xs = items.filter(Boolean);
  const all = [...xs.map(i => i.props.germs ?? 0), ...(hands ? [S.ch.germs] : [])];
  if (!all.length) return;
  const m = all.reduce((a, b) => a + b, 0) / all.length;
  for (const i of xs) i.props.germs = Math.round(((i.props.germs ?? 0) + k * (m - (i.props.germs ?? 0))) * 1000) / 1000;
  if (hands) S.ch.germs += k * (m - S.ch.germs);
}
const waterGerms = () => waterSource(site()).hidden?.pathogen ?? 0.25;
const waterTempC = still => { const e = S.world.environment.meanTempC; return site().micro === 'spring' ? e : still ? e + 3 : Math.max(2, e - 1); };

// A food item carries its make-up (food.js) and mass in kg; preparation changes both.
function foodItem(name, chem, mass, labels, from, extra = {}) {
  return addItem(name, 'food', { chem: cloneChem(chem), mass }, from, { food: labels, base: name, prep: [], ...extra });
}
const has = kind => S.inv.some(i => i.kind === kind);
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
const loreKey = (e, part) => `${e.lookalike?.mimics ?? e.id}:${part}`;
const loreWords = l => (l.sick ? `made me sick ${l.sick > 1 ? `${l.sick} times` : 'once'}` : `ate fine ${l.ok > 1 ? `${l.ok} times` : 'once'}`);

// ------------------------------------------------------------ gathering what has been noticed here

function patchDensity(e, s) {
  const v = e.varying?.find(x => x.id === 'woodDensity');
  return v ? samplePatch(S.world, e.id, s.key, s.micro).traits.woodDensity : e.traits.woodDensity;
}
// kilocalories in a gathered portion (half an hour's foraging), converted to the reserve stock (24000 kcal ≈ 1)

function gatherOptions(s) {
  const opts = [];
  const cutter = bestEdge();
  for (const m of S.mats) {
    if (!s.known.has(m.source)) continue;
    const e = entity(m.source);
    if (!e) continue;
    const nm = e.name;
    const needEdge = m.collect === 'flake';
    const softGround = ['streambank', 'pond', 'claybank', 'spring'].includes(s.micro) && /hands in soft ground/.test(e.parts?.find(x => x.part === m.part)?.collect ?? '');
    const needStick = m.collect === 'digging-stick' && !softGround && !bestStick();
    const add = (label, fn, hours = 0.3, kcal = 200) => opts.push({ label, part: label.replace(/ \(.*$/, '').replace(/ · .*$/, ''), species: nm, fn, hours, kcal, blocked: needEdge && !cutter ? 'needs a cutting edge' : needStick ? 'needs a digging stick' : null });
    switch (m.material) {
      case 'dead-wood':
        add(`Dead wood (${nm})`, () => addItem(`dead wood, ${nm}`, 'wood', { density: patchDensity(e, s), resin: m.props.resin, moisture: S.ambient + 0.06 }, { id: e.id, name: nm, part: 'dead wood', site: s.key }), 0.3, 250);
        if (e.form === 'shrub') add(`Dead shoots (${nm})`, () => addItem(`dead shoot, ${nm}`, 'shoot', { density: patchDensity(e, s), moisture: S.ambient + 0.02, straightness: 0.72 }, { id: e.id, name: nm, part: 'dead shoots', site: s.key }), 0.25);
        break;
      case 'live-wood':
        if (m.props.straight) add(`Green shoot (${nm})`, () => addItem(`green shoot, ${nm}`, 'shoot', { density: patchDensity(e, s), moisture: 0.55, straightness: 0.9 }, { id: e.id, name: nm, part: 'green shoot', site: s.key }), 0.3);
        break;
      case 'dead-stalk':
        add(`Dead stalk (${nm})`, () => addItem(`dead stalk, ${nm}`, 'stalk', { density: 0.3, moisture: S.ambient, straightness: 0.95 }, { id: e.id, name: nm, part: 'dead stalk', site: s.key }), 0.2);
        break;
      case 'dry-grass': case 'fluff': case 'fungus-tinder': case 'lichen-tinder':
        add(`${cap(m.part)} (${nm})`, () => addItem(`${m.part}, ${nm}`, 'tindermat', { moisture: S.ambient * (m.material === 'fungus-tinder' ? 0.9 : 0.6) }, { id: e.id, name: nm, part: m.part, site: s.key }), 0.25);
        break;
      case 'moss':
        add(`Moss (${nm})`, () => addItem(`moss, ${nm}`, 'moss', { moisture: S.ambient + 0.2 }, { id: e.id, name: nm, part: 'moss', site: s.key }), 0.2);
        break;
      case 'outer-bark':
        if (m.props.papery) add(`Papery bark (${nm})`, () => addItem(`papery bark, ${nm}`, 'tindermat', { moisture: S.ambient * 0.7 }, { id: e.id, name: nm, part: 'outer bark', site: s.key }), 0.25);
        break;
      case 'inner-bark':
        if (m.props.fiber > 0.4) add(`Inner bark for tinder (${nm})`, () => addItem(`inner bark for tinder, ${nm}`, 'tindermat', { moisture: S.ambient + 0.1 }, { id: e.id, name: nm, part: 'inner bark', site: s.key }), 0.4);
        break;
      case 'stone':
        add(`Fist-sized stone (${nm})`, () => addItem(`stone, ${nm}`, 'stone', { fracture: m.props.fracture, flaws: m.props.flaws, hardness: m.props.hardness, mass: Math.round(S.rng.uniform(450, 1100)), rough: m.props.abrasive ? 0.85 : 0.35, spall: m.props.spall ?? 0.3 }, { id: e.id, name: nm, part: 'cobble', site: s.key }), 0.15);
        if (m.props.slab) add(`Flat slab (${nm})`, () => addItem(`flat slab, ${nm}`, 'slab', { mass: 6000, hardness: m.props.hardness }, { id: e.id, name: nm, part: 'slab', site: s.key }), 0.2, 300);
        break;
      case 'plant-food': {
        const part = e.parts.find(x => x.part === m.part);
        const lore = S.lore[loreKey(e, m.part)];
        if (part?.food && part.chem) add(`${cap(m.part)} to eat (${nm})${lore ? ` · ${loreWords(lore)}` : ''}`, () => foodItem(`${m.part} to eat, ${nm}`, part.chem, part.chem.gather, part.food, { id: e.id, name: nm, part: m.part, site: s.key }), 0.5);
        break;
      }
    }
  }
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
    if (e?.kind === 'animal' && e.cls === 'invertebrate' && e.food) {
      const lore = S.lore[loreKey(e, 'whole')];
      opts.push({ label: `A handful of ${e.name}${/s$/.test(e.name) ? '' : 's'} to eat${lore ? ` · ${loreWords(lore)}` : ''}`, part: 'Small creatures to eat', species: e.name, hours: 0.5, kcal: 180, fn: () => stung(e) || foodItem(`${e.name}s, a handful`, e.chem, e.chem.gather, e.food, { id: e.id, name: e.name, part: 'whole', site: s.key }, { animal: true }) });
    }
  }
  return opts;
}

function runningWaterHere() { const s = site(); return waterHere(s) && NB_CELLS(s).some(c => S.L.chan[c] > 0); }
const NB_CELLS = s => { const out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = s.x + dx, y = s.y + dy; if (x >= 0 && y >= 0 && x < GN && y < GN) out.push(cellOf(x, y)); } return out; };

// Raiding a stinging insect's nest: smoke from a fire here keeps them sluggish; otherwise, stings.
function stung(e) {
  if (!/stings/.test(e.defense ?? '')) return null;
  if (fireHere()) { log(`Smoke from the fire kept the ${pluralize(e.name)} sluggish; only a sting or two.`); return null; }
  S.ch.hands = clamp(S.ch.hands + 0.2); S.sick = clamp(S.sick + 0.05);
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
    T.push(['Snap test', () => MOIST_WORDS(noisy(it.props.moisture), S.ambient)]);
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

function craft(id, mode) {
  const r = S.rng, ch = S.ch;
  const R = RECIPES.find(x => x.id === id);
  const pickd = Object.fromEntries(R.slots.map(([k, , list]) => [k, pickSlot(id, k, list())]));
  const prov = it => ({ name: it.from?.name ?? it.name, source: it.from?.id, site: it.from?.site });
  const asEdge = it => ({ props: it.props, name: 'flake' });
  if (isNight()) return log('Too dark to work. Time to sleep.', 'warn');
  const uid0 = S.uid;
  if (craftSwitch(id, mode, r, ch, R, pickd, prov, asEdge) === 'rinsed') return;
  // everything handled together shares what's on it: the inputs still carried, what was made, my hands
  touch([...Object.values(pickd).filter(i => i && S.inv.includes(i)), ...S.inv.filter(i => i.uid >= uid0)], 0.4);
  const kill = { roast: 0.05, stoneboil: 0.01, harden: 0.2, scorch: 0.05 }[id];
  if (kill) for (const i of [...Object.values(pickd), ...S.inv.filter(x => x.uid >= uid0)]) if (i && S.inv.includes(i)) i.props.germs = Math.round(i.props.germs * kill * 1000) / 1000;
}
function craftSwitch(id, mode, r, ch, R, pickd, prov, asEdge) {
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
      const anvil = { props: { mass: slab ? 6000 : 1500 } };
      const res = knapFlakes(r, ch, { props: core.props, provenance: prov(core) }, { props: hammer.props }, anvil);
      pass(0.25, 200);
      res.flakes.forEach(f => flakeItem(f, `flake, ${core.from.name}`));
      log(res.flakes.length ? `Smashed the ${core.from.name} stone ${slab ? 'on the slab' : 'against a rock'}: ${res.flakes.length} usable flake${res.flakes.length > 1 ? 's' : ''}.` : `Smashed the ${core.from.name} stone; nothing but crumbs and blunt chunks.`);
      if (res.flakes.length && !S.milestones.edge) { S.milestones.edge = true; log('My first cutting edge.', 'milestone'); }
      if (S.rng.chance(0.25)) remove(core);
      break;
    }
    case 'notch': {
      const { wood, edge } = pickd;
      const hours = mode === 'careful' ? 1.0 : 0.4;
      const res = notchHearth(r, ch, { props: wood.props, provenance: prov(wood) }, asEdge(edge), hours);
      pass(hours, 160);
      remove(wood);
      addItem(`hearth board, ${wood.from.name}`, 'board', res.board.props, wood.from);
      log(`${mode === 'careful' ? 'Took my time and' : 'Quickly'} split and notched a hearth board from the ${wood.from.name} wood.`);
      dullCheck(edge);
      break;
    }
    case 'refine': {
      const { board, edge } = pickd;
      const res = refineNotch(r, ch, board, asEdge(edge));
      pass(0.6, 150);
      delete board.notes['Inspect the notch'];
      log(res.after > res.before ? 'Worked the notch slowly; it’s cleaner now.' : 'The edge slipped and tore the notch a little.');
      dullCheck(edge);
      break;
    }
    case 'carve': {
      const { shoot, edge } = pickd;
      const res = carveSpindle(r, ch, { props: shoot.props, provenance: prov(shoot) }, asEdge(edge));
      pass(0.5, 160);
      remove(shoot);
      addItem(`spindle, ${shoot.from.name}`, 'spindle', res.spindle.props, shoot.from);
      log(`Carved a spindle from the ${shoot.from.name} ${shoot.kind === 'shoot' && shoot.props.moisture > 0.3 ? 'shoot. It’s green; it will need to dry' : 'shoot'}.`);
      dullCheck(edge);
      break;
    }
    case 'trim': {
      const { stalk } = pickd;
      pass(0.15, 130);
      remove(stalk);
      addItem(`spindle, ${stalk.from.name}`, 'spindle', { ...stalk.props, length: 70 }, stalk.from);
      log(`Snapped a ${stalk.from.name} stalk to length and rubbed it smooth: a spindle.`);
      break;
    }
    case 'digstick': {
      // hardness of the point: wood density, plus a little for a clean shape; green wood is softer until dried
      const { stick, tool } = pickd;
      const cut = tool.kind === 'edge';
      const hours = cut ? 0.5 : 1.0; // grinding a point on rough stone is slow
      pass(hours, 200);
      const d = stick.props.density ?? 0.45;
      const finish = clamp((cut ? 0.6 + 0.4 * (tool.props.sharpness ?? 0.5) : 0.5) * (0.8 + 0.4 * ch.focus) + S.rng.normal(0, 0.08));
      const green = (stick.props.moisture ?? 0.15) > 0.3;
      const hardness = clamp(d * (0.75 + 0.25 * finish) - (green ? 0.08 : 0), 0.1, 0.95);
      remove(stick);
      addItem(`digging stick, ${stick.from.name}`, 'diggingstick', { density: d, moisture: stick.props.moisture, hardness, finish, hardened: 0 }, stick.from);
      if (cut) { tool.props.sharpness = Math.max(0, tool.props.sharpness - 0.04); dullCheck(tool); }
      log(`Shaped a digging stick from the ${stick.from.name} ${stick.kind === 'shoot' ? 'shoot' : 'wood'}, ${cut ? 'whittling' : 'grinding'} the end to a chisel point on ${cut ? 'the edge' : 'a rough stone'}.`);
      if (!S.milestones.stick) { S.milestones.stick = true; log('A digging stick.', 'milestone'); }
      break;
    }
    case 'harden': {
      const { stick } = pickd;
      const careful = mode === 'careful';
      pass(careful ? 0.75 : 0.3, 140);
      const p = stick.props;
      const room = 1 - p.hardness;
      const charred = !careful && S.rng.chance(0.35);
      p.hardness = clamp(p.hardness + room * (careful ? 0.3 : 0.18) * (p.hardened ? 0.4 : 1) - (charred ? 0.08 : 0));
      p.moisture = Math.min(p.moisture ?? 0.2, S.ambient + 0.02);
      p.hardened++;
      log(charred ? 'Hurried the stick over the fire and charred the tip; scraped off the black. Harder underneath, but the point is thinner.' : `Turned the point over the coals until it browned${careful ? ', slowly, a little at a time' : ''}. It rings harder when tapped.`);
      break;
    }
    case 'pound': case 'grind': case 'chop': case 'roast': case 'leach': case 'soak': case 'dryfood': case 'stoneboil': {
      const { food } = pickd;
      const q = clamp(0.5 + 0.4 * ch.focus + S.rng.normal(0, 0.1));
      let ex, hours, kcal = 180, tag, cond = {};
      if (id === 'pound') { // a hard, heavy pounding stone does more per blow
        const st = pickd.stone; cond.crushPower = clamp(st.props.hardness / 7, 0.3, 1) * clamp(Math.sqrt(st.props.mass / 800), 0.6, 1.2);
        ex = { crush: 0.5 }; hours = 0.25; kcal = 260; tag = 'pounded';
      } else if (id === 'grind') { // gritty stones grind; smooth ones polish
        cond.rough = Math.max(...ofKind('stone').map(x => x.props.rough ?? 0.4));
        ex = { grind: 0.9 }; hours = 0.75; kcal = 240; tag = 'ground';
      } else if (id === 'chop') { const e = pickd.edge; cond.crushPower = 1; ex = { cut: 0.25 + 0.25 * (e.props.sharpness ?? 0.5) }; hours = 0.2; kcal = 150; tag = 'chopped'; e.props.sharpness = Math.max(0, e.props.sharpness - 0.01); }
      else if (id === 'roast') { ex = { heat: { mode: 'roast', minutes: mode === 'careful' ? 25 : 10 } }; hours = mode === 'careful' ? 0.5 : 0.25; tag = 'roasted'; }
      else if (id === 'leach' || id === 'soak') { hours = Number(mode); ex = { water: { mode: id === 'leach' ? 'running' : 'still', hours, tempC: waterTempC(id === 'soak') } }; kcal = 140; tag = `${id === 'leach' ? 'leached' : 'soaked'} ${hours} h`; }
      else if (id === 'stoneboil') { // hot stones dropped into the basin; enough of them bring it to a boil, and some crack
        const stones = ofKind('stone');
        cond.heatPower = Math.min(1.2, 0.3 * stones.length + 0.1);
        for (const st of stones) if (S.rng.chance((st.props.spall ?? 0.3) * 0.4)) { remove(st); log(`The ${st.name} burst with a crack in the fire.`, 'warn'); }
        ex = { heat: { mode: 'boil', minutes: 20 } }; hours = 0.75; kcal = 220; tag = cond.heatPower >= 0.9 ? 'boiled' : 'simmered';
        if (cond.heatPower < 0.9) log(`With only ${stones.length} stone${stones.length === 1 ? '' : 's'} the water never quite boiled.`);
      } else { hours = mode === 'fire' ? 2 : 4; ex = { dry: mode === 'fire' ? 12 : 8 }; kcal = 140; tag = 'dried'; }
      if (id === 'dryfood' && mode === 'fire' && !fireHere()) return log('There’s no fire here to dry it by.', 'warn');
      if (id === 'dryfood' && mode === 'sun' && isNight()) return log('Not at night.', 'warn');
      pass(hours, kcal);
      const before = food.props.chem;
      const after = expose(before, ex, q, cond);
      if (id === 'roast' && mode === 'quick' && S.rng.chance(0.3)) { food.props.mass *= 0.85; log('Some of it charred black.'); }
      food.props.mass = Math.round(food.props.mass * (1 - before.water) / Math.max(0.05, 1 - after.water) * 1000) / 1000; // water in or out changes the weight
      food.props.chem = after;
      food.notes = {}; // what I tasted before no longer holds
      food.prep.push(tag);
      food.name = `${food.base} (${food.prep.join(', ')})`;
      log(`${{ pound: 'Pounded', grind: 'Ground', chop: 'Chopped up', roast: 'Roasted', leach: 'Left', soak: 'Soaked', dryfood: 'Dried', stoneboil: 'Stone-boiled' }[id]} the ${food.from.part} of the ${food.from.name}${id === 'leach' ? ` in the stream for ${hours} hours` : id === 'soak' ? ` for ${hours} hours` : id === 'dryfood' ? (mode === 'fire' ? ' by the fire' : ' in the sun') : id === 'stoneboil' ? ` in the ${site().basin.kind}` : ''}. ${cap(textureWords(after))} now.`);
      break;
    }
    case 'basin': { // a hollow in rock, or a pit lined with clay, that holds water for hot-stone cooking
      const s = site();
      if (s.micro === 'claybank') { pass(1.5, 320); s.basin = { kind: 'clay-lined pit' }; log('Dug a pit beside the water and lined it with clay, smoothed wet. It holds water.'); }
      else { pass(0.5, 180); if (S.rng.chance(0.6)) { s.basin = { kind: 'rock hollow' }; log('Found a hollow in the rock that holds water: good enough to boil in with hot stones.'); } else log('Looked for a rock hollow that would hold water; nothing that doesn’t drain.'); }
      break;
    }
    case 'wash': { // rinsing helps, but leaves the water's own germs behind
      const { thing } = pickd; pass(0.1, 120);
      thing.props.germs = Math.round((thing.props.germs * 0.3 + 0.4 * waterGerms()) * 1000) / 1000;
      S.ch.germs = S.ch.germs * 0.5 + 0.3 * waterGerms();
      log(`Washed the ${thing.name} in the water.`);
      return 'rinsed'; // hands and thing are rinsed, not mixed
    }
    case 'scorch': { const { thing } = pickd; pass(0.1, 120); log(`Passed the ${thing.name} through the flames.`); break; }
    case 'tinder': {
      const { mat } = pickd;
      const res = makeTinder(r, ch, { props: mat.props, provenance: prov(mat) });
      pass(0.2, 140);
      remove(mat);
      addItem(`tinder bundle, ${mat.from.name}`, 'tinder', res.tinder.props, mat.from);
      log(`Shredded the ${mat.from.name} ${mat.from.part} into a tinder nest.`);
      break;
    }
    case 'bone': {
      const { bone, hammer } = pickd;
      const res = splinterBone(r, ch, bone, { props: hammer.props });
      pass(0.2, 160);
      remove(bone);
      res.flakes.forEach(f => addItem('bone splinter', 'edge', f.props, bone.from));
      log(res.flakes.length ? `Cracked the bone: ${res.flakes.length} sharp splinter${res.flakes.length > 1 ? 's' : ''}.` : 'The bone shattered into useless bits.');
      if (res.flakes.length && !S.milestones.edge) { S.milestones.edge = true; log('My first cutting edge.', 'milestone'); }
      break;
    }
    case 'drill': drill(pickd.board, pickd.spindle, mode === 'until'); break;
  }
}

function dullCheck(edge) {
  if (edge.props.sharpness < 0.35 && !edge.toldDull) { edge.toldDull = true; log(`The ${edge.name} has gone dull.`, 'act'); }
}

const DRILL_LINES = [
  [r => r.success, 'smoke thickened and a mound of dark dust began to glow'],
  [r => r.margin > -0.6, 'thick smoke and dark dust, but no glow'],
  [r => r.margin > -1.6, 'some smoke; the dust stayed coarse and pale'],
  [() => true, 'barely warm; the spindle just polished the socket'],
];

// What a person would notice going wrong at the drill: the largest penalty in the performance score.
function drillTrouble(board, spindle) {
  const sk = S.ch.skills.firecraft, b = board.props, sp = spindle.props;
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

function drill(board, spindle, keepGoing) {
  const tally = {};
  let n = 0, stop = '';
  while (true) {
    if (S.ch.hands > 0.85) { stop = 'my palms are raw; I have to stop'; break; }
    if (S.ch.fatigue > 0.88) { stop = 'too tired to keep going'; break; }
    if (isNight()) { stop = 'too dark'; break; }
    if (board.props.life <= 0.05) { stop = 'the board has burned through'; remove(board); break; }
    if (spindle.props.length < 40) { stop = 'the spindle is worn too short'; remove(spindle); break; }
    const res = handDrill(S.rng, S.ch, board, spindle);
    pass(0.25, 400);
    n++;
    const line = DRILL_LINES.find(([f]) => f(res))[1];
    tally[line] = (tally[line] ?? 0) + 1;
    if (res.ember) {
      summarize();
      ember(res.ember);
      return;
    }
    if (!keepGoing) break;
  }
  summarize();
  function summarize() {
    const parts = Object.entries(tally).map(([k, v]) => (n > 1 ? `${v}× ${k}` : k));
    const trouble = n && !tally[DRILL_LINES[0][1]] && S.inv.includes(board) ? drillTrouble(board, spindle) : null;
    const tools = `with the ${spindle.from?.name ?? ''} spindle (${impressions(spindle).slice(0, 1).join('')}) on the ${board.from?.name ?? ''} board`;
    if (n) log(`${n > 1 ? `${n} attempts at the drill` : 'One attempt at the drill'} ${tools}: ${parts.join('; ')}.${trouble ? ` As far as I can tell, ${trouble}.` : ''}${stop ? ` Stopped: ${stop}.` : ''}`);
    else if (stop) log(`Can’t drill: ${stop}.`, 'warn');
  }
}

function ember(e) {
  if (!S.milestones.ember) { S.milestones.ember = true; log('An ember!', 'milestone'); }
  const tinder = ofKind('tinder')[0];
  if (!tinder) return log('An ember, but no tinder bundle ready. It faded in the notch.', 'warn');
  if (!has('wood')) return log('An ember, but no wood to feed a flame. It faded.', 'warn');
  const res = lightFire(S.rng, S.ch, e, tinder);
  pass(0.15, 180);
  remove(tinder);
  if (res.success) {
    takeWood(1);
    site().fireUntil = now() + 3;
    log('Tipped the ember into the tinder and blew. Smoke, then a flicker, then flame. Fire.', 'act');
    if (!S.milestones.fire) { S.milestones.fire = true; log(`Fire, on day ${S.day}.`, 'milestone'); }
  } else log('Tipped the ember into the tinder and blew, but it smothered and died.', 'warn');
}

// ------------------------------------------------------------ survey: a formal count of what's in eyeshot

const pluralize = n => (/fungus$/.test(n) ? n.replace(/fungus$/, 'fungi') : /louse$/.test(n) ? n.replace(/louse$/, 'lice') : /(s|sh|ch|x)$/.test(n) ? `${n}es` : /[^aeiou]y$/.test(n) ? `${n.slice(0, -1)}ies` : /(deer|fish|trout|elk|grouse|quail|boar)$/.test(n) ? n : `${n}s`);
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
function countWord(n) { return n < 10 ? String(Math.max(1, Math.round(n))) : `~${n < 30 ? Math.round(n / 5) * 5 : Math.round(n / 10) * 10}`; }
function lineFor(e, n) {
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

const memKeyE = e => e.lookalike?.mimics ?? e.id;
// What is present at a site (same abundance the field notes use), as { e, n }.
function presentAt(s) {
  const m = S.world.environment.microhabitats.find(x => x.id === s.micro);
  const f = siteFactors(S.world.seed, s.key, m);
  const out = [];
  for (const e of [...S.world.stones, ...S.world.plants, ...S.world.animals]) {
    const h = e.habitats.find(x => x.micro === s.micro);
    if (!h || (e.kind === 'animal' && e.cls !== 'invertebrate')) continue;
    const ar = makeRng(`${S.world.seed}/abund/${e.id}/${s.key}`);
    const count = (h.perInstance ?? h.pieces) * Math.exp((e.kind === 'stone' ? 0 : 0.35 * f.fertility) + 0.5 * ar.normal());
    if (!ar.chance(1 - Math.exp(-count / 2))) continue;
    out.push({ e, n: count });
  }
  return out;
}
function noteKnown(s, e) { s.known.add(e.id); (S.mem.entities[memKeyE(e)] ??= { seen: 0, traits: {} }).seen++; }

// What the nose picks up close by, in a survey.
function localSmells(s) {
  const here = presentAt(s).map(r => r.e), out = [];
  const nm = e => (S.mem.entities[memKeyE(e)] ? ` (${e.name})` : '');
  const find = f => here.find(e => e.kind === 'plant' && f(e.traits ?? {}));
  const resin = find(t => t.resin > 0.5); if (resin) out.push(`resin${nm(resin)}`);
  const onion = find(t => t.defense === 'sulfur'); if (onion) out.push(`onion, underfoot${nm(onion)}`);
  const mint = find(t => t.defense === 'aromatic'); if (mint) out.push(`something sharp and minty${nm(mint)}`);
  const fruit = find(t => ['berry', 'drupe'].includes(t.fruit)); if (fruit) out.push(`ripe fruit${nm(fruit)}`);
  if (here.some(e => e.form === 'mushroom')) out.push('damp, mushroomy earth');
  if (here.some(e => e.traits?.key === 'bee')) out.push('a waxy sweetness where bees are working');
  if (here.some(e => e.traits?.key === 'fly') && S.rng.chance(0.4)) out.push('droppings somewhere close, by the flies');
  if (S.world.animals.some(a => a.traits.key === 'predator' && a.habitats.some(h => h.micro === s.micro)) && S.rng.chance(0.3)) out.push('a musky reek where something has marked its ground');
  if (s.micro === 'pond' && smellsToday().some(x => x.kind === 'marsh' && Math.hypot(x.x - s.x, x.y - s.y) < 15)) out.push('stagnant water and rotting reeds');
  return out;
}

function survey(s) {
  const rows = [], fresh = [];
  noteTrail(S.mem, s.key);
  const memKey = memKeyE;
  for (const { e, n: count } of presentAt(s)) {
    if (e.cryptic) continue; // under stones, logs and bark: only poking around finds these
    const visible = e.kind === 'animal' ? 0.6 : { herb: 0.85, grass: 0.9, mushroom: 0.6, moss: 0.9, lichen: 0.8 }[e.form] ?? 0.97;
    if (!S.rng.chance(visible)) continue;
    if (!S.mem.entities[memKey(e)] && !fresh.includes(e)) fresh.push(e);
    rows.push({ e, n: count, text: lineFor(e, count) });
    noteKnown(s, e);
  }
  // animal sign: what's been left behind, not the animals themselves
  for (const a of S.world.animals.filter(a => a.cls !== 'invertebrate' && a.signs && a.habitats.some(h => h.micro === s.micro))) {
    if (!S.rng.chance(1 - Math.exp(-a.perKm2 * 0.3))) continue;
    const known = S.mem.entities[memKey(a)];
    const sign = a.signs.damage ?? (a.signs.track ? `sets of ${a.signs.track.type}` : a.signs.den);
    if (!sign) continue;
    rows.push({ n: 0.5, text: `${/^sets/.test(sign) ? 'a few' : '1'} ${sign.replace(/^(the|a) /, '')}${known ? ` (${a.name})` : ', left by some animal'}` });
  }
  for (const t of boneLines(boneFinds(s, 0.35))) rows.push({ n: 0.4, text: t });
  rows.sort((a, b) => b.n - a.n);
  const water = S.world.water.find(w => w.micro === (s.micro === 'streambed' ? 'streambank' : s.micro));
  const sm = localSmells(s);
  const lines = [...(water ? [`water: ${water.name}`] : []), ...rows.map(r => r.text), ...(sm.length ? [`smells: ${sm.join('; ')}`] : []), ...namingSentences(fresh, S.mem, s.key, entity, S.rng)];
  log(`Surveying what I can see from here:\n${lines.join('\n')}`, 'survey');
}

// ------------------------------------------------------------ poking around
//
// Turning stones and logs, peeling bark, prodding the leaf litter and dark corners of the underbrush.
// It finds what looking can't: grubs, beetles, worms, woodlice, crickets, snails, crayfish, and the small
// mushrooms of the litter, plus anything else small that lives here. A digging stick multiplies the
// ground covered by 1 + 1.5 × its hardness; poking blunts a soft stick faster than a hard one.
const bestStick = () => ofKind('diggingstick').sort((a, b) => b.props.hardness - a.props.hardness)[0] ?? null;
function pokeAround(s) {
  S.ch.germs += 0.25 * (0.45 - S.ch.germs); // soil and rot under the nails
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
function boneFinds(s, effort) { // effort: 1 = half an hour looking for nothing else
  const vis = BONE_VIS[s.micro] ?? 1;
  const found = { fine: 0, big: 0 };
  for (const a of S.world.animals) {
    if (a.cls === 'invertebrate' || !a.habitats.some(h => h.micro === s.micro)) continue;
    const mu = effort * vis * (a.perKm2 ?? 0) * (a.traits.mass ?? 0) / 600; // expected finds; 600 kg/km² per find is tuning
    let n = 0, L = Math.exp(-mu), p = 1; // Poisson draw
    do { n++; p *= S.rng.next(); } while (p > L && n < 20);
    found[isFineBoned(a) ? 'fine' : 'big'] += n - 1;
  }
  s.bones ??= { fine: 0, big: 0 };
  s.bones.fine = Math.min(4, s.bones.fine + found.fine);
  s.bones.big = Math.min(3, s.bones.big + found.big);
  return found;
}
const boneLines = f => [
  ...(f.big ? [`${f.big > 1 ? `${f.big} long bones` : 'a long bone'}, weathered pale, from something big`] : []),
  ...(f.fine ? [`${f.fine > 1 ? 'a scatter of' : 'a few'} fine, light bones from something small`] : []),
];

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
    if (!u) S.suspects.push(u = { id: `u${S.suspects.length + 1}`, kind: 'patch', group: 'patch', trueKey: `patch-${best.x}-${best.y}`, truePos: { x: best.x, y: best.y }, est: { x: best.x, y: best.y }, seenAt: { x: s.x, y: s.y }, channel: 'sight', obs: 1, label: uniqueName(SITE_NOUN[microAt(best.x, best.y)] ?? 'patch', best, []), reached: false });
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
  pass(0.5, 180);
  S.ch.focus = clamp(S.ch.focus - 0.03);
  lookHere(site(), false);
}
// Returns lines found; `passing` is the light version used on the move (no pointers, no "nothing").
function lookAt(s, passing) {
  const T = S.looking, lines = [];
  if (!T) return lines;
  if (T.type === 'distant') {
    for (const c of perceive(S.L, s, { time: timeOfDay(), boost: passing ? 1.2 : 1.6, lookout: !passing && isLookout(S.L, s.x, s.y) })) {
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
      const res = searchNaturalEdge(S.rng, S.ch, { props: m.props, provenance: { name: m.sourceName, source: m.source } });
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
  pass(0.25, 130);
  const parts = e.kind === 'plant' ? e.parts.map(p => p.part) : e.kind === 'stone' ? [] : e.products;
  const learned = learnedAbout(e);
  log(`Looked closely at the ${e.name}: ${e.cues.filter(c => !/^active:/.test(c)).join('; ')}.${parts.length ? ` Parts worth noting: ${parts.join(', ')}.` : ''}${learned.length ? ` What I’ve learned: ${learned.join('; ')}.` : ''}`, 'note');
}

// The character's educated guess from what's visible plus anything already learned. Costs focus.
function assess(e) {
  if (S.ch.focus < 0.25) return log('Too foggy to think it through. I need rest, water or food first.', 'warn');
  S.ch.focus = clamp(S.ch.focus - 0.08);
  pass(0.15, 110);
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
  if (picker.kind === 'follow') return pickerFrame('Follow the water', `<div class="gather"><button data-follow="down">Downstream</button><button data-follow="up">Upstream, or up a feeder</button></div>`);
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
  if (S.t < 17.5 && S.t >= 5) O.push(['dusk', 'Until dusk']);
  O.push(['morning', isNight() || S.t >= 18 ? 'Sleep until morning' : 'Until morning (skips the day)']);
  return O;
}
function restFor(choice) {
  if (choice === 'morning') return sleep();
  const hours = choice === 'dusk' ? 18 - S.t : Number(choice);
  pass(hours, 90);
  S.ch.fatigue *= Math.pow(0.15, hours / 9);
  S.ch.hands *= Math.pow(0.55, hours / 12);
  S.ch.focus = clamp(S.ch.focus + 0.12 * hours);
  log(choice === 'dusk' ? 'Rested in the shade until dusk.' : `Rested for ${hours === 1 ? 'an hour' : `${hours} hours`}.`);
}
// The Map: tap a place or landmark to hike there; tap a sequence of them to choose a route.
function mapHTML() {
  const M = mentalMap();
  const hi = M.nodes.findIndex(v => v.site === S.here), here = M.nodes[hi];
  if (M.nodes.length < 2) return '<p class="hint">Nothing on my map yet but where I stand. Scan or look out.</p>';
  const xs = M.nodes.filter(v => !v.frontier).map(v => v.x), ys = M.nodes.filter(v => !v.frontier).map(v => v.y);
  let x0 = Math.min(...xs) - 4, y0 = Math.min(...ys) - 4, span = Math.max(Math.max(...xs) - x0 + 4, Math.max(...ys) - y0 + 4, 16);
  if (S.mapView) ({ x: x0, y: y0, span } = S.mapView);
  const fs = span / 32;
  const E = M.edges.map(e => {
    const A = M.nodes[e.a], B = M.nodes[e.b], mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, len = Math.hypot(A.x - B.x, A.y - B.y);
    let ang = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180; // keep the time label upright, along the line
    return `<line class="edge ${e.certainty}${e.stub ? ' stub' : ''}" data-link="${e.kind}" data-a="${e.a}" data-b="${e.b}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke-width="${fs * 0.12}"><title>${esc(typo(`${cap(A.name)} – ${B.name}: ${timeWords(e.hours, e.certainty)}${e.crossings.length ? `, crossing ${e.crossings.map(c => c.name).join(' and ')}` : ''}`))}</title></line>`
      + (len > span / 9 ? `<text class="etime" x="${mx}" y="${my}" dy="${-fs * 0.3}" font-size="${fs * 0.7}" text-anchor="middle" transform="rotate(${ang.toFixed(1)} ${mx} ${my})">${esc(timeWords(e.hours, e.certainty))}</text>` : '')
      + e.crossings.map(c => `<circle class="xing${c.walked ? ' walked' : ''}" cx="${c.at.x}" cy="${c.at.y}" r="${fs * 0.32}"><title>${esc(typo(`${c.walked ? 'Crossed' : 'Probably crosses'} ${c.name}`))}</title></circle>`).join('');
  }).join('');
  const Nd = M.nodes.map((v, i) => {
    const e = M.edges.find(x => (x.a === hi && x.b === i) || (x.b === hi && x.a === i));
    const t = timeWords(e ? e.hours : lineHours(S.L, here, v), e ? e.certainty : v.certainty === 'known' ? 'guess' : v.certainty);
    const say = i === hi ? `${cap(v.name)} (here)` : `${v.site !== undefined ? 'Head back to' : 'Head for'} ${v.name} (${t})`;
    const label = v.frontier ? '' : `<text x="${v.x + fs * 0.8}" y="${v.y + fs * 0.35}" font-size="${fs}">${esc(typo(v.name.replace(/^the /, '')))}${v.certainty === 'unknown' ? '?' : ''}</text>`;
    return `<g ${i === hi ? '' : `data-hike="${v.key}" role="button" tabindex="0" `}aria-label="${esc(typo(say))}" class="node ${v.site !== undefined ? 'site' : v.frontier ? 'frontier' : 'sus'} ${v.certainty}${i === hi ? ' here' : ''}"><title>${esc(typo(say))}</title><circle cx="${v.x}" cy="${v.y}" r="${fs * (i === hi ? 0.65 : v.frontier ? 0.35 : 0.45)}" stroke-width="${fs * 0.12}"/>${label}</g>`;
  }).join('');
  const svg = `<svg class="mapsvg" viewBox="${x0} ${y0} ${span} ${span}" role="group" aria-label="My map of places and landmarks; north is up. Tap one to hike there.">${E}${Nd}</svg>`;
  const tools = `<div class="map-tools"><small class="hint">Tap a place to hike there; tap several in turn to pick a route. Drag to pan; pinch or scroll to zoom.</small>${S.mapView ? '<button class="ghost" data-mapfit="1">Fit</button>' : ''}</div>`;
  return `${svg}${tools}<p class="hint">North is up. Filled dots: places I’ve been. Rings: things I’ve seen or heard. Small dotted rings: unexplored ground. Blue marks: streams I crossed, or think I’d cross. Times are walking times; “~” is a guess, “?” I can’t say.</p>`;
}
// A tap on the map: hike straight to that node.
function hike(key) {
  const M = mentalMap(), v = M.nodes.find(n => n.key === key);
  if (!v || v.site === S.here) return;
  if (v.sus) { const u = S.suspects.find(x => x.id === v.sus); travelTo({ ...u.est, suspect: u.id }, `toward ${u.label}`); }
  else if (v.frontier) travelTo({ x: v.x, y: v.y, frontier: v.key }, `toward ${v.name}`);
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
  A.push({ id: 'scan', label: 'Scan', hint: 'the distance', disabled: S.t >= 22 });
  A.push({ id: 'make', label: 'Make', hint: 'from what’s on hand' });
  A.push({ id: 'inspect', label: 'Inspect', hint: 'something in particular', disabled: night });
  A.push({ id: 'collect', label: 'Collect', hint: 'something I can carry', disabled: night });
  if (waterHere(s)) A.push({ id: 'drink', label: 'Drink', hint: '' });
  if (waterHere(s)) A.push({ id: 'washhands', label: 'Wash my hands', hint: S.ch.germs > 0.3 ? 'they’re filthy' : '' });
  if (isLookout(S.L, s.x, s.y)) A.push({ id: 'lookout', label: 'Look out from up here', hint: '½ h; climb a tree if I must', disabled: night || S.t >= 19.5 });
  if (waterHere(s)) A.push({ id: 'follow', label: 'Follow the water', hint: 'downstream or up' , disabled: night });
  if (fireHere()) A.push({ id: 'feed', label: 'Feed the fire', hint: 'uses dead wood', disabled: !has('wood') });
  const trees = [...s.known].some(id => ['tree', 'shrub'].includes(entity(id)?.form));
  if (!s.hut && trees) A.push({ id: 'hut', label: 'Build a debris hut', hint: '3½ h', disabled: night });
  A.push({ id: 'rest', label: 'Rest', hint: 'an hour, till dusk, or the night' });
  return A;
}

function doHere(id) {
  const s = site();
  switch (id) {
    case 'survey': pass(0.75, 160); survey(s); break;
    case 'poke': pass(0.5, 230); pokeAround(s); break;
    case 'collect': case 'inspect': case 'make': case 'rest': case 'follow': picker = { kind: id, step: 'root' }; break;
    case 'look': if (S.looking) { log(`Stopped looking for ${S.looking.label}.`, 'thought'); S.looking = null; } else picker = { kind: 'look', step: 'root' }; break;
    case 'scan': pass(0.5, 120); S.ch.focus = clamp(S.ch.focus - 0.04); sense(s, false, { scan: true }); break;
    case 'lookout': pass(0.5, 200); sense(s, true); if (!S.milestones.lookout) { S.milestones.lookout = true; log('A view at last.', 'milestone'); } break;
    case 'washhands': pass(0.1, 110); S.ch.germs = S.ch.germs * 0.3 + 0.3 * waterGerms(); log('Washed my hands in the water.'); break;
    case 'drink': {
      const w = waterSource(s);
      pass(0.25, 120);
      S.hyd = 1;
      const p = w?.hidden.pathogen ?? 0.2;
      if (S.rng.chance(p * 0.6)) S.pendingSick.push({ at: now() + 24 + S.rng.uniform(0, 18), severity: 0.25 + p * 0.5, text: 'Cramps and a loose gut. Something in the water, maybe.' });
      log(`Drank my fill of ${w?.name ?? 'water'}.`);
      break;
    }
    case 'feed': takeWood(1); s.fireUntil = Math.max(s.fireUntil, now()) + 3; log('Fed the fire.'); break;
    case 'hut': pass(3.5, 320); s.hut = true; log('Built a debris hut: a ridgepole, ribs of dead branches, and an arm-deep pile of leaves on top.'); if (!S.milestones.hut) { S.milestones.hut = true; log('A shelter.', 'milestone'); } break;
  }
}

// Eating: cook it first if a fire is here (roasting), eat as much as the gut will hold, digest it.
// Harm from compounds sets the old outcome bands (safe … potentially lethal); energy comes from
// digestion, net of what digesting costs, and protein past ~35% of the day's energy is wasted and
// sickening. A food that costs more to digest than it gives leaves me worse off.
const GUT_KG = 1.5; // a stomach-full
function eat(it) {
  const cooking = fireHere();
  let st = it.props.chem;
  if (cooking) st = expose(st, PREP.roast, 0.5 + 0.5 * S.ch.focus);
  const room = GUT_KG - S.gut;
  if (room < 0.05) return log('Too full to eat any more just now.', 'thought');
  const m = Math.min(it.props.mass, room);
  pass(cooking ? 0.5 : 0.2, 120);
  if (m >= it.props.mass - 1e-6) remove(it); else { it.props.mass = Math.round((it.props.mass - m) * 1000) / 1000; }
  S.gut += m;
  const how = cooking ? 'Roasted and ate' : 'Ate';
  const what = `${S.inv.includes(it) ? 'some of ' : ''}the ${it.from.part} of the ${it.from.name}`;
  const n = nutrients(st, m);
  // protein and fat balance over roughly the last day
  const tot = S.macro.p + S.macro.f + S.macro.c + n.protein + n.fat + n.carb;
  const excess = Math.max(0, S.macro.p + n.protein - 0.35 * tot);
  const wasted = tot > 500 ? Math.min(n.protein, excess) : 0;
  S.macro.p += n.protein - wasted; S.macro.f += n.fat; S.macro.c += n.carb;
  const net = n.net - wasted;
  // harm, scaled gently by how much was eaten (a mouthful is not a meal)
  const h = harm(st) * Math.sqrt(Math.min(1.5, m / 0.2));
  const outcome = hazard(h);
  const germs = (it.props.germs ?? 0) * (cooking ? 0.05 : 1);
  touch([it], 0.3);
  if (S.rng.chance(Math.min(0.7, (germs + 0.25 * S.ch.germs) * Math.min(1, m / 0.2)))) S.pendingSick.push({ at: now() + 20, severity: Math.min(0.5, 0.15 + 0.4 * germs), text: 'A sour gut, then the runs. Something I ate wasn’t clean.' });
  const parasites = st.compounds.parasites ?? 0;
  if (parasites > 0.02 && S.rng.chance(Math.min(0.8, parasites * 1.5))) S.pendingSick.push({ at: now() + 30, severity: Math.min(0.5, 0.2 + parasites), text: 'A sour gut and fever. Something I ate raw.' });
  const irritant = Object.keys(st.compounds).some(k => COMPOUNDS[k].effect === 'irritant' && st.compounds[k] > 0.1);
  const ent = entity(it.from.id);
  const key = loreKey(ent, it.from.part);
  const L = (S.lore[key] ??= { ok: 0, sick: 0 });
  const delayed = !!st.compounds.amatoxin && /poison|lethal/.test(outcome);
  S.energy = clamp(S.energy + (/severe|lethal/.test(outcome) && !delayed ? Math.min(0, net) : net) / 24000);
  const feel = [`${cap(textureWords(st))}.`];
  if (irritant) feel.push('My mouth and throat burned.');
  if (wasted > 50) { S.sick = clamp(S.sick + Math.min(0.15, wasted / 1500)); feel.push('All lean, nothing fatty or starchy with it: my stomach turns, and I’m still hungry.'); }
  if (net < 0) feel.push('Heavy going; I doubt it gave back what it cost to get down.');
  else feel.push(m < 0.08 ? 'A few mouthfuls.' : S.gut > 1.2 ? 'Full.' : n.net / Math.max(0.05, m) < 600 ? 'Filling for now, but there’s not much in it.' : net > 400 ? 'That was real food.' : '');
  if (delayed) {
    S.pendingSick.push({ lore: key, at: now() + 30, severity: outcome === 'potentially lethal' ? 0.95 : 0.6, text: `Sick, badly, a day after eating the ${it.from.name}. It must have been that.` });
    S.pendingLore = key;
    return log(`${how} ${what}. ${feel.join(' ')} Tasted fine.`.replace(/ +/g, ' '), 'act');
  }
  const bad = { 'mild upset': [0.15, 'My stomach didn’t like it.'], 'moderate poisoning': [0.4, 'Within the hour: sweating, cramps, vomiting.'], 'severe poisoning': [0.75, 'Violently ill soon after; I thought I might die.'], 'potentially lethal': [1, 'It was poison.'] }[outcome];
  if (bad) { S.sick = clamp(S.sick + bad[0]); L.sick++; } else L.ok++;
  log(`${how} ${what}. ${bad ? bad[1] : feel.join(' ')}`.replace(/ +/g, ' ').trim(), bad && bad[0] >= 0.4 ? 'warn' : 'act');
}

// ------------------------------------------------------------ plans (goal tree with mental cost)

function nodeLabel(n) {
  if (n.type === 'item') return n.name;
  if (n.type === 'process') return n.name;
  if (n.type === 'any') return 'any one of these';
  return n.slot.role;
}
function think(path) {
  if (S.ch.focus < 0.25) return log('Too foggy to think it through. I need rest, water or food first.', 'warn');
  const n = nodeAt(path);
  S.ch.focus = clamp(S.ch.focus - 0.06);
  pass(0.1, 110);
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
function render() {
  if (!S) return;
  const s = site(), e = S.world.environment;
  $('#when').textContent = `Day ${S.day}, ${clock(S.t)}${isNight() ? ', night' : S.t >= 18 ? ', dusk' : ''}`;
  setHTML('#where', `<span class="place" data-rename="1" title="Rename this place">${esc(typo(cap(s.name)))}</span>${fireHere() ? ' <span class="fire">fire burning</span>' : ''}${s.hut ? ' <span class="tag">hut</span>' : ''}`);
  $('#world-line').textContent = typo(`${cap(e.biome)}; ${e.leanSeason === 'winter' ? 'cool nights' : 'warm days'}`);

  const fresh = renderJournal();
  if (fresh) { // put the top edge of what this action wrote at the top of the log
    const j = $('#journal-wrap');
    j.scrollTop += fresh.getBoundingClientRect().top - j.getBoundingClientRect().top - parseFloat(getComputedStyle(j).paddingTop || 0);
  }

  setHTML('#body', `<ul class="words">${bodyWords().map(w => `<li>${esc(typo(w))}</li>`).join('')}</ul><label class="toggle"><input type="checkbox" data-toggle="props"${S.showProps ? ' checked' : ''}> Show exact properties of what I carry</label>
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
}

// ------------------------------------------------------------ events

// ------------------------------------------------------------ the game record
//
// Everything that happens follows from the world seed and the player's choices, so a record of the
// seed and each choice reproduces a game exactly. Each action is the data of what was tapped (or
// the value chosen); `act` applies one, and replaying a record runs them in order on a fresh game.
const BUILD = 'hk-2026-10-21e'; // game logic version: a record replays faithfully only on the build that made it
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
  if (!b || !S) return;
  if (mapGesture.swallowClick && b.closest('.mapsvg')) return; // the end of a drag isn't a click
  const d = b.dataset;
  if (d.tab) { tab = d.tab; return render(); }
  if (d.record === 'copy') { const t = gameRecord(); navigator.clipboard?.writeText(t).then(() => log('Copied the game record.', 'thought'), () => {}); $('#record-text').value = t; $('#record-text').select(); return; }
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
  const a = { ...d };
  if (act(a)) { record(a); render(); }
});

// Apply one player action (the data of what was tapped). Returns false if it wasn't an action.
function act(d) {
  if (d.renameTo) { log(`Decided to call this place ${d.renameTo}.`); site().name = d.renameTo; return true; }
  if (d.goalPick !== undefined) { S.goal = d.goalPick; S.revealed[S.goal] ??= new Set(); return true; }
  if (d.slotPick) { sel[d.slotPick] = Number(d.value); return true; }
  if (d.here) doHere(d.here);
  else if (d.gather !== undefined) { const g = gatherOptions(site())[Number(d.gather)]; pass(g.hours, g.kcal); const it = g.fn(); touch([it], 0.5); log(`Gathered ${it.name}.`); }
  else if (d.pk) {
    if (d.pk === 'close') picker = null;
    else if (d.pk === 'back') picker = { kind: picker.kind, step: 'root' };
    else picker = { kind: 'collect', step: d.pk, value: d.v };
  }
  else if (d.rest) { picker = null; restFor(d.rest); }
  else if (d.hike) { picker = null; hike(d.hike); }
  else if (d.inspect) { const e = entity(d.inspect); inspect(e); assess(e); }
  else if (d.look) { picker = null; startLooking(d.look); }
  else if (d.craft) craft(d.craft, d.mode);
  else if (d.test) { const it = byUid(d.test); const T = testsFor(it).find(([k]) => k === d.name); pass(0.1, 120); it.notes[d.name] = T[1](); log(`${d.name} on the ${it.name}: ${it.notes[d.name]}.`); }
  else if (d.eat) eat(byUid(d.eat));
  else if (d.drop) { const it = byUid(d.drop); remove(it); log(`Left the ${it.name} behind.`); }
  else if (d.think) think(d.think);
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
  start(seed, preset = '') { checked = { seed, preset, ...checkWorld(seed, preset || null, { withOutlook: false }) }; newGame(seed, preset || null, checked); journalShown = 0; lastHTML.clear(); $('#start').hidden = true; $('#app').hidden = false; render(); } };

export function boot() {
  $('#seed').value = randomSeed();
  showCheck();
}
boot();
