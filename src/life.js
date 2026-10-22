// life.js — levels 2 and 3 of the generative graph.
//
// Archetypes (ancestral forms) get latent traits sampled conditionally on the
// environment. Variants are relatives that drift from the archetype (shared
// ancestry is what makes family-level heuristics work). Parts, visible cues,
// and test results are all *derived* from latent traits, never sampled freely.

const JSON_CLONE = o => JSON.parse(JSON.stringify(o));
import { clamp, round, makeRng } from './rng.js';
import { makeVarying, summarize } from './variation.js';
import { sampleComposition, expose, harm, PREP, COMPOUNDS, DEFENSE_COMPOUND, PART_CLASS } from './food.js';

// ---------------------------------------------------------------- shared

export function hazard(x) {
  return x < 0.12 ? 'safe' : x < 0.3 ? 'mild upset' : x < 0.55 ? 'moderate poisoning' : x < 0.8 ? 'severe poisoning' : 'potentially lethal';
}

function affinity(pref, v) {
  const d2 = (pref.moisture - v.moisture) ** 2 + (pref.light - v.light) ** 2 + (pref.rock - v.rock) ** 2;
  return Math.exp(-d2 / (2 * pref.width ** 2));
}

function placeIn(pref, env, allowed, base) {
  const scored = env.microhabitats
    .filter(m => allowed.includes(m.id))
    .map(m => ({ m, a: affinity(pref, m.vector) }))
    .sort((x, y) => y.a - x.a);
  if (!scored.length) return [];
  const keep = scored.filter(s => s.a >= 0.3);
  return (keep.length ? keep : [scored[0]]).map(({ m, a }) => ({
    micro: m.id, name: m.name, unit: m.unit, affinity: round(a),
    perInstance: Math.max(1, Math.round(base * Math.max(a, 0.3))),
  }));
}

const HAZARD_ORDER = ['safe', 'mild upset', 'moderate poisoning', 'severe poisoning', 'potentially lethal'];
function mergeHazard(a, b) {
  if (a === b) return a;
  const [lo, hi] = [a, b].sort((x, y) => HAZARD_ORDER.indexOf(x) - HAZARD_ORDER.indexOf(y));
  return `${lo} to ${hi}`;
}

function pickVarying(r, catalog, subject) {
  const ok = s => (!s.when || s.when(subject)) && (!s.forms || s.forms.includes(subject.form ?? subject.cls));
  const vis = r.shuffle(catalog.filter(s => s.kind === 'visible' && ok(s)));
  const use = r.shuffle(catalog.filter(s => s.kind === 'useful' && ok(s)));
  const di = use.findIndex(s => s.id === 'defense' || s.id === 'toxin');
  if (di > 0 && r.chance(0.6)) use.unshift(use.splice(di, 1)[0]);
  const chosen = [...vis.slice(0, r.int(1, 2)), ...use.slice(0, r.int(1, 2))];
  const integration = r.weighted([[0.25, 1], [0.55, 1], [0.85, 1]]); // loose, moderate, tight
  const lineageShare = r.uniform(0.3, 0.8);
  return chosen.map(spec => makeVarying(r.fork(spec.id), spec, subject, integration, lineageShare));
}

// ---------------------------------------------------------------- plants

// Apparency theory, roughly: trees lean on broad defenses (tannins, resin),
// herbs on potent targeted toxins (alkaloids), grasses mostly on silica.
const DEFENSE_WEIGHTS = {
  tree:  [['tannin', 6], ['none', 1.5], ['cyanogenic', 1], ['resinous', 2.5], ['alkaloid', 0.5]],
  shrub: [['tannin', 3], ['none', 2], ['cyanogenic', 1.5], ['alkaloid', 1.5], ['thorns', 1.5], ['aromatic', 1]],
  herb:  [['none', 2], ['alkaloid', 3], ['cyanogenic', 1], ['oxalate', 1.5], ['stinging', 1], ['latex', 1.2], ['aromatic', 1.5], ['sulfur', 1]],
  grass: [['none', 6], ['cyanogenic', 0.6], ['silica', 2]],
};
const FRUIT_WEIGHTS = {
  tree:  [['nut', 3], ['drupe', 1.5], ['pod', 1], ['winged seed', 2]],
  shrub: [['berry', 4], ['drupe', 1], ['none', 1]],
  herb:  [['seed', 3], ['berry', 1], ['pod', 1.5]],
  grass: [['grain', 1]],
};
const POTENCY = { none: 0, alkaloid: 1.3, cyanogenic: 1.0, latex: 0.8, oxalate: 0.6, tannin: 0.35, stinging: 0.5, aromatic: 0.12, sulfur: 0.05, resinous: 0.35, thorns: 0.05, silica: 0.05 };
// Optimal defense theory, roughly: valuable tissues (seeds, storage organs) defended most; ripe fruit least.
const ALLOC = { leaf: 1.0, stem: 0.8, root: 1.1, storage: 1.0, seed: 1.3, nut: 1.1, flower: 0.9, innerBark: 0.6, pod: 1.0, grain: 0.3 };
const COOK = { stinging: 0, oxalate: 0.4, cyanogenic: 0.5, latex: 0.6, tannin: 0.85, alkaloid: 0.95, aromatic: 0.8, resinous: 0.9 };
const LEACH = { tannin: 0.15, cyanogenic: 0.3, oxalate: 0.5, alkaloid: 0.8, latex: 0.7, stinging: 0.5 };
const TASTE = {
  tannin: 'dry and astringent; puckers the mouth', alkaloid: 'intensely bitter', cyanogenic: 'bitter, with an almond note',
  oxalate: 'burning, prickling sensation that lingers', stinging: 'stings the lips', latex: 'bitter and faintly burning',
  aromatic: 'strongly minty', sulfur: 'sharp and oniony', resinous: 'resinous and bitter', thorns: 'bland', silica: 'tough and gritty',
};
const FORM_MICRO = {
  tree: ['woodland', 'edge', 'streambank'],
  shrub: ['edge', 'glade', 'streambank', 'outcrop', 'woodland'],
  herb: ['woodland', 'edge', 'glade', 'streambank', 'pond', 'outcrop', 'scree', 'claybank'],
  grass: ['glade', 'edge', 'streambank', 'pond', 'outcrop'],
};
const PLANT_UNIT = { tree: 'trees', shrub: 'bushes', herb: 'plants', grass: 'clumps' };
const BARKS = [['smooth grey bark', 'grey-bark'], ['deeply furrowed brown bark', 'furrowbark'], ['scaly reddish bark', 'redbark'], ['thin dark bark with pale streaks', 'streakbark']];
const MEDICINAL = {
  tree: [{ part: 'inner bark', use: 'chewed, it eases pain and fever' }],
  shrub: [{ part: 'leaves', use: 'as a poultice, it helps wounds stay clean' }],
  herb: [{ part: 'leaves', use: 'as a poultice, it helps wounds stay clean' }, { part: 'roots', use: 'steeped, it settles an upset stomach' }],
  grass: [],
};
const FLESHY = ['berry', 'drupe'];
const PLANT_VARYING = [
  { id: 'height', label: 'height', kind: 'visible', scale: 'log', unit: 'm', sd: 0.25, prior: { fertility: 1, moisture: 1 },
    median: t => ({ tree: 12, shrub: 2, herb: 0.6, grass: t.habitat.moisture > 0.8 ? 1.8 : 0.7 }[t.form]) },
  { id: 'stemThickness', label: 'stem thickness', kind: 'visible', scale: 'log', unit: 'mm', sd: 0.3, forms: ['shrub', 'herb', 'grass'], prior: { fertility: 1, moisture: 1 },
    median: t => ({ shrub: 12, herb: 6, grass: 4 }[t.form]) },
  { id: 'leafSize', label: 'leaf length', kind: 'visible', scale: 'log', unit: 'cm', sd: 0.25, forms: ['tree', 'shrub', 'herb'], prior: { exposure: -1, moisture: 1 },
    median: t => round(5 + 5 * (t.pace + 1) / 2, 1) },
  { id: 'fruitSize', label: 'fruit size', kind: 'visible', scale: 'log', unit: 'cm', sd: 0.25, when: t => [...FLESHY, 'nut'].includes(t.fruit), prior: { fertility: 1, moisture: 1 },
    median: t => ({ berry: 1, drupe: 2.5, nut: 2 }[t.fruit]) },
  { id: 'fruitColor', label: 'fruit colour depth (0 pale, 1 deep)', kind: 'visible', scale: '01', sd: 0.7, when: t => FLESHY.includes(t.fruit), prior: { exposure: 1 }, median: () => 0.6 },
  { id: 'hairiness', label: 'leaf hairiness (0 smooth, 1 woolly)', kind: 'visible', scale: '01', sd: 0.8, forms: ['herb', 'shrub'], prior: { exposure: 1, moisture: -1 }, median: () => 0.3 },
  { id: 'defense', label: 'defense strength', kind: 'useful', scale: '01', sd: 0.6, when: t => (POTENCY[t.defense] ?? 0) >= 0.3, prior: { exposure: 1, fertility: -1 }, median: t => t.intensity },
  { id: 'fiber', label: 'fiber quality', kind: 'useful', scale: '01', sd: 0.6, when: t => t.fiber > 0.4, prior: { moisture: 1 }, median: t => t.fiber },
  { id: 'sweetness', label: 'fruit sweetness', kind: 'useful', scale: '01', sd: 0.7, when: t => FLESHY.includes(t.fruit) && !t.fruitToxic, prior: { exposure: 1, moisture: -1 }, median: () => 0.55 },
  { id: 'yield', label: 'crop per plant (relative)', kind: 'useful', scale: 'log', unit: '×', sd: 0.4, when: t => [...FLESHY, 'nut', 'grain', 'pod', 'seed'].includes(t.fruit), prior: { fertility: 1, moisture: 1 }, median: () => 1 },
  { id: 'storageSize', label: 'storage organ size', kind: 'useful', scale: 'log', unit: 'g', sd: 0.35, when: t => t.storage, prior: { fertility: 1, moisture: 1 },
    median: t => ({ bulb: 15, tuber: 60, taproot: 40, corm: 20, rhizome: 25 }[t.storageKind]) },
  { id: 'woodDensity', label: 'wood density', kind: 'useful', scale: '01', sd: 0.35, when: t => t.woodDensity != null, prior: { exposure: 1, fertility: -1 }, median: t => t.woodDensity },
  { id: 'resin', label: 'resin yield', kind: 'useful', scale: '01', sd: 0.5, when: t => t.resin > 0.5, prior: { exposure: 1 }, median: t => t.resin },
];

function rollSmell(r, t) {
  if (t.defense === 'sulfur') return 'strong onion smell';
  if (t.defense === 'aromatic') return 'strong minty, aromatic smell';
  if (t.resin > 0.5) return 'resinous, pine-like smell';
  if (t.defense === 'cyanogenic' && r.chance(0.7)) return 'faint bitter-almond smell';
  if (t.defense === 'alkaloid' && r.chance(0.35)) return 'rank, unpleasant smell';
  return 'green, grassy smell; nothing distinctive';
}
function rollTwist(r, fiber) {
  const x = fiber + r.normal(0, 0.08);
  return x > 0.55 ? 'folds and holds a twist without breaking' : x > 0.35 ? 'holds a twist but frays and weakens' : 'snaps or crumbles when twisted';
}
function rollFruit(r, t) {
  const pToxic = 0.12 + (['alkaloid', 'cyanogenic', 'latex'].includes(t.defense) ? 0.35 : 0);
  t.fruitToxic = r.chance(pToxic);
  const pale = r.chance(t.fruitToxic ? 0.5 : 0.1); // folk rule "pale berries are suspect" holds statistically
  t.fruitColor = pale ? r.pick(['white', 'yellow']) : r.pick(['red', 'black', 'blue-black', 'orange']);
  t.fruitAggregate = t.fruit === 'berry' && r.chance(t.fruitToxic ? 0.05 : 0.35);
}
function syncDerived(r, t) {
  t.slowActing = t.defense === 'alkaloid' && r.chance(0.3);
  t.latex = t.defense === 'latex';
  t.squareStem = t.defense === 'aromatic';
  if (t.defense === 'resinous' && t.resin < 0.5) t.resin = round(r.uniform(0.6, 1));
  if (t.defense !== 'resinous' && t.resin > 0.5) t.resin = round(r.uniform(0, 0.2));
  t.smell = rollSmell(r, t);
  t.fiberTwist = rollTwist(r, t.fiber);
  t.fiberCue = t.fiber + r.normal(0, 0.08) > 0.6;
}

function plantArchetype(r, form, env) {
  const t = { kind: 'plant', form };
  t.pace = round(clamp(r.normal({ tree: -0.3, shrub: 0, herb: 0.3, grass: 0.4 }[form], 0.35), -1, 1));
  t.perennial = form === 'tree' || form === 'shrub' ? true : r.chance(form === 'grass' ? 0.8 : 0.55);
  t.deciduous = (form === 'tree' || form === 'shrub') && env.seasonality > 0.35 && r.chance(clamp(0.6 + 0.4 * t.pace));
  t.defense = r.weighted(DEFENSE_WEIGHTS[form]);
  // Growth–defense trade-off: slow growers defend harder.
  t.intensity = round(clamp(r.normal(0.45 - 0.2 * t.pace, 0.18), 0.05, 1));
  t.umbel = form === 'herb' && r.chance(0.3);
  if (t.umbel) { // the umbel family is high variance: harmless or deadly
    t.defense = r.chance(0.5) ? 'alkaloid' : 'none';
    if (t.defense === 'alkaloid') t.intensity = round(r.uniform(0.7, 0.95));
  }
  t.fiber = round(clamp(r.normal({ tree: 0.45, shrub: 0.4, herb: 0.35, grass: 0.5 }[form], 0.22)));
  t.retting = round(clamp(t.fiber + r.normal(0, 0.15)));
  t.woodDensity = form === 'tree' || form === 'shrub' ? round(clamp(r.normal(0.5 - 0.25 * t.pace, 0.15), 0.1, 0.95)) : null;
  t.resin = t.defense === 'resinous' ? round(r.uniform(0.6, 1)) : round(r.uniform(0, 0.2));
  t.paperBark = form === 'tree' && t.defense !== 'resinous' && r.chance(0.25);
  const bark = r.pick(BARKS);
  t.barkLook = form === 'tree' || form === 'shrub' ? bark[0] : null;
  t.barkWord = bark[1];
  t.fruit = t.umbel ? 'seed' : r.weighted(FRUIT_WEIGHTS[form]);
  if (t.fruit === 'berry' || t.fruit === 'drupe') rollFruit(r, t);
  t.storage = form === 'herb' ? t.defense === 'sulfur' || (t.perennial && r.chance(0.5)) : form === 'grass' ? r.chance(0.25) : false;
  t.storageKind = t.defense === 'sulfur' ? 'bulb' : form === 'grass' ? 'rhizome' : r.pick(['tuber', 'taproot', 'corm']);
  t.fluff = (form === 'herb' || form === 'grass') && r.chance(0.25);
  t.spindleStalk = (form === 'herb' && t.perennial && r.chance(0.4)) || (form === 'shrub' && r.chance(0.3));
  t.medicinal = r.chance(0.15) && MEDICINAL[form].length ? r.pick(MEDICINAL[form]) : null;

  // Habitat preference: anchored on one present microhabitat; some are specialists.
  const present = env.microhabitats.filter(m => FORM_MICRO[form].includes(m.id));
  const home = present.length ? r.pick(present) : env.microhabitats[0];
  t.habitat = {
    moisture: round(clamp(home.vector.moisture + r.normal(0, 0.06))),
    light: round(clamp(home.vector.light + r.normal(0, 0.06))),
    rock: round(clamp(home.vector.rock + r.normal(0, 0.06))),
    width: r.chance(0.3) ? 0.1 : 0.28,
  };
  t.baseDensity = Math.round(r.logNormal({ tree: 25, shrub: 30, herb: 80, grass: 400 }[form], 0.5));
  syncDerived(r, t);
  t.varying = pickVarying(r.fork('varying'), PLANT_VARYING, t);
  return t;
}

function partToxin(t, part) {
  if (part === 'fruit') return t.fruitToxic ? clamp(0.5 + 0.45 * t.intensity) : 0.03;
  return clamp((POTENCY[t.defense] ?? 0) * t.intensity * (ALLOC[part] ?? 1) * 1.2);
}
function foodAt(t, part, intensity) {
  const raw = partToxin({ ...t, intensity }, part);
  const cook = part === 'fruit' ? 0.8 : COOK[t.defense] ?? 0.9;
  const leach = part === 'fruit' ? 0.8 : LEACH[t.defense] ?? 0.8;
  return { toxin: round(raw), raw: hazard(raw), cooked: hazard(raw * cook), leached: hazard(raw * leach) };
}
// With patch-varying defense, report the hazard across the middle 68% of patches.
function foodEntry(t, part, range) {
  const mid = foodAt(t, part, t.intensity);
  if (!range) return mid;
  const lo = foodAt(t, part, range[0]), hi = foodAt(t, part, range[1]);
  return { toxin: mid.toxin, raw: mergeHazard(lo.raw, hi.raw), cooked: mergeHazard(lo.cooked, hi.cooked), leached: mergeHazard(lo.leached, hi.leached) };
}

// Each edible part gets a make-up (food.js), with the plant's own defence as one of its compounds
// at the strength the old single toxin number had. The raw/cooked/leached hazard words are then
// derived from what roasting, and crushing + leaching + roasting, do to that make-up.
function attachChemistry(r, t, parts) {
  for (const p of parts) {
    if (!p.food || !p.food.cls) continue;
    const cls = PART_CLASS[p.food.cls];
    const kind = DEFENSE_COMPOUND[t.defense] ?? (p.food.cls === 'fruit' && t.fruitToxic ? 'alkaloid' : null);
    const tox = kind ? partToxin(t, p.food.cls) : 0;
    p.chem = sampleComposition(r.fork(p.part), cls, { defense: kind ? { kind, dose: tox / COMPOUNDS[kind].potency } : null });
    p.food = chemLabels(p.chem, p.food.cls);
  }
}
export function chemLabels(chem, cls) {
  return { toxin: round(harm(chem)), raw: hazard(harm(chem)), cooked: hazard(harm(expose(chem, PREP.roast))), leached: hazard(harm(expose(chem, PREP.leachRoast))), cls };
}

function plantParts(t, env, range) {
  const P = [];
  const aseasonal = env.seasonality < 0.35;
  const grow = aseasonal ? 'most of the year' : 'growing season';
  const late = aseasonal ? 'most of the year' : 'late growing season';
  const lean = env.leanSeason;
  const woody = t.form === 'tree' || t.form === 'shrub';
  const food = part => ({ ...foodEntry(t, part, range), cls: part });

  const leafUses = [];
  if (t.form === 'grass') {
    leafUses.push('bedding');
    if (t.fiber > 0.5) leafUses.push('weaving and cordage (leaf fiber)');
    if (t.defense === 'silica') leafUses.push('edges cut skin if gathered carelessly');
  } else if (woody || t.pace < 0.2) leafUses.push('bedding, thatch, food wrapping');
  P.push({
    part: t.form === 'grass' ? 'blades' : 'leaves',
    collect: t.form === 'tree' ? 'hands (low branches)' : 'hands',
    season: woody && !t.deciduous ? 'year-round' : grow,
    food: t.form === 'grass' ? null : food('leaf'),
    nutrition: t.form === 'grass' ? 'indigestible' : 'low calorie; vitamins and minerals',
    uses: leafUses,
  });

  if (woody) {
    const d = t.woodDensity;
    const dw = [d > 0.6 ? 'dense fuel: burns long, leaves good coals' : d < 0.35 ? 'light fuel: lights easily, burns fast' : 'moderate fuel'];
    if (d >= 0.2 && d <= 0.45 && t.resin < 0.5) dw.push('fire-drill hearth board candidate');
    P.push({ part: 'dead wood', collect: 'hands (fallen branches); big pieces need a chopper', season: 'year-round', food: null, uses: dw });

    const lw = [d > 0.6 ? 'digging sticks, clubs, spear shafts' : d > 0.4 ? 'shafts and frames' : 'light frames; weak'];
    if (t.form === 'shrub' && (t.spindleStalk || (d >= 0.3 && d <= 0.5))) lw.push('straight shoots: fire-drill spindle candidate');
    P.push({
      part: t.form === 'tree' ? 'live branches' : 'stems and shoots',
      collect: t.form === 'shrub' ? 'hands for thin shoots; cutting edge for stems' : 'cutting edge',
      season: 'year-round', food: null, uses: lw,
    });

    if (t.paperBark) P.push({ part: 'outer bark', collect: 'hands (peels in sheets)', season: 'year-round', food: null, uses: ['excellent tinder, burns even when damp', 'containers and wrapping', 'tar when heated (later)'] });
    else if (t.defense === 'tannin') P.push({ part: 'outer bark', collect: 'cutting edge', season: 'year-round', food: null, uses: ['tannin for tanning hides (later)'] });

    const ib = [];
    if (t.fiber > 0.55) ib.push('cordage fiber');
    if (t.fiber > 0.4) ib.push('shredded and dried, it makes tinder');
    P.push({ part: 'inner bark', collect: 'cutting edge (strip from live wood)', season: aseasonal ? 'year-round' : 'peels best early in the growing season', food: food('innerBark'), nutrition: 'some starch and sugar; emergency food', uses: ib });

    if (t.resin > 0.5) P.push({ part: 'resin', collect: 'hands (scrape from bark wounds)', season: 'year-round', food: null, uses: ['adhesive (mixed with charcoal)', 'fire-starter', 'waterproofing'] });
  }

  if (t.fruit === 'nut') P.push({ part: 'nuts', collect: 'hands (gather from the ground)', season: late, food: food('nut'), nutrition: 'high fat and protein; stores well', uses: [] });
  if (t.fruit === 'berry' || t.fruit === 'drupe') P.push({ part: t.fruit === 'berry' ? 'berries' : 'fruits', collect: t.form === 'tree' ? 'hands (windfalls, low branches)' : 'hands', season: late, food: food('fruit'), nutrition: 'sugars, vitamin C; spoils quickly', uses: [] });
  if (t.fruit === 'pod') P.push({ part: 'pods and seeds', collect: 'hands', season: late, food: food('pod'), nutrition: 'protein and starch', uses: [] });
  if (t.fruit === 'seed') P.push({ part: 'seeds', collect: 'hands (strip or shake into a container)', season: late, food: food('seed'), nutrition: 'some fat and protein; tiny and slow to gather', uses: [] });
  if (t.fruit === 'grain') P.push({ part: 'seed heads', collect: 'hands (strip); faster with a container', season: late, food: food('grain'), nutrition: 'starch, some protein; laborious to process', uses: [] });

  if (!woody) {
    const su = [];
    if (t.fiber > 0.55) su.push('bast fiber for cordage (best after retting)');
    if (t.form === 'grass') su.push('thatch and bedding when dry');
    P.push({ part: 'stems', collect: 'hands', season: grow, food: t.form === 'grass' ? null : food('stem'), nutrition: 'low calorie', uses: su });
    if (t.form === 'herb') P.push({ part: 'flowers', collect: 'hands', season: aseasonal ? 'most of the year' : 'early growing season', food: food('flower'), nutrition: 'trace nutrition', uses: [] });
    if (t.storage) P.push({ part: `${t.storageKind}s`, collect: 'digging stick (hands in soft ground)', season: aseasonal ? 'year-round' : `year-round; best from late growing season through the ${lean}`, food: food('storage'), nutrition: 'starch: reliable calories; stores well', uses: [] });
    else P.push({ part: 'roots', collect: 'digging stick', season: 'year-round', food: food('root'), nutrition: 'little food value', uses: [] });
    if (t.spindleStalk) P.push({ part: 'dead stalks', collect: 'hands', season: `late growing season through the ${lean}`, food: null, uses: ['fire-drill spindle candidate'] });
    if (t.form === 'grass') P.push({ part: 'dry grass', collect: 'hands', season: `late growing season and the ${lean}`, food: null, uses: ['tinder', 'bedding and insulation'] });
  }
  if (t.fluff) P.push({ part: 'seed fluff', collect: 'hands', season: late, food: null, uses: ['tinder (catches a spark readily)', 'insulation'] });

  if (t.medicinal) {
    const target = P.find(p => p.part === t.medicinal.part);
    if (target) target.uses.push(`remedy: ${t.medicinal.use}`);
  }
  return P;
}

function plantCues(t) {
  const c = [];
  c.push((t.pace > 0.3 ? 'thin, soft, bright green leaves' : t.pace < -0.3 ? 'tough, leathery, dark leaves' : 'medium-textured leaves') + (t.deciduous ? ', shed in the lean season' : ''));
  if (t.form === 'tree' || t.form === 'shrub') {
    if (t.paperBark) c.push('white papery bark peeling in thin sheets');
    else if (t.resin > 0.5) c.push('rough bark beaded with sticky, fragrant resin');
    else c.push(t.barkLook);
  }
  if (t.squareStem) c.push('square stems with leaves in opposite pairs');
  if (t.umbel) c.push('flat-topped, umbrella-shaped clusters of small flowers');
  if (t.defense === 'stinging') c.push('fine, stiff hairs on stems and leaf undersides');
  if (t.defense === 'thorns') c.push('stout thorns along the stems');
  if (t.defense === 'silica') c.push('blades with rough, cutting edges');
  if (t.defense === 'sulfur') c.push('grass-like leaves rising in clumps from the ground');
  const fruitCue = {
    nut: t.defense === 'tannin' ? 'heavy crops of capped, acorn-like nuts' : 'husked nuts dropping in season',
    drupe: `${t.fruitColor} fleshy fruits, each with a single hard stone`,
    berry: `${t.fruitAggregate ? 'clustered, raspberry-like' : 'round, glossy'} ${t.fruitColor} berries`,
    pod: 'bean-like pods in season',
    seed: 'small dry seeds late in the season',
    grain: 'nodding seed heads late in the season',
  }[t.fruit];
  if (fruitCue) c.push(fruitCue);
  if (t.fluff) c.push(t.habitat.moisture > 0.8 ? 'brown, cigar-shaped seed heads that burst into fluff' : 'seed heads that turn to fluff');
  if (t.spindleStalk && t.form === 'herb') c.push('tall, straight, dead stalks still standing from last season');
  if (t.fiberCue && (t.form === 'herb' || t.form === 'grass')) c.push('long, stringy stems that bend without snapping');
  return c;
}

function plantFieldTests(t) {
  let taste;
  if (t.slowActing) taste = 'mild; nothing alarming';
  else if (t.defense === 'none') taste = t.pace > 0 ? 'mild, slightly sweet' : 'bland and fibrous';
  else if (t.intensity < 0.2 && ['alkaloid', 'cyanogenic', 'latex', 'oxalate', 'tannin'].includes(t.defense)) taste = t.defense === 'tannin' ? 'faintly astringent' : 'faintly bitter';
  else taste = TASTE[t.defense];
  const skin = t.defense === 'stinging' ? 'immediate stinging welts'
    : t.defense === 'latex' && t.intensity > 0.3 ? 'red, itchy rash after a few hours'
    : t.defense === 'oxalate' ? 'slight itch' : 'no reaction';
  const f = [
    ['Crush and smell', t.smell],
    ['Break a stem or twig', t.latex ? 'milky white sap oozes out' : t.resin > 0.5 ? 'sticky, fragrant sap' : 'clear, watery sap or none'],
    ['Twist test', t.fiberTwist],
    ['Skin contact (rub on inner wrist, wait)', skin],
    ['Staged taste (lip, tongue, chew and spit)', taste],
  ];
  if (t.woodDensity != null) f.push(['Snap and heft dead wood', `${t.woodDensity > 0.6 ? 'heavy and hard' : t.woodDensity < 0.35 ? 'light and soft' : 'medium weight'}; dry pieces snap crisply`]);
  return f;
}

function plantDeliberate(t, parts) {
  const d = [];
  const usesMatch = re => parts.some(p => p.uses.some(u => re.test(u)));
  if (t.slowActing) d.push(['Watch for delayed effects after eating', 'symptoms appear one to three days later, so quick taste tests miss this plant']);
  if (t.fiber > 0.4) {
    d.push(['Ret in water for one to three weeks, then strip', t.retting > 0.6 ? 'fibers separate cleanly into long, strong strands' : t.retting > 0.4 ? 'fibers come free but are short or weak' : 'rots to mush before the fibers free up']);
    d.push(['Twist cordage and load-test it', t.fiber > 0.7 ? 'strong: holds a heavy load' : t.fiber > 0.55 ? 'serviceable for lashings and snares' : 'weak; breaks under modest load']);
  }
  if (usesMatch(/hearth/)) d.push(['Fire-drill trial (as hearth board)', t.woodDensity <= 0.35 ? 'makes dark, warm dust that forms an ember readily' : 'ember forms, but with effort']);
  if (usesMatch(/spindle/)) d.push(['Fire-drill trial (as spindle)', 'straight, light, and stiff enough to spin']);
  if (usesMatch(/tinder/)) d.push(['Burn test (tinder)', 'catches from an ember and flames up']);
  if (t.medicinal) d.push([`Use ${t.medicinal.part} as a remedy over several days`, t.medicinal.use]);
  return d;
}

function buildPlant(seed, id, t, env, namer, mc, nameOverride) {
  const habitats = placeIn(t.habitat, env, FORM_MICRO[t.form], t.baseDensity);
  const variation = summarize(seed, id, t.varying, habitats.map(h => ({ micro: h.micro, weight: h.perInstance })), env, mc);
  const dr = variation?.traits.find(x => x.id === 'defense');
  const parts = plantParts(t, env, dr ? [dr.q16, dr.q84] : null);
  attachChemistry(makeRng(`${seed}/${id}/chem`), t, parts);
  return {
    id, kind: 'plant', form: t.form,
    name: nameOverride ?? namer.plant(t, habitats[0]?.micro),
    unit: PLANT_UNIT[t.form], traits: t, habitats,
    cues: plantCues(t), fieldTests: plantFieldTests(t), deliberate: plantDeliberate(t, parts),
    parts, varying: t.varying, variation,
  };
}

function makeLookalike(r, plants, env, seed, mc) {
  if (!r.chance(0.75)) return null;
  const herbs = plants.filter(p => p.form === 'herb');
  const safe = herbs.filter(p =>
    p.parts.every(x => !x.food || ['safe', 'mild upset'].includes(x.food.cooked)) &&
    p.parts.some(x => x.food && x.food.cooked === 'safe'));
  if (!safe.length || herbs.length < 2) return null;
  const model = r.pick(safe);
  const donor = r.pick(herbs.filter(p => p !== model));

  // Same visible structure and visible variation as the model; deadly chemistry.
  const t = JSON_CLONE(model.traits);
  t.defense = 'alkaloid';
  t.intensity = round(r.uniform(0.75, 0.95));
  t.slowActing = r.chance(0.5);
  t.latex = false;
  t.smell = 'green, grassy smell; nothing distinctive';
  t.family = donor.id;
  t.varying = [
    ...model.varying.filter(v => v.kind === 'visible'),
    makeVarying(r.fork('defense'), PLANT_VARYING.find(v => v.id === 'defense'), t, model.varying[0]?.integration ?? 0.5),
  ];
  const v = buildPlant(seed, `${donor.id}x`, t, env, null, mc, model.name); // same name: that is how lookalikes fool people
  const smellTell = model.traits.smell !== t.smell;
  const tell = smellTell ? `crushed, it lacks the ${model.traits.smell.replace(/^strong /, '')}` : 'faint purple blotches near the base of the stem';
  v.cues = [...model.cues];
  if (!smellTell) v.cues.push(tell);
  v.habitats = model.habitats.map(h => ({ ...h, perInstance: Math.max(1, Math.round(h.perInstance * r.uniform(0.2, 0.6))) }));
  v.gmName = `false ${model.name}`;
  v.lookalike = { mimics: model.id, family: donor.id, tell };
  v.note = `Lookalike of ${model.name} (${model.id}); actually related to ${donor.name} (${donor.id}). Tell: ${tell}.`;
  return v;
}

export function generatePlants(rng, env, seed, namer, mc) {
  const hasStream = env.microhabitats.some(m => m.id === 'streambank');
  const counts = {
    tree: env.treeCover > 0.4 ? rng.int(2, 4) : env.treeCover > 0.1 ? rng.int(1, 3) : hasStream && rng.chance(0.6) ? 1 : 0,
    shrub: rng.int(2, 4), herb: rng.int(4, 6), grass: rng.int(2, 4),
  };
  const plants = [];
  let n = 0;
  for (const form of ['tree', 'shrub', 'herb', 'grass']) {
    for (let i = 0; i < counts[form]; i++) {
      const id = `P${++n}`;
      const r = rng.fork(id);
      plants.push(buildPlant(seed, id, plantArchetype(r, form, env), env, namer, mc));
    }
  }
  // fungi, mosses and lichens: a few of each wherever there is somewhere for them to grow
  const fr = rng.fork('fungi');
  const fcounts = { mushroom: fr.int(2, 4), moss: fr.int(1, 2), lichen: fr.int(1, 2) };
  const seenLook = new Set();
  for (const form of ['mushroom', 'moss', 'lichen']) {
    for (let i = 0; i < fcounts[form]; i++) {
      const id = `F${i + 1}${form[0]}`;
      const t = fungusArchetype(fr.fork(id), form, env);
      const pool = { mushroom: CAP_COLORS[t.nameKey] ?? [t.color], moss: ['bright green', 'dark green', 'golden', 'pale green'], lichen: ['grey-green', 'pale grey', 'yellow-green', 'orange'] }[form];
      for (let k = 0; k < pool.length && seenLook.has(`${t.sub}:${t.color}`); k++) t.color = pool[k]; // two alike look different
      seenLook.add(`${t.sub}:${t.color}`);
      const f = buildFungus(seed, id, t, env, namer);
      if (f.habitats.length) plants.push(f);
    }
  }
  const look = makeLookalike(rng.fork('lookalike'), plants, env, seed, mc);
  if (look) {
    const lastHerb = plants.map(p => p.form).lastIndexOf('herb');
    plants.splice(lastHerb + 1, 0, look);
  }
  return plants;
}

// ---------------------------------------------------------------- fungi, mosses and lichens
//
// Kept apart from the plant archetypes: they share the plant interface (kind 'plant', parts, cues,
// field tests) but not the growth–defense machinery. Gilled mushrooms are the high-variance group:
// most are harmless, some upset the gut, and a few are deadly with symptoms delayed by a day,
// tasting perfectly mild. Some live under logs and in the litter (cryptic) and only turn up when
// someone pokes around. Brackets on dead wood may be tinder fungus, whose dried flesh holds an
// ember. Beard lichens are dry, fine tinder; leafy ground lichens are famine food once leached.
const FUNGUS_MICRO = {
  mushroom: ['woodland', 'deadfall', 'edge', 'glade', 'streambank'],
  moss: ['woodland', 'streambank', 'spring', 'outcrop', 'deadfall', 'pond'],
  lichen: ['outcrop', 'scree', 'woodland', 'edge', 'glade'],
};
const FUNGUS_UNIT = { mushroom: 'mushrooms', moss: 'patches', lichen: 'patches' };
const CAP_COLORS = { gilledPale: ['white', 'cream', 'pale grey'], gilledBrown: ['brown', 'tawny', 'olive-brown'], gilledBright: ['yellow', 'orange', 'red'] };
function fungusArchetype(r, form, env) {
  const t = { kind: 'plant', form, fungal: form === 'mushroom' };
  const sub = form === 'mushroom' ? r.weighted([['gilled', 0.65], ['bracket', 0.2], ['puffball', 0.15]])
    : form === 'moss' ? r.weighted([['cushion', 0.7], ['bog', env.microhabitats.some(m => ['pond', 'spring'].includes(m.id)) ? 0.3 : 0.05]])
    : r.weighted([['beard', 0.5], ['leafy', 0.5]]);
  t.sub = sub;
  if (sub === 'gilled') {
    t.nameKey = r.weighted([['gilledPale', 0.4], ['gilledBrown', 0.4], ['gilledBright', 0.2]]);
    t.color = r.pick(CAP_COLORS[t.nameKey]);
    t.toxin = round(r.weighted([[0.03, 0.5], [0.2, 0.25], [0.6, 0.13], [0.9, 0.12]]));
    t.slowActing = t.toxin >= 0.8;              // deadly ones act late and taste mild
    t.cupAndRing = t.slowActing && r.chance(0.7); // the classic tell, not always visible
    t.cryptic = r.chance(0.4);
  } else if (sub === 'bracket') {
    t.nameKey = 'bracket'; t.color = r.pick(['grey', 'brown', 'pale']); t.tinderFungus = r.chance(0.6); t.toxin = 0.1;
  } else if (sub === 'puffball') {
    t.nameKey = 'puffball'; t.color = 'white'; t.toxin = 0.05;
  } else if (sub === 'cushion' || sub === 'bog') {
    t.nameKey = sub === 'bog' ? 'bogMoss' : 'moss'; t.color = sub === 'bog' ? r.pick(['red-tinged', 'pale green']) : r.pick(['bright green', 'dark green', 'golden']);
  } else {
    t.nameKey = sub === 'beard' ? 'beardLichen' : 'leafyLichen'; t.color = r.pick(['grey-green', 'pale grey', 'yellow-green']);
  }
  const allowed = sub === 'bracket' ? ['deadfall', 'woodland'] : sub === 'puffball' ? ['glade', 'edge'] : sub === 'beard' ? ['woodland', 'edge'] : sub === 'bog' ? ['pond', 'spring', 'streambank'] : FUNGUS_MICRO[form];
  const present = env.microhabitats.filter(m => allowed.includes(m.id));
  const home = present.length ? r.pick(present) : env.microhabitats[0];
  t.allowed = allowed;
  t.habitat = { moisture: round(clamp(home.vector.moisture + r.normal(0, 0.06))), light: round(clamp(home.vector.light + r.normal(0, 0.06))), rock: round(clamp(home.vector.rock + r.normal(0, 0.06))), width: 0.28 };
  t.baseDensity = Math.round(r.logNormal({ mushroom: sub === 'bracket' ? 6 : 15, moss: 60, lichen: 30 }[form], 0.5));
  t.varying = [];
  return t;
}
function fungusParts(t, env) {
  const late = env.seasonality < 0.35 ? 'after rain, most of the year' : 'after rain, mostly late in the growing season';
  const f = (raw, cooked, leached = cooked) => ({ toxin: t.toxin ?? 0, raw, cooked, leached });
  if (t.sub === 'gilled') {
    const raw = hazard(Math.max(t.toxin, 0.15)), cooked = hazard(t.toxin);
    return [{ part: 'caps', collect: 'hands', season: late, food: f(raw, cooked), nutrition: 'low calorie; a little protein', uses: [] }];
  }
  if (t.sub === 'bracket') return [{ part: 'bracket', collect: 'hands (pry off the log); a cutting edge helps', season: 'year-round', food: null, uses: t.tinderFungus ? ['tinder: the dried inner flesh catches and holds an ember'] : ['too tough and woody to be useful'] }];
  if (t.sub === 'puffball') return [{ part: 'puffballs', collect: 'hands', season: late, food: f('mild upset', 'safe'), nutrition: 'low calorie; eat only while white all through', uses: [] }];
  if (t.form === 'moss') return [{ part: 'moss', collect: 'hands (peel in mats)', season: 'year-round', food: null, uses: t.sub === 'bog' ? ['absorbent wound dressing', 'bedding and insulation'] : ['bedding and insulation', 'dry moss: a bed for an ember, poor tinder alone'] }];
  if (t.sub === 'beard') return [{ part: 'lichen strands', collect: 'hands', season: 'year-round', food: null, uses: ['tinder (dry, fine strands catch an ember readily)'] }];
  return [{ part: 'lichen', collect: 'hands', season: 'year-round', food: f('mild upset', 'mild upset', 'safe'), nutrition: 'some starch-like carbohydrate after leaching and boiling; famine food', uses: [] }];
}
function fungusCues(t) {
  if (t.sub === 'gilled') return [`${t.color} caps over gills${t.cryptic ? ', small, under logs and in the leaf litter' : ''}`, ...(t.cupAndRing ? ['a ring on the stem and a bag-like cup at the base'] : []), 'springs up after rain'];
  if (t.sub === 'bracket') return [`${t.color}, hard ${t.tinderFungus ? 'hoof-shaped' : 'shelf-like'} brackets on dead wood`];
  if (t.sub === 'puffball') return ['round white balls on the ground, no gills or stem'];
  if (t.form === 'moss') return [t.sub === 'bog' ? `${t.color} spongy mats that hold water like a sponge` : `soft ${t.color} cushions on soil, rock and logs`];
  return [t.sub === 'beard' ? `${t.color} beard-like strands hanging from branches` : `${t.color} branching tufts on the ground`];
}
function fungusTests(t) {
  if (t.sub === 'gilled') return [
    ['Spore print (cap on a leaf overnight)', t.toxin >= 0.8 ? 'white' : r2(t.color)],
    ['Cut and watch the flesh', t.toxin >= 0.5 && !t.slowActing ? 'bruises yellow or blue within minutes' : 'no colour change'],
    ['Crush and smell', t.toxin >= 0.5 && !t.slowActing ? 'unpleasant, chemical smell' : 'mild, mushroomy smell'],
    ['Staged taste (lip, tongue, chew and spit)', t.toxin >= 0.5 && !t.slowActing ? 'acrid and burning' : 'mild; nothing alarming'],
  ];
  if (t.sub === 'puffball') return [['Cut in half', 'white and firm all through, no gill outline inside'], ['Staged taste (lip, tongue, chew and spit)', 'mild']];
  if (t.sub === 'bracket') return [['Break and pick at the inside', t.tinderFungus ? 'a brown, suede-like layer under the crust' : 'hard and woody throughout']];
  if (t.form === 'moss') return [['Squeeze', t.sub === 'bog' ? 'runs with water; holds many times its weight' : 'springy; a little water']];
  return [['Feel when dry', t.sub === 'beard' ? 'brittle, fine and papery' : 'crisp, crumbles'], ['Staged taste (lip, tongue, chew and spit)', 'bitter']];
}
const r2 = c => (/brown|olive|tawny/.test(c) ? 'brown' : /yellow|orange/.test(c) ? 'cream' : 'white');
function buildFungus(seed, id, t, env, namer) {
  const habitats = placeIn(t.habitat, env, t.allowed, t.baseDensity);
  const parts = fungusParts(t, env);
  const fr = makeRng(`${seed}/${id}/chem`);
  for (const p of parts) if (p.food) {
    const cls = t.form === 'lichen' ? 'lichen' : 'mushroom';
    const comp = t.slowActing ? { kind: 'amatoxin', dose: t.toxin / 3 } : t.toxin > 0.04 ? { kind: 'fungal', dose: t.toxin } : null;
    p.chem = sampleComposition(fr, cls, { defense: comp });
    p.food = { ...chemLabels(p.chem, cls) };
  }
  const deliberate = [];
  if (parts[0].food) deliberate.push(['Eat a little, cooked, and wait two days', t.slowActing ? 'fine at first; liver failure a day or two later' : `${parts[0].food.raw} raw / ${parts[0].food.cooked} cooked`]);
  if (t.tinderFungus) deliberate.push(['Burn test (tinder)', 'the dried inner layer takes a spark or ember and smoulders a long time']);
  if (t.sub === 'beard') deliberate.push(['Burn test (tinder)', 'catches from an ember and flares quickly']);
  return {
    id, kind: 'plant', form: t.form, cryptic: !!t.cryptic,
    name: namer.fungus(t), unit: FUNGUS_UNIT[t.form], traits: t, habitats,
    cues: fungusCues(t), fieldTests: fungusTests(t), deliberate, parts, varying: [], variation: null,
  };
}

// ---------------------------------------------------------------- animals

const ANIMALS = {
  grub:        { cls: 'invertebrate', cryptic: true, noun: 'grub', micro: ['deadfall', 'woodland', 'edge', 'outcrop'], colors: ['white', 'cream'], base: 40, unit: 'grubs', catch: 'easy (turn logs and stones, break open rotten wood)', parasite: 0.05, nutrition: 'high fat and protein', products: ['whole grub'], signs: ['crumbly, rotten logs', 'grubs exposed when stones or logs are rolled'], activity: 'hidden in rotten wood and under stones', season: 'year-round; deeper and sluggish in the lean season' },
  ant:         { cls: 'invertebrate', noun: 'ant', micro: ['glade', 'edge', 'woodland', 'outcrop', 'deadfall'], colors: ['red', 'black', 'brown'], base: 6, unit: 'nests', catch: 'easy for larvae (dig into the nest; expect bites)', defense: 'bites and sprays acid', parasite: 0.02, nutrition: 'larvae and pupae: protein and fat', products: ['larvae and pupae'], signs: ['mounds of soil or needles', 'trails of ants'], activity: 'day', season: 'growing season' },
  grasshopper: { cls: 'invertebrate', noun: 'grasshopper', micro: ['glade', 'edge'], colors: ['green', 'brown', 'dusty grey'], base: 120, unit: 'insects', catch: 'moderate (easy in cool early mornings)', parasite: 0.1, nutrition: 'protein', products: ['whole insect (remove legs and wings)'], signs: ['clicking and whirring in the grass', 'insects springing away underfoot'], activity: 'day', season: 'late growing season' },
  caterpillar: { cls: 'invertebrate', noun: 'caterpillar', micro: ['edge', 'woodland', 'glade'], colors: ['green', 'brown'], aposematic: 0.45, base: 40, unit: 'caterpillars', catch: 'easy', parasite: 0.02, nutrition: 'protein and fat', products: ['whole caterpillar (gut and cook)'], signs: ['chewed leaves', 'droppings beneath plants'], activity: 'day', season: 'early growing season' },
  beetle:      { cls: 'invertebrate', cryptic: true, noun: 'beetle', micro: ['woodland', 'deadfall', 'glade', 'edge', 'pond'], colors: ['brown', 'black', 'metallic green'], aposematic: 0.35, base: 30, unit: 'beetles', catch: 'easy', parasite: 0.05, nutrition: 'protein', products: ['whole beetle (remove hard parts)'], signs: ['beetles under bark and stones'], activity: 'night', season: 'growing season' },
  snail:       { cls: 'invertebrate', cryptic: true, noun: 'snail', micro: ['woodland', 'streambank', 'pond', 'deadfall'], colors: ['brown-banded', 'pale'], base: 40, unit: 'snails', catch: 'easy (after rain, at night)', parasite: 0.45, nutrition: 'protein, some minerals', products: ['flesh', 'shell'], signs: ['silvery slime trails'], activity: 'night and after rain', season: 'growing season, mainly after rain' },
  crayfish:    { cls: 'invertebrate', cryptic: true, noun: 'crayfish', micro: ['streambed', 'pond'], colors: ['olive-brown', 'reddish'], base: 12, unit: 'crayfish', catch: 'moderate (by hand under stones)', defense: 'pinching claws', parasite: 0.35, nutrition: 'lean protein', products: ['tail and claw meat', 'shell'], signs: ['burrows in banks', 'claws and shells left by predators'], activity: 'night', season: 'growing season' },
  mussel:      { cls: 'invertebrate', noun: 'mussel', micro: ['streambed', 'pond'], colors: ['dark'], base: 25, unit: 'mussels', catch: 'easy (wade and feel in soft bottom)', parasite: 0.3, biotoxin: 0.15, nutrition: 'protein, iron, other minerals', products: ['flesh', 'shell (scrapers, containers)'], signs: ['empty shells on banks and gravel bars'], activity: 'sedentary', season: 'year-round, water permitting' },
  worm:        { cls: 'invertebrate', cryptic: true, noun: 'earthworm', micro: ['woodland', 'edge', 'glade', 'streambank', 'claybank'], colors: ['pink-brown', 'reddish'], base: 50, unit: 'worms', catch: 'easy (dig in moist soil; they surface after rain)', parasite: 0.15, nutrition: 'protein, some fat', products: ['whole worm (purge in water, then cook)'], signs: ['worm casts on bare soil'], activity: 'in the soil; up at night and after rain', season: 'growing season; deep in dry or cold spells' },
  woodlouse:   { cls: 'invertebrate', cryptic: true, noun: 'woodlouse', micro: ['deadfall', 'woodland', 'edge'], colors: ['slate grey', 'mottled brown'], base: 60, unit: 'woodlice', catch: 'easy (under bark, logs and stones)', parasite: 0.08, nutrition: 'protein', products: ['whole woodlouse'], signs: ['clusters under loose bark'], activity: 'hidden by day in damp places', season: 'year-round' },
  cricket:     { cls: 'invertebrate', cryptic: true, noun: 'cricket', micro: ['glade', 'edge', 'outcrop'], colors: ['black', 'brown'], base: 25, unit: 'crickets', catch: 'easy by day under stones; hard at night', parasite: 0.08, nutrition: 'protein and fat', products: ['whole insect (remove legs and wings)'], signs: ['chirping at dusk and night'], activity: 'night; under stones by day', season: 'growing season' },
  termite:     { cls: 'invertebrate', noun: 'termite', minTemp: 16, micro: ['glade', 'woodland', 'edge'], colors: ['pale', 'cream'], base: 3, unit: 'mounds', catch: 'easy (break open the mound or rotten wood)', defense: 'soldiers nip', parasite: 0.03, nutrition: 'high fat and protein', products: ['whole termites'], signs: ['earthen mounds and mud tubes on wood'], activity: 'inside mounds and wood', season: 'year-round; swarms after the first rains' },
  bee:         { cls: 'invertebrate', noFood: true, noun: 'bee', minTemp: 6, micro: ['glade', 'edge', 'woodland'], colors: ['honey-brown', 'dark', 'striped'], base: 8, unit: 'bees', catch: 'hard: the hive is in a hollow tree or log; smoke calms the bees', defense: 'stings', parasite: 0.02, nutrition: 'honey: very high sugar; brood: fat and protein', products: ['honeycomb', 'brood', 'wax'], signs: ['bees working the flowers', 'a steady hum around a hollow tree'], activity: 'day', season: 'honey best late in the growing season' },
  wasp:        { cls: 'invertebrate', noun: 'wasp', minTemp: 8, micro: ['edge', 'glade', 'woodland'], colors: ['yellow-and-black', 'red-and-black'], base: 6, unit: 'wasps', catch: 'hard: grubs in a papery nest; stings', defense: 'stings', parasite: 0.03, nutrition: 'larvae: fat and protein', products: ['larvae'], signs: ['a grey, papery nest', 'wasps at fallen fruit'], activity: 'day', season: 'late growing season' },
  mosquito:    { cls: 'invertebrate', noFood: true, noun: 'mosquito', minTemp: 8, micro: ['pond', 'streambank', 'spring'], colors: ['grey', 'striped'], base: 200, unit: 'mosquitoes', catch: 'not food', defense: 'bites; itchy welts', parasite: 0, nutrition: 'nothing worth having', products: [], signs: ['a thin whine at dusk', 'itchy bites'], activity: 'dusk and night', season: 'warm, wet weather' },
  gnat:        { cls: 'invertebrate', noFood: true, noun: 'gnat', micro: ['pond', 'streambank', 'glade', 'edge'], colors: ['black', 'grey'], base: 300, unit: 'gnats', catch: 'not food', defense: 'bites around the eyes', parasite: 0, nutrition: 'nothing worth having', products: [], signs: ['clouds of tiny flies at dusk'], activity: 'dusk', season: 'growing season' },
  fly:         { cls: 'invertebrate', noFood: true, noun: 'fly', micro: ['glade', 'edge', 'woodland', 'streambank', 'pond'], colors: ['metallic green', 'grey', 'blue-black'], base: 40, unit: 'flies', catch: 'not food', parasite: 0, nutrition: 'nothing worth having', products: [], signs: ['flies on droppings', 'a cloud of flies over something dead'], activity: 'day', season: 'warm weather' },
  stinker:     { cls: 'small', noun: 'musk animal', mass: 1.5, micro: ['woodland', 'edge', 'glade'], colors: ['black-and-white striped', 'dark brown'], diet: 'omnivore', catch: 'leave it alone: it sprays a stinking, blinding musk', defense: 'sprays musk', parasite: 0.3, nutrition: 'lean meat, if you can stand it', products: ['meat', 'pelt'], signs: ['a rank, musky stink', 'small pits dug in the soil'], activity: 'night', season: 'year-round', smell: 'a rank, burnt-rubber musk' },
  rodent:      { cls: 'small', noun: 'rodent', mass: 0.15, micro: ['glade', 'edge', 'woodland'], colors: ['brown', 'grey', 'sandy'], diet: 'plant', catch: 'hard by hand; easy with deadfall traps or snares', parasite: 0.2, nutrition: 'lean meat, organs', products: ['meat', 'organs', 'small hide'], signs: ['burrow holes', 'gnawed seeds and nuts', 'droppings'], activity: 'night', season: 'year-round' },
  hare:        { cls: 'small', noun: 'hare', mass: 2.5, micro: ['glade', 'edge'], colors: ['brown', 'grey'], diet: 'plant', lean: true, catch: 'not by hand; snares on runs', parasite: 0.25, nutrition: 'very lean meat', products: ['meat', 'organs', 'hide', 'sinew'], signs: ['runs through grass', 'round droppings', 'resting hollows in grass'], activity: 'dawn and dusk', season: 'year-round' },
  lizard:      { cls: 'small', noun: 'lizard', mass: 0.05, micro: ['outcrop', 'scree', 'glade'], colors: ['brown', 'green', 'grey'], diet: 'insect', minTemp: 8, catch: 'moderate (easy in cool mornings before they warm up)', parasite: 0.25, nutrition: 'lean meat', products: ['meat', 'eggs (seasonal)'], signs: ['basking on warm rocks', 'tracks with a tail drag in dust'], activity: 'day (basking)', season: 'warm season' },
  frog:        { cls: 'small', noun: 'frog', mass: 0.04, micro: ['pond', 'streambank'], colors: ['green', 'brown'], aposematic: 0.25, diet: 'insect', catch: 'easy at night', parasite: 0.35, nutrition: 'lean meat (legs)', products: ['legs'], signs: ['calling at night', 'splashes at the water edge'], activity: 'night', season: 'growing season' },
  groundbird:  { cls: 'small', noun: 'ground bird', mass: 0.8, micro: ['glade', 'edge'], colors: ['speckled brown', 'grey'], diet: 'omnivore', catch: 'adults hard by hand; eggs easy in nesting season', parasite: 0.2, nutrition: 'meat; eggs rich in fat and protein', products: ['meat', 'eggs (seasonal)', 'feathers', 'bones'], signs: ['dust-bathing hollows', 'alarm calls when flushed', 'nests on the ground'], activity: 'day', season: 'eggs early in the growing season' },
  fish:        { cls: 'small', noun: 'fish', mass: 0.2, micro: ['streambed', 'pond'], colors: ['silver', 'olive', 'spotted'], diet: 'insect', catch: 'moderate in shallow pools; easy with weirs or traps', parasite: 0.3, nutrition: 'protein and fat', products: ['meat', 'oil', 'bones'], signs: ['rises at dusk', 'shadows in pools'], activity: 'day', season: 'year-round' },
  songbird:    { cls: 'small', noun: 'songbird', mass: 0.03, micro: ['edge', 'woodland', 'glade'], colors: ['brown', 'olive', 'grey', 'yellow-breasted'], diet: 'insect', catch: 'hard by hand; nests can be raided in season', parasite: 0.15, nutrition: 'a mouthful of meat; eggs in season', products: ['meat', 'eggs (seasonal)', 'feathers'], signs: ['song from the bushes', 'flitting between branches'], activity: 'dawn and day', season: 'year-round; eggs early in the growing season' },
  soarer:      { cls: 'large', noun: 'soaring bird', mass: 6, micro: ['glade', 'outcrop', 'scree', 'edge', 'streambank', 'pond'], colors: ['dark', 'brown', 'pale-headed'], diet: 'meat', catch: 'not catchable', parasite: 0.4, nutrition: 'lean meat', products: ['feathers', 'bones'], signs: ['circling high on rising air', 'gathering where something has died'], activity: 'day', season: 'year-round' },
  browser:     { cls: 'large', noun: 'deer', mass: 60, micro: ['glade', 'edge', 'woodland'], colors: ['tawny', 'grey-brown', 'russet'], diet: 'plant', catch: 'requires hunting weapons or traps', danger: 'kicks; antlers during the rut', parasite: 0.15, nutrition: 'meat, seasonal fat, marrow', products: ['meat', 'fat', 'marrow', 'hide', 'sinew', 'bone', 'antler (shed antlers can be found)'], signs: ['hoofprints', 'browsed twigs', 'pellet droppings', 'shed antlers'], activity: 'dawn and dusk', season: 'year-round' },
  rooter:      { cls: 'large', noun: 'pig', mass: 70, micro: ['woodland', 'edge', 'streambank'], colors: ['dark bristly', 'grizzled grey', 'reddish-brown'], diet: 'omnivore', catch: 'requires hunting weapons or traps', danger: 'tusks; charges when cornered or wounded', parasite: 0.5, nutrition: 'fatty meat, marrow', products: ['meat', 'fat', 'marrow', 'hide', 'bone', 'tusks'], signs: ['churned, rooted-up soil', 'mud wallows', 'tusk marks on trees'], activity: 'dawn and dusk', season: 'year-round' },
  predator:    { cls: 'large', noun: 'big dog', mass: 35, micro: ['woodland', 'edge', 'glade'], colors: ['grey', 'tawny', 'dark'], diet: 'meat', catch: 'not a food source early; avoid', danger: 'may stalk lone people at dusk', parasite: 0.6, nutrition: 'lean meat', products: ['hide', 'teeth', 'bone', 'sinew'], signs: ['large paw prints', 'scat full of hair and bone', 'partly eaten kills'], activity: 'dusk and night', season: 'year-round' },
};
// What each vertebrate leaves behind. Channels reveal different traits:
// tracks → size, group size, gait; calls → identity; hair → colour; scat and damage → diet, size.
const SIGN_PROFILE = {
  browser:    { track: 'cloven hoofprints', call: 'deer', scat: 'piles of dark oval pellets', damage: 'browse', den: null, hair: true, speed: 0.8, group: 5 },
  rooter:     { track: 'cloven hoofprints', call: 'grunter', scat: 'loose dung with seeds and bits of shell', damage: 'churned, rooted-up soil', den: 'mud wallows', hair: true, speed: 0.55, group: 6 },
  predator:   { track: t => (t.pack ? 'four-toed pawprints with claw marks' : 'round four-toed pawprints, no claw marks'), call: t => (t.pack ? 'canid' : 'felid'), scat: 'twisted scat full of hair and bone', damage: 'the remains of a kill', den: 'a den under the rocks', hair: true, speed: 0.85, group: t => (t.pack ? 4 : 1) },
  hare:       { track: 'long paired hind-foot prints', call: null, scat: 'small round droppings', damage: 'grass nibbled short', den: 'flattened resting hollows in the grass', hair: true, speed: 0.95, group: 1 },
  stinker:    { track: 'small five-toed prints', call: null, scat: 'small dark droppings full of beetle shells', damage: 'small pits dug in the soil', den: 'a burrow that reeks of musk', hair: true, speed: 0.4, group: 1 },
  rodent:     { track: 'tiny four-toed prints', call: 'rodent', scat: null, damage: 'gnawed nut shells', den: 'burrow holes', hair: false, speed: 0.5, group: 1 },
  groundbird: { track: 'three-toed bird prints', call: 'bird', scat: null, damage: 'scratched-up leaf litter', den: 'a nest scraped in the ground', hair: false, speed: 0.6, group: 6 },
  songbird:   { track: null, call: 'bird', scat: null, damage: null, den: 'a small cup nest in the bushes', hair: false, speed: 0.7, group: 3 },
  lizard:     { track: 'tiny clawed prints with a tail drag', call: null, scat: null, damage: null, den: null, hair: false, speed: 0.6, group: 1 },
  frog:       { track: null, call: 'frog', scat: null, damage: null, den: 'frogspawn in the shallows', hair: false, speed: 0.4, group: 1 },
  fish:       { track: null, call: null, scat: null, damage: null, den: null, hair: false, speed: 0.6, group: 8 },
  soarer:     { track: null, call: 'raptor', scat: null, damage: null, den: null, hair: false, speed: 0.9, group: 1, distant: true },
};
const CALL_SOUNDS = {
  bird: ['tweet', 'whistle', 'chip', 'trill', 'peep'], frog: ['croak', 'peep', 'click', 'trill'],
  grunter: ['grunt', 'squeal', 'snort'], deer: ['bark', 'bleat', 'bellow'], canid: ['howl', 'yip', 'bark'],
  felid: ['yowl', 'cough', 'scream'], rodent: ['squeak', 'chitter'], raptor: ['scream', 'mew', 'whistle'],
};
function makeCall(r, family, used) {
  for (let tries = 0; tries < 8; tries++) {
    const sound = r.pick(CALL_SOUNDS[family]);
    const count = r.weighted([[1, 2], [2, 2], [3, 2], [4, 1]]);
    const pace = r.pick(['quick', 'slow', 'sharp', 'soft']);
    const pitch = r.pick(['high', 'low', '']);
    const contour = ['whistle', 'trill', 'howl', 'scream'].includes(sound) ? r.pick(['rising', 'falling', 'wavering', '']) : '';
    const plural = /(s|sh|ch|x)$/.test(sound) ? `${sound}es` : `${sound}s`;
    const words = arr => arr.filter(Boolean).join(' ');
    const desc = count === 1 ? `a single ${words([pitch, contour, sound])}`
      : count === 4 ? `a run of ${words([pace, pitch, plural])}`
      : `${count === 2 ? 'two' : 'three'} ${words([pace, pitch, contour, plural])}`;
    if (!used.has(desc)) { used.add(desc); return desc; }
  }
  return null;
}
const sizeClass = cm => (cm < 2 ? 'tiny' : cm < 5 ? 'small' : cm < 9 ? 'medium' : 'large');

const WARNING_COLORS = ['red-and-black', 'yellow-and-black', 'orange-spotted', 'black-and-white banded'];
const DAMUTH_K = { plant: 100, omnivore: 40, insect: 60, meat: 8 }; // density ~ k * mass^-0.75 per km²
const INVERT_LENGTH_CM = { bee: 1.3, wasp: 1.6, mosquito: 0.6, gnat: 0.2, fly: 0.8, grub: 3, ant: 0.6, grasshopper: 4, caterpillar: 4, beetle: 2, snail: 2.5, crayfish: 9, mussel: 7, worm: 10, woodlouse: 1.2, cricket: 2.5, termite: 0.8 };
const ANIMAL_VARYING = [
  { id: 'size', label: t => (t.cls === 'invertebrate' ? 'body length' : 'body mass'), unit: t => (t.cls === 'invertebrate' ? 'cm' : 'kg'), kind: 'visible', scale: 'log', sd: 0.2, prior: { fertility: 1 },
    median: t => (t.cls === 'invertebrate' ? INVERT_LENGTH_CM[t.key] * t.sizeFactor : t.mass) },
  { id: 'colorDepth', label: 'colour depth (0 drab, 1 vivid)', kind: 'visible', scale: '01', sd: 0.8, prior: { exposure: 1 }, median: () => 0.5 },
  { id: 'fat', label: 'fat content', kind: 'useful', scale: '01', sd: 0.6, when: t => !t.lean && t.key !== 'predator', prior: { fertility: 1 },
    median: t => (t.cls === 'invertebrate' ? 0.4 : 0.25) },
  { id: 'parasite', label: 'parasite load', kind: 'useful', scale: '01', sd: 0.6, when: t => t.parasite >= 0.1, prior: { moisture: 1 }, median: t => t.parasite },
  { id: 'toxin', label: 'toxicity', kind: 'useful', scale: '01', sd: 0.5, when: t => t.aposematic, prior: {}, median: t => t.toxin },
];

// Egg-layers whose clutches can be found and eaten: kg in a find, and where the clutch is.
const EGGS = {
  groundbird: { kg: 0.25, nest: 'a clutch in a scrape on the ground' },
  songbird: { kg: 0.03, nest: 'a few small eggs in a cup nest' },
  lizard: { kg: 0.02, nest: 'a clutch of leathery eggs under a stone' },
};
const parasiteLabel = p => (p < 0.12 ? 'safe' : p < 0.3 ? 'some parasite risk' : 'high parasite risk');

function animalArchetype(r, key, env) {
  const T = ANIMALS[key];
  const t = { kind: 'animal', key, cls: T.cls, noun: T.noun };
  if (key === 'predator') {
    t.noun = r.pick(['wild dog', 'big cat']);
    t.pack = t.noun === 'wild dog';
  }
  t.mass = T.mass ? round(r.logNormal(T.mass, 0.25), T.mass < 1 ? 3 : 1) : null;
  t.sizeFactor = T.mass ? null : round(r.logNormal(1, 0.25));
  const rel = T.mass ? t.mass / T.mass : t.sizeFactor;
  t.sizeWord = rel > 1.2 ? 'big' : rel < 0.83 ? 'little' : null;
  t.aposematic = !!T.aposematic && r.chance(T.aposematic);
  t.hairy = key === 'caterpillar' && !t.aposematic && r.chance(0.35);
  t.color = t.aposematic ? r.pick(WARNING_COLORS) : r.pick(T.colors);
  t.toxin = t.aposematic ? round(r.uniform(0.4, 0.9)) : 0;
  t.parasite = round(clamp(T.parasite + r.normal(0, 0.06)));
  t.biotoxin = !!T.biotoxin && r.chance(T.biotoxin);
  t.wariness = round(r.uniform(0.2, 0.9));
  t.lean = !!T.lean;
  t.fatSeasonal = env.seasonality > 0.35 && T.cls !== 'invertebrate';
  t.habitatSet = T.micro.filter(id => env.microhabitats.some(m => m.id === id));
  t.densityFactor = round(r.logNormal(1, 0.4));
  t.varying = pickVarying(r.fork('varying'), ANIMAL_VARYING, t);
  const prof = SIGN_PROFILE[key];
  const group = prof ? (typeof prof.group === 'function' ? prof.group(t) : prof.group) : 1;
  if (group > 1.5) {
    t.varying.push(makeVarying(r.fork('groupSize'), { id: 'groupSize', label: 'group size', kind: 'visible', scale: 'log', unit: 'animals', sd: 0.4, prior: { fertility: 1 }, median: () => group }, t, t.varying[0]?.integration ?? 0.5));
  }
  return t;
}

function buildAnimal(seed, id, t, env, namer, mc, callsUsed) {
  const T = ANIMALS[t.key];
  const vertebrate = t.cls !== 'invertebrate';
  const sizeWord = vertebrate
    ? (t.mass / T.mass > 1.2 ? 'big' : t.mass / T.mass < 0.83 ? 'small' : null)
    : (t.sizeFactor > 1.2 ? 'big' : t.sizeFactor < 0.83 ? 'small' : null);

  const cues = [`${t.color} ${t.noun}${sizeWord ? ` (${sizeWord} for its kind)` : ''}`];
  if (t.aposematic) cues.push('bold, contrasting warning colors; makes no effort to hide');
  if (t.hairy) cues.push('covered in fine, bristly hairs');
  cues.push(...T.signs);
  cues.push(`active: ${T.activity}`);
  if (vertebrate) cues.push(t.wariness > 0.6 ? 'very wary; bolts at the slightest sound' : t.wariness < 0.35 ? 'unusually tolerant of approach' : 'moderately wary');

  const fieldTests = [];
  if (t.key === 'caterpillar' || t.key === 'beetle' || t.key === 'frog') {
    fieldTests.push(['Lip test of skin or body fluid', t.toxin > 0 ? 'intensely bitter; numbs the lip' : 'nothing notable']);
  }
  if (t.hairy) fieldTests.push(['Handle bare-handed', 'itchy rash where the hairs touched']);
  if (vertebrate && t.key !== 'predator') {
    fieldTests.push(['Feel fat cover after a catch', t.lean ? 'almost no fat, even in good season' : t.fatSeasonal ? `well padded late in the growing season; little fat by the end of the ${env.leanSeason}` : 'moderate fat most of the year']);
  }
  if (t.key === 'mussel') fieldTests.push(['Tap the shell', 'living mussels close tightly; gaping ones are dead and unsafe']);
  fieldTests.push(['Smell after killing', 'fresh: clean smell; any sour or rotten smell means spoiled']);

  const raw = t.toxin > 0 ? hazard(t.toxin) : parasiteLabel(t.parasite);
  const cooked = t.toxin > 0 ? hazard(t.toxin * 0.9)
    : t.biotoxin ? 'safe in most seasons; shellfish poisoning in some'
    : t.hairy ? 'safe once hairs are singed off' : 'safe';
  const food = t.key === 'predator' || T.noFood ? null : { raw, cooked };
  // what a handful is made of: fatty larvae, shellfish, or ordinary small creatures; parasites
  // (killed by cooking) and shellfish toxins (not) ride along as compounds
  const cr = makeRng(`${seed}/${id}/chem`);
  const chemCls = ['grub', 'termite', 'wasp'].includes(t.key) ? 'fattyGrub' : ['mussel', 'crayfish', 'snail'].includes(t.key) ? 'shellfish' : 'invertebrate';
  const chem = food && !vertebrate ? sampleComposition(cr, chemCls, { extraCompounds: [{ kind: 'parasites', p: 1, dose: [t.parasite * 0.8, t.parasite * 1.4] }, ...(t.biotoxin ? [{ kind: 'biotoxin', p: 0.5, dose: [0.1, 0.4] }] : []), ...(t.toxin > 0 ? [{ kind: 'alkaloid', p: 1, dose: [t.toxin / 1.3, t.toxin / 1.3] }] : [])] }) : null;
  const honeyChem = t.key === 'bee' ? sampleComposition(cr.fork('honey'), 'honey') : null;
  // eggs: shell-borne germs (killed by cooking) at about half the adults' parasite load
  const eggs = EGGS[t.key] ? { chem: { ...sampleComposition(cr.fork('egg'), 'egg', { extraCompounds: [{ kind: 'parasites', p: 1, dose: [t.parasite * 0.35, t.parasite * 0.6] }] }), gather: EGGS[t.key].kg }, food: { raw: parasiteLabel(t.parasite * 0.5), cooked: 'safe' }, nest: EGGS[t.key].nest } : null;

  const deliberate = [];
  if (food) deliberate.push(['Eat raw / cooked, wait a few days', `${raw} / ${cooked}`]);
  if (t.biotoxin) deliberate.push(['Eat over several seasons', 'occasional shellfish poisoning (tingling, numbness) in some seasons, even when cooked']);
  if (t.lean) deliberate.push(['Live mostly on this meat for weeks', 'protein poisoning ("rabbit starvation") unless fat is added from elsewhere']);
  if (T.products.includes('hide')) deliberate.push(['Scrape, dry, and work the hide', t.mass > 20 ? 'thick, durable hide (tanning improves it greatly)' : 'thin hide; small pieces only']);
  if (T.products.includes('sinew')) deliberate.push(['Dry and shred sinew', 'strong fiber for lashing and sewing']);

  let habitats, perKm2 = null;
  const set = t.habitatSet.length ? t.habitatSet : T.micro.slice(0, 1);
  if (vertebrate) {
    perKm2 = round(DAMUTH_K[T.diet] * Math.pow(t.mass, -0.75) * t.densityFactor, 1);
    habitats = set.map(id => ({ micro: id, name: env.microhabitats.find(m => m.id === id)?.name ?? id }));
  } else {
    const weights = [1, 0.6, 0.4, 0.3];
    habitats = set.map((id, i) => {
      const m = env.microhabitats.find(x => x.id === id);
      return { micro: id, name: m?.name ?? id, unit: m?.unit ?? 'instance', perInstance: Math.max(1, Math.round(T.base * t.densityFactor * (t.sizeFactor > 1 ? 0.8 : 1) * weights[i])) };
    });
  }

  const sites = habitats.map(h => ({ micro: h.micro, weight: h.perInstance ?? 1 }));
  const prof = SIGN_PROFILE[t.key];
  let signs = null;
  if (prof) {
    const val = x => (typeof x === 'function' ? x(t) : x);
    const track = val(prof.track);
    const factor = /bird/.test(track ?? '') ? 5 : /hoof/.test(track ?? '') ? 2.2 : 2.6;
    const lengthCm = track ? Math.round(2 * factor * Math.cbrt(t.mass)) / 2 : null;
    const sr = makeRng(`${seed}/signs/${id}`);
    signs = {
      track: track ? { type: track, lengthCm, sizeClass: sizeClass(lengthCm) } : null,
      call: prof.call ? makeCall(sr, val(prof.call), callsUsed) : null,
      scat: t.mass >= 0.5 ? prof.scat : null,
      damage: prof.damage === 'browse' ? `twigs browsed off up to about ${round(0.24 * Math.cbrt(t.mass), 1)} m` : prof.damage,
      den: prof.den,
      hair: prof.hair ? t.color : null,
      speed: prof.speed, group: val(prof.group), distant: !!prof.distant,
    };
  }
  return {
    id, kind: 'animal', cls: t.cls, cryptic: !!T.cryptic,
    name: namer.animal(t, habitats[0]?.micro),
    unit: T.unit, traits: t, habitats, perKm2,
    varying: t.varying, variation: summarize(seed, id, t.varying, sites, env, mc), signs,
    cues, fieldTests, deliberate, food,
    catch: T.catch, products: T.products, nutrition: T.nutrition, season: T.season, smell: T.smell ?? null, chem, honeyChem, eggs,
    defense: T.defense ?? null, danger: T.danger ?? null,
  };
}

export function generateAnimals(rng, env, seed, namer, mc) {
  const has = id => env.microhabitats.some(m => m.id === id);
  const eligible = k => ANIMALS[k].micro.some(has) && (!ANIMALS[k].minTemp || env.meanTempC >= ANIMALS[k].minTemp);
  const pickN = (arr, n, r) => r.shuffle([...arr]).slice(0, n);
  const keys = [];
  // Invertebrates are the commonest animal food almost everywhere: grubs and ants nearly always,
  // often a second kind of ant, and four to six others.
  if (eligible('grub')) keys.push('grub');
  if (eligible('ant')) { keys.push('ant'); if (rng.fork('ants').chance(0.45)) keys.push('ant'); }
  keys.push(...pickN(['termite', 'worm', 'woodlouse', 'cricket', 'grasshopper', 'caterpillar', 'beetle', 'snail', 'crayfish', 'mussel'].filter(eligible), rng.int(4, 6), rng.fork('inverts')));
  // the flying insects: flies nearly everywhere, biters near water, bees and wasps where it's warm enough
  const fly = rng.fork('flying');
  for (const [k, p] of [['fly', 0.95], ['mosquito', 0.8], ['gnat', 0.6], ['bee', 0.7], ['wasp', 0.5]]) if (eligible(k) && fly.chance(p)) keys.push(k);
  keys.push(...pickN(['rodent', 'hare', 'lizard', 'frog', 'groundbird', 'songbird', 'fish'].filter(eligible), rng.int(3, 4), rng.fork('small')));
  if (eligible('stinker') && fly.chance(0.15)) keys.push('stinker'); // rare
  keys.push(...pickN(['browser', 'rooter'].filter(eligible), rng.int(1, 2), rng.fork('large')));
  if (eligible('predator') && rng.chance(0.7)) keys.push('predator');
  if (eligible('soarer') && rng.chance(0.65)) keys.push('soarer');
  const callsUsed = new Set();
  const out = keys.map((key, i) => {
    const id = `A${i + 1}`;
    return buildAnimal(seed, id, animalArchetype(rng.fork(id), key, env), env, namer, mc, callsUsed);
  });
  // Two species of one kind (two ants): neither keeps the bare name; each gets its look ("red ant", "big ant").
  for (const a of out) {
    const kin = out.filter(b => b !== a && b.traits.key === a.traits.key);
    if (!kin.length) continue;
    if (/ /.test(a.name)) { a.nameBase ??= kin.find(b => !/ /.test(b.name))?.name ?? a.name.split(' ').pop(); a.coined = true; continue; }
    const taken = new Set(out.map(b => b.name));
    const pick = [a.traits.color, a.traits.sizeWord, 'little', 'big'].find(w => w && !taken.has(`${w} ${a.name}`));
    if (pick) { a.nameBase = a.name; a.coined = true; a.name = `${pick} ${a.name}`; }
  }
  return out;
}

// ---------------------------------------------------------------- solvability

export function starterCheck(world) {
  const plants = world.plants;
  const animals = world.animals;
  const partsWith = re => plants.flatMap(p => p.parts.filter(x => x.uses.some(u => re.test(u))).map(x => `${p.name} (${x.part})`));
  const need = (label, sources) => ({ need: label, met: sources.length > 0, sources });

  const knap = world.stones.filter(s => s.hidden.fracture * (1 - s.hidden.flawRate) >= 0.45)
    .map(s => `${s.name}${s.rarity === 'rare' ? ' (rare, in stream gravel)' : ''}`);
  const hammer = world.stones.filter(s => s.uses.includes('hammerstone')).map(s => s.name);
  const hearth = partsWith(/hearth/), spindle = partsWith(/spindle/);
  const calories = [
    ...plants.flatMap(p => p.parts.filter(x => x.food && x.food.cooked === 'safe' && /starch|fat|sugar/.test(x.nutrition)).map(x => `${p.name} (${x.part})`)),
    ...animals.filter(a => a.cls === 'invertebrate' && a.food?.cooked === 'safe' && /^easy/.test(a.catch) && /fat/.test(a.nutrition)).map(a => a.name),
  ];
  const leanFood = [
    ...plants.flatMap(p => p.parts.filter(x => x.food && x.food.cooked !== 'potentially lethal' && ['safe', 'mild upset'].includes(x.food.leached) && /stores well/.test(x.nutrition)).map(x => `${p.name} (${x.part})`)),
    ...animals.filter(a => a.traits.key === 'grub' && a.food?.cooked === 'safe').map(a => a.name),
  ];
  return [
    need('Drinking water', world.water.filter(w => w.micro !== 'anywhere').map(w => w.name)),
    need('Knappable stone', knap),
    need('Hammerstone', hammer),
    need('Tinder', partsWith(/tinder/)),
    need('Fire drill (hearth and spindle)', hearth.length && spindle.length ? [...hearth.slice(0, 2), ...spindle.slice(0, 2)] : []),
    need('Cordage fiber', partsWith(/cordage/)),
    need('Safe calories (cooked)', calories),
    need('Lean-season food (stores or year-round)', leanFood),
  ];
}
