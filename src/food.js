// food.js — what food is made of, what preparation does to it, and what eating it gives.
//
// Three layers of data and a few generic functions; no species-specific code.
//
//   1. COMPOUNDS: kinds of compound and how each responds to water, heat and crushing, what it does
//      to the eater, and what it tastes or smells like.
//   2. PART_SPECS: for each kind of food part (nut, tuber, leaf, grub, ...), ranges for its make-up
//      (water, starch, sugar, fat, protein, fibre), how much of each can be absorbed raw ("access"),
//      and a list of compounds it may carry, each with a chance and a dose range. Rare properties
//      are low-chance entries. A plant's existing defence (tannin, alkaloid, ...) adds its compound.
//   3. Processes declare exposures ({ crush, heat, water, dry }); `expose` applies any exposure to
//      any food state. Eating runs `digest`.
//
// Numbers are first drafts from the nutrition and food-processing literature as remembered, to be
// tuned: energy 4 kcal/g for starch, sugar and protein, 9 for fat; the cost of digesting is roughly a
// quarter of protein's energy, under a tenth of carbohydrate's, a little of fat's; past about 35% of
// energy from protein the liver can't keep up (nausea, and the excess is wasted: "rabbit starvation").

// ------------------------------------------------------------ 1. compounds
// water: share removed by thorough leaching; heat: share destroyed by thorough cooking (wet heat
// for `wet` kinds; dry heat does a quarter as well); volatile: share that escapes once crushed and
// then dried, heated or soaked; potency: harm per unit dose; taste/smell: what the senses pick up.
export const COMPOUNDS = {
  tannin:    { water: 0.9,  heat: 0.15, volatile: 0,   potency: 0.35, effect: 'binder',   taste: 'astringent, puckering' },
  cyanogen:  { water: 0.5,  heat: 0.4,  volatile: 0.9, potency: 1.0,  effect: 'systemic', taste: 'bitter', smell: 'bitter almond' },
  lectin:    { water: 0.1,  heat: 0.97, wet: true, volatile: 0, potency: 0.5, effect: 'gut', taste: null },
  oxalate:   { water: 0.3,  heat: 0.7,  wet: true, volatile: 0, potency: 0.6, effect: 'irritant', taste: 'burning, prickling' },
  alkaloid:  { water: 0.35, heat: 0.05, volatile: 0,   potency: 1.3,  effect: 'systemic', taste: 'intensely bitter' },
  latex:     { water: 0.4,  heat: 0.4,  volatile: 0,   potency: 0.8,  effect: 'gut',      taste: 'bitter and sticky' },
  saponin:   { water: 0.8,  heat: 0.2,  volatile: 0,   potency: 0.5,  effect: 'gut',      taste: 'soapy, bitter' },
  stinging:  { water: 0.5,  heat: 1.0,  crush: 0.8, volatile: 0, potency: 0.5, effect: 'irritant', taste: 'stinging' },
  resin:     { water: 0.05, heat: 0.3,  volatile: 0.3, potency: 0.35, effect: 'gut',      taste: 'resinous', smell: 'resin' },
  aromatic:  { water: 0.3,  heat: 0.5,  volatile: 0.6, potency: 0.12, effect: 'gut',      taste: 'sharp, minty', smell: 'aromatic' },
  sulfur:    { water: 0.3,  heat: 0.6,  volatile: 0.6, potency: 0.05, effect: 'gut',      taste: 'oniony', smell: 'onion' },
  lichenAcid:{ water: 0.85, heat: 0.2,  volatile: 0,   potency: 0.4,  effect: 'gut',      taste: 'bitter' },
  fungal:    { water: 0.2,  heat: 0.3,  volatile: 0,   potency: 1.0,  effect: 'gut',      taste: null },
  amatoxin:  { water: 0,    heat: 0,    volatile: 0,   potency: 3.0,  effect: 'delayed',  taste: null },
  biotoxin:  { water: 0,    heat: 0.05, volatile: 0,   potency: 1.5,  effect: 'systemic', taste: null },
  parasites: { water: 0,    heat: 1.0,  fast: true, volatile: 0, potency: 0.6, effect: 'parasite', taste: null }, // a few minutes of real heat kills them
};
// the plant defence traits from life.js, as compounds
export const DEFENSE_COMPOUND = { alkaloid: 'alkaloid', cyanogenic: 'cyanogen', latex: 'latex', oxalate: 'oxalate', tannin: 'tannin', stinging: 'stinging', aromatic: 'aromatic', sulfur: 'sulfur', resinous: 'resin' };

// ------------------------------------------------------------ 2. part specs
// Fractions of fresh mass; access is the share absorbable raw. `gather` is kg of the edible part
// in half an hour from a decent patch. `extra`: compounds beyond the plant's defence.
const R = (a, b) => [a, b];
export const PART_SPECS = {
  nut:        { gather: 0.15, water: R(0.05, 0.3),  starch: R(0.05, 0.4),  sugar: R(0, 0.05),    fat: R(0.15, 0.6),  protein: R(0.08, 0.2),  fibre: R(0.05, 0.12), access: { starch: R(0.5, 0.7), fat: R(0.3, 0.5), protein: R(0.4, 0.6) }, hard: true, extra: [{ kind: 'tannin', p: 0.3, dose: R(0.3, 1.2) }, { kind: 'cyanogen', p: 0.08, dose: R(0.2, 0.8) }] },
  seed:       { gather: 0.05, water: R(0.08, 0.12), starch: R(0.1, 0.3),   sugar: R(0, 0.03),    fat: R(0.2, 0.4),   protein: R(0.15, 0.25), fibre: R(0.15, 0.25), access: { starch: R(0.3, 0.5), fat: R(0.2, 0.4), protein: R(0.3, 0.5) }, hard: true, extra: [{ kind: 'lectin', p: 0.2, dose: R(0.2, 0.6) }, { kind: 'saponin', p: 0.15, dose: R(0.2, 0.6) }] },
  grain:      { gather: 0.08, water: R(0.1, 0.15),  starch: R(0.55, 0.7),  sugar: R(0, 0.02),    fat: R(0.02, 0.04), protein: R(0.08, 0.14), fibre: R(0.08, 0.15), access: { starch: R(0.25, 0.45), fat: R(0.3, 0.4), protein: R(0.35, 0.5) }, hard: true, extra: [] },
  pod:        { gather: 0.15, water: R(0.5, 0.75),  starch: R(0.1, 0.25),  sugar: R(0.01, 0.04), fat: R(0.01, 0.03), protein: R(0.06, 0.12), fibre: R(0.05, 0.1),  access: { starch: R(0.3, 0.5), fat: R(0.5, 0.7), protein: R(0.4, 0.6) }, extra: [{ kind: 'lectin', p: 0.6, dose: R(0.3, 0.9) }] },
  storage:    { gather: 0.4,  water: R(0.65, 0.8),  starch: R(0.12, 0.28), sugar: R(0.01, 0.05), fat: R(0, 0.01),    protein: R(0.01, 0.03), fibre: R(0.02, 0.06), access: { starch: R(0.15, 0.35), fat: R(0.5, 0.7), protein: R(0.5, 0.7) }, hard: true, extra: [{ kind: 'oxalate', p: 0.15, dose: R(0.3, 1.0) }, { kind: 'saponin', p: 0.1, dose: R(0.2, 0.6) }, { kind: 'cyanogen', p: 0.08, dose: R(0.3, 0.9) }] },
  root:       { gather: 0.2,  water: R(0.7, 0.85),  starch: R(0.02, 0.06), sugar: R(0.01, 0.03), fat: R(0, 0.01),    protein: R(0.01, 0.02), fibre: R(0.08, 0.15), access: { starch: R(0.2, 0.4), fat: R(0.5, 0.7), protein: R(0.4, 0.6) }, hard: true, extra: [] },
  fruit:      { gather: 0.6,  water: R(0.8, 0.9),   starch: R(0, 0.01),    sugar: R(0.06, 0.15), fat: R(0, 0.01),    protein: R(0.005, 0.01), fibre: R(0.02, 0.05), access: { starch: R(0.8, 1), fat: R(0.8, 1), protein: R(0.6, 0.8) }, extra: [] },
  leaf:       { gather: 0.25, water: R(0.85, 0.92), starch: R(0, 0.01),    sugar: R(0.005, 0.02), fat: R(0, 0.005), protein: R(0.02, 0.04), fibre: R(0.03, 0.06), access: { starch: R(0.5, 0.7), fat: R(0.5, 0.7), protein: R(0.3, 0.5) }, extra: [{ kind: 'oxalate', p: 0.2, dose: R(0.2, 0.6) }] },
  stem:       { gather: 0.25, water: R(0.85, 0.93), starch: R(0, 0.02),    sugar: R(0.005, 0.02), fat: R(0, 0.005), protein: R(0.01, 0.02), fibre: R(0.04, 0.08), access: { starch: R(0.5, 0.7), fat: R(0.5, 0.7), protein: R(0.3, 0.5) }, extra: [] },
  flower:     { gather: 0.05, water: R(0.85, 0.92), starch: R(0, 0.01),    sugar: R(0.02, 0.06), fat: R(0, 0.005),  protein: R(0.01, 0.03), fibre: R(0.02, 0.04), access: { starch: R(0.7, 0.9), fat: R(0.5, 0.7), protein: R(0.4, 0.6) }, extra: [] },
  innerBark:  { gather: 0.2,  water: R(0.5, 0.6),   starch: R(0.05, 0.15), sugar: R(0.02, 0.05), fat: R(0, 0.01),    protein: R(0.01, 0.02), fibre: R(0.2, 0.3),   access: { starch: R(0.3, 0.5), fat: R(0.4, 0.6), protein: R(0.3, 0.5) }, extra: [] },
  invertebrate:{ gather: 0.1, water: R(0.6, 0.7),   starch: R(0, 0.01),    sugar: R(0, 0.01),    fat: R(0.03, 0.12), protein: R(0.15, 0.22), fibre: R(0.02, 0.06), access: { starch: R(0.8, 1), fat: R(0.85, 0.95), protein: R(0.75, 0.85) }, extra: [] },
  fattyGrub:  { gather: 0.1,  water: R(0.55, 0.65), starch: R(0, 0.01),    sugar: R(0, 0.01),    fat: R(0.15, 0.3),  protein: R(0.12, 0.18), fibre: R(0.02, 0.04), access: { starch: R(0.8, 1), fat: R(0.85, 0.95), protein: R(0.75, 0.85) }, extra: [] },
  shellfish:  { gather: 0.2,  water: R(0.78, 0.85), starch: R(0.02, 0.05), sugar: R(0, 0.01),    fat: R(0.01, 0.03), protein: R(0.1, 0.14), fibre: R(0, 0.01),    access: { starch: R(0.8, 1), fat: R(0.85, 0.95), protein: R(0.8, 0.9) }, extra: [] },
  mushroom:   { gather: 0.2,  water: R(0.88, 0.93), starch: R(0.01, 0.03), sugar: R(0.005, 0.02), fat: R(0, 0.005), protein: R(0.02, 0.04), fibre: R(0.01, 0.03), access: { starch: R(0.4, 0.6), fat: R(0.5, 0.7), protein: R(0.4, 0.6) }, extra: [] },
  lichen:     { gather: 0.15, water: R(0.12, 0.2),  starch: R(0.45, 0.6),  sugar: R(0.01, 0.03), fat: R(0.01, 0.02), protein: R(0.02, 0.04), fibre: R(0.15, 0.25), access: { starch: R(0.03, 0.08), fat: R(0.3, 0.5), protein: R(0.2, 0.4) }, extra: [{ kind: 'lichenAcid', p: 1, dose: R(0.3, 0.7) }] },
  egg:        { gather: 0.15, water: R(0.73, 0.77), starch: R(0, 0.01),    sugar: R(0.003, 0.01), fat: R(0.09, 0.12), protein: R(0.12, 0.14), fibre: R(0, 0),     access: { starch: R(0.9, 1), fat: R(0.85, 0.95), protein: R(0.45, 0.6) }, extra: [] }, // raw egg white is half digested; cooked, about nine-tenths
  honey:      { gather: 0.4,  water: R(0.17, 0.2),  starch: R(0, 0),       sugar: R(0.6, 0.65),  fat: R(0, 0),       protein: R(0.003, 0.005), fibre: R(0.12, 0.18), access: { starch: R(1, 1), fat: R(1, 1), protein: R(0.5, 0.7) }, extra: [] }, // fibre: wax and comb
};
// the plant part names in life.js → spec
export const PART_CLASS = { nut: 'nut', seed: 'seed', grain: 'grain', pod: 'pod', storage: 'storage', root: 'root', fruit: 'fruit', leaf: 'leaf', stem: 'stem', flower: 'flower', innerBark: 'innerBark' };

const lerp = (r, [a, b]) => a + (b - a) * r.next();
const round3 = x => Math.round(x * 1000) / 1000;

// A part's make-up, sampled once per species in world generation.
// defense: { kind, dose } from the plant's own defence (already scaled for the part), or null.
export function sampleComposition(r, cls, { defense = null, extraCompounds = [] } = {}) {
  const S = PART_SPECS[cls];
  const c = { cls, water: lerp(r, S.water), starch: lerp(r, S.starch), sugar: lerp(r, S.sugar), fat: lerp(r, S.fat), protein: lerp(r, S.protein), fibre: lerp(r, S.fibre) };
  const dry = c.starch + c.sugar + c.fat + c.protein + c.fibre;
  if (c.water + dry > 1) { const k = (1 - c.water) / dry; for (const m of ['starch', 'sugar', 'fat', 'protein', 'fibre']) c[m] *= k; }
  c.access = { starch: lerp(r, S.access.starch), fat: lerp(r, S.access.fat), protein: lerp(r, S.access.protein) };
  c.surface = 0;
  c.hard = !!S.hard;
  c.compounds = {};
  if (defense && defense.dose > 0.005) c.compounds[defense.kind] = defense.dose;
  for (const x of [...S.extra, ...extraCompounds]) if (r.chance(x.p)) { const d = lerp(r, x.dose); if (d > 0.005) c.compounds[x.kind] = (c.compounds[x.kind] ?? 0) + d; }
  for (const k of Object.keys(c)) if (typeof c[k] === 'number') c[k] = round3(c[k]);
  for (const k of Object.keys(c.access)) c.access[k] = round3(c.access[k]);
  for (const k of Object.keys(c.compounds)) c.compounds[k] = round3(c.compounds[k]);
  c.gather = S.gather;
  return c;
}

// ------------------------------------------------------------ 3. exposures
// exposure: { crush: 0–1 (pounding: breaks cells), grind: 0–1 (between stones), cut: 0–1 (chopping:
// smaller pieces, cells mostly intact), heat: { mode: 'roast' | 'boil', minutes }, water: { mode:
// 'still' | 'running', hours, tempC }, dry: hours }. `quality` (0–1) is the worker: even or uneven.
// `cond` is the gear and the setting: crushPower (pounding stone's hardness and weight, 0–1.2),
// rough (grinding stone's grit, 0–1), heatPower (how hot the fire or the basin gets, 0–1.2).
// Leaching speeds up about twofold per 10 °C (diffusion and solubility; Q10 ≈ 2).
export function expose(state, ex, quality = 0.8, cond = {}) {
  const s = cloneChem(state);
  const q = 0.6 + 0.4 * quality;
  let crushedThenReleased = false;
  const breakUp = (amount, rupture) => {
    const before = s.surface;
    s.surface = Math.min(1, s.surface + amount * q);
    const gain = s.surface - before;
    // breaking cells frees locked fat and protein; crushing disarms stinging hairs; cutting mostly doesn't
    s.access.fat += (1 - s.access.fat) * 0.6 * gain * rupture;
    s.access.protein += (1 - s.access.protein) * 0.3 * gain * rupture;
    s.access.starch += (1 - s.access.starch) * 0.15 * gain * rupture;
    for (const [k, d] of Object.entries(s.compounds)) if (COMPOUNDS[k].crush) s.compounds[k] = d * (1 - COMPOUNDS[k].crush * gain * rupture);
  };
  if (ex.cut) breakUp(ex.cut, 0.2);
  if (ex.crush) breakUp(ex.crush * (cond.crushPower ?? 1), 1);
  if (ex.grind) breakUp(ex.grind * (0.4 + 0.6 * (cond.rough ?? 0.6)), 1);
  if (ex.water) {
    const warm = Math.pow(2, ((ex.water.tempC ?? 10) - 10) / 10);
    const rate = (ex.water.mode === 'running' ? 0.25 : 0.1) * warm * (0.25 + 0.75 * s.surface); // per hour
    const f = 1 - Math.exp(-rate * ex.water.hours);
    for (const [k, d] of Object.entries(s.compounds)) s.compounds[k] = d * (1 - COMPOUNDS[k].water * f);
    s.sugar *= 1 - 0.5 * f; // sugars wash out too
    if (s.surface > 0.3) crushedThenReleased = true;
    s.water = Math.min(0.9, s.water + (0.9 - s.water) * 0.3 * f); // soaks some up
  }
  if (ex.heat) {
    const minutes = ex.heat.minutes * (cond.heatPower ?? 1);
    const t = 1 - Math.exp(-minutes / 15), wet = ex.heat.mode === 'boil';
    for (const [k, d] of Object.entries(s.compounds)) {
      const C = COMPOUNDS[k];
      const kill = C.heat * (C.wet && !wet ? 0.25 : 1) * (C.fast ? 1 - Math.exp(-minutes / 3) : t);
      const leach = wet ? C.water * 0.3 * t : 0;
      s.compounds[k] = d * (1 - kill) * (1 - leach);
    }
    // cooking gelatinises starch and loosens protein; boiling does it more evenly than roasting
    s.access.starch += (1 - s.access.starch) * (wet ? 0.85 : 0.7) * t * q;
    s.access.protein += (1 - s.access.protein) * 0.3 * t;
    if (!wet) s.water *= 1 - 0.15 * t;
    crushedThenReleased = crushedThenReleased || s.surface > 0.3;
  }
  if (ex.dry) {
    const f = 1 - Math.exp(-ex.dry / 12);
    s.water *= 1 - 0.8 * f;
    if (s.surface > 0.3) crushedThenReleased = true;
  }
  if (crushedThenReleased) for (const [k, d] of Object.entries(s.compounds)) if (COMPOUNDS[k].volatile) s.compounds[k] = d * (1 - COMPOUNDS[k].volatile * s.surface * 0.8);
  for (const k of Object.keys(s.compounds)) { s.compounds[k] = round3(s.compounds[k]); if (s.compounds[k] < 0.005) delete s.compounds[k]; }
  for (const k of Object.keys(s.access)) s.access[k] = round3(Math.min(1, s.access[k]));
  return s;
}

// The standard preparations, as exposures (also used to derive the raw/cooked/leached labels).
export const cloneChem = c => JSON.parse(JSON.stringify(c)); // plain data; works everywhere structuredClone doesn't
export const PREP = {
  raw: {},
  roast: { heat: { mode: 'roast', minutes: 15 } },
  boil: { heat: { mode: 'boil', minutes: 20 } },
  leachRoast: { crush: 0.5, water: { mode: 'running', hours: 12 }, heat: { mode: 'roast', minutes: 15 } },
  leachBoil: { crush: 0.5, water: { mode: 'running', hours: 12 }, heat: { mode: 'boil', minutes: 20 } },
};

// How harmful a state is, on the old 0–1 toxin scale (so hazard words keep their meaning).
export const harm = s => Object.entries(s.compounds).filter(([k]) => COMPOUNDS[k].effect !== 'parasite').reduce((a, [k, d]) => a + d * COMPOUNDS[k].potency, 0);

// ------------------------------------------------------------ digestion
// Energy of `mass` kg of a food in its current state. Tannins bind protein and blunt digestion.
export function nutrients(s, mass) {
  const binder = Math.min(0.7, (s.compounds.tannin ?? 0) * 0.6);
  const g = 1000 * mass;
  const carb = g * (s.starch * 4 * s.access.starch * (1 - 0.2 * binder) + s.sugar * 4);
  const fat = g * s.fat * 9 * s.access.fat;
  const protein = g * s.protein * 4 * s.access.protein * (1 - binder);
  const fibreCost = g * s.fibre * 0.6; // chewing and moving bulk through
  const cost = 0.25 * protein + 0.07 * carb + 0.02 * fat + fibreCost;
  return { carb, fat, protein, absorbed: carb + fat + protein, cost, net: carb + fat + protein - cost, gross: g * (4 * (s.starch + s.sugar + s.protein) + 9 * s.fat) };
}

// ------------------------------------------------------------ what the senses report
const strength = d => (d > 0.6 ? 'strongly ' : d > 0.25 ? '' : 'faintly ');
export function tasteWords(s) {
  const t = Object.entries(s.compounds).filter(([k, d]) => COMPOUNDS[k].taste && d > 0.06).sort((a, b) => b[1] * COMPOUNDS[b[0]].potency - a[1] * COMPOUNDS[a[0]].potency);
  const base = s.sugar > 0.05 ? 'sweet' : s.fat > 0.2 ? 'rich, oily' : s.starch > 0.1 ? 'bland and starchy' : s.protein > 0.1 ? 'savoury' : 'mild, green';
  return t.length ? `${base}, but ${t.slice(0, 2).map(([k, d]) => `${strength(d)}${COMPOUNDS[k].taste}`).join(' and ')}` : `${base}; nothing alarming`;
}
export function smellWords(s) {
  const t = Object.entries(s.compounds).filter(([k, d]) => COMPOUNDS[k].smell && d > 0.05);
  return t.length ? t.map(([k, d]) => `${strength(d)}of ${COMPOUNDS[k].smell}`).join('; ') : 'nothing much';
}
export function textureWords(s) {
  if (s.hard && s.surface < 0.3) return s.starch > 0.1 && s.access.starch < 0.5 ? 'hard and gritty; heavy going' : 'hard; takes a lot of chewing';
  if (s.fat > 0.2 && s.surface > 0.4) return 'an oily, crumbly paste';
  if (s.starch > 0.1) return s.access.starch > 0.7 ? 'soft and mealy' : s.surface > 0.6 ? 'a coarse, pasty meal' : 'firm and starchy';
  if (s.fibre > 0.15) return 'stringy and fibrous';
  if (s.protein > 0.1) return 'chewy';
  return s.water > 0.8 ? 'juicy' : 'tender';
}

// Rounded, readable dump of a state (for the "exact properties" view).
export function describeState(s, mass) {
  const pct = x => `${Math.round(x * 100)}%`;
  const n = mass ? nutrients(s, mass) : null;
  return [
    `make-up: water ${pct(s.water)}, starch ${pct(s.starch)}, sugar ${pct(s.sugar)}, fat ${pct(s.fat)}, protein ${pct(s.protein)}, fibre ${pct(s.fibre)}`,
    `absorbable now: starch ${pct(s.access.starch)}, fat ${pct(s.access.fat)}, protein ${pct(s.access.protein)}; surface ${pct(s.surface)}`,
    `compounds: ${Object.keys(s.compounds).length ? Object.entries(s.compounds).map(([k, d]) => `${k} ${d.toFixed(2)}`).join(', ') : 'none'} (harm ${harm(s).toFixed(2)})`,
    ...(n ? [`${mass.toFixed(2)} kg: gross ${Math.round(n.gross)} kcal; absorbed ${Math.round(n.absorbed)} (carb ${Math.round(n.carb)}, fat ${Math.round(n.fat)}, protein ${Math.round(n.protein)}); digesting costs ${Math.round(n.cost)}; net ${Math.round(n.net)} kcal`] : []),
  ];
}
