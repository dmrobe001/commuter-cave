// craft.js — prototype of product-quality propagation, on the fire chain.
//
//   Items carry properties. Tools fill roles by having the right properties.
//   A process attempt computes a latent performance score
//       z = Σ w·log(role suitability) + k_skill·skill_eff + k_effort·log(time/median) + sd(skill)·ε
//   succeeds if z clears a threshold, and sets workmanship from the margin.
//   Skill raises the mean, narrows the noise, and widens suitability tolerance.
//   Body state (fatigue, hand damage, focus) lowers effective skill.
//   Processes mutate their inputs: edges dull by Archard's wear law, hearths burn
//   through, spindles shorten, green wood dries toward ambient humidity.
//   Every product records provenance, so outcomes can be attributed to sources.

import { makeRng, clamp } from './rng.js';
import { samplePatch } from './generator.js';
import { materialsOf } from './process.js';

// ------------------------------------------------------------ property registry

// `observe` says how the character can learn a value: this doubles as the observation model.
export const PROPERTIES = {
  sharpness:    { scale: '0–1', observe: ['use', 'inspect'], note: 'falls with use (Archard wear); retouching restores it but spends mass' },
  hardness:     { scale: 'Mohs 1–10', observe: ['test: scratch'], note: 'resists wear; wood ≈ 1 + 3·density' },
  mass:         { scale: 'g', observe: ['heft'], note: 'remaining material; a tool is exhausted when too little is left' },
  fracture:     { scale: '0–1', observe: ['test: test break'], note: 'how cleanly stone breaks' },
  flaws:        { scale: '0–1', observe: ['test: ring test'], note: 'share of pieces with hidden cracks' },
  density:      { scale: '0–1', observe: ['test: heft', 'test: thumbnail'], note: 'soft wood makes embers easily but burns through fast' },
  resin:        { scale: '0–1', observe: ['test: crush and smell'], note: 'resin glazes a hearth' },
  moisture:     { scale: '0–1', observe: ['test: snap'], note: 'relaxes toward ambient humidity over days', dynamics: true },
  straightness: { scale: '0–1', observe: ['glance'], note: 'wobbling spindles waste effort' },
  length:       { scale: 'cm', observe: ['glance'], note: 'spindles shorten with use' },
  notch:        { scale: '0–1', observe: ['inspect'], note: 'workmanship: how well the hearth notch is cut' },
  life:         { scale: '0–1', observe: ['inspect'], note: 'how much of a hearth board is left to drill' },
  socket:       { scale: '0–1', observe: ['use'], note: 'how well the drilling socket is burned in; a seated spindle runs truer and builds heat faster' },
  fineness:     { scale: '0–1', observe: ['inspect'], note: 'workmanship: how finely tinder is shredded' },
  vigor:        { scale: '0–1', observe: ['glance'], note: 'how strong an ember is' },
};

// ------------------------------------------------------------ roles: suitability over properties

// 1 inside the ideal range, smooth fall-off outside it. Skill widens the tolerance.
const bump = (x, lo, hi, tol) => (x < lo ? Math.exp(-(((lo - x) / tol) ** 2)) : x > hi ? Math.exp(-(((x - hi) / tol) ** 2)) : 1);
const widen = (tol, sk) => tol * (1 + 0.6 * sk);

export const ROLES = {
  cutter:    (p, sk) => bump(p.sharpness, 0.6, 1, widen(0.2, sk)) * bump(p.hardness, 5.5, 10, widen(1.5, sk)),
  pounder:   (p) => bump(p.hardness, 5.5, 10, 1.5) * bump(p.mass, 300, 1500, 250),
  anvil:     (p) => bump(p.mass, 2000, 1e5, 800),
  knapStone: (p, sk) => bump(p.fracture, 0.75, 1, widen(0.25, sk)) * bump(p.flaws, 0, 0.12, widen(0.25, sk)),
  hearth:    (p, sk) => bump(p.density, 0.22, 0.4, widen(0.25, sk)) * bump(p.moisture, 0, 0.13, widen(0.08, sk)) * bump(p.resin, 0, 0.3, widen(0.25, sk)),
  spindle:   (p, sk) => bump(p.straightness, 0.85, 1, widen(0.15, sk)) * bump(p.moisture, 0, 0.13, widen(0.08, sk)) * bump(p.length, 45, 90, widen(12, sk)),
  tinder:    (p, sk) => bump(p.moisture, 0, 0.1, widen(0.07, sk)) * bump(p.fineness, 0.6, 1, widen(0.25, sk)),
};

// ------------------------------------------------------------ the character

export function newCharacter(skills = {}) {
  return { skills: { knapping: 0.05, woodwork: 0.1, firecraft: 0.05, ...skills }, fatigue: 0, hands: 0, callus: 0, focus: 1, peakHands: 0, outcomes: {}, attempts: 0 };
}
function effSkill(ch, skill, handLoad) {
  return ch.skills[skill] * (1 - 0.6 * ch.fatigue) * (1 - 0.7 * ch.hands * clamp(handLoad / 3)) * (0.5 + 0.5 * ch.focus);
}
function work(ch, hours, handLoad, kcal) {
  ch.fatigue = clamp(ch.fatigue + hours * kcal / 2000);
  ch.hands = clamp(ch.hands + hours * handLoad * 0.09 * (1 - 0.75 * ch.callus));
  ch.callus = clamp(ch.callus + hours * handLoad * 0.006);
  ch.focus = clamp(ch.focus - hours * 0.06);
  ch.peakHands = Math.max(ch.peakHands, ch.hands);
}
export function rest(ch) {
  ch.fatigue *= 0.15;
  ch.hands *= 0.55; // overnight healing
  ch.callus *= 0.995;
  ch.focus = 1;
}

// ------------------------------------------------------------ generic attempt

function normCdf(x) { // Abramowitz–Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// spec: { skill, kSkill, theta, kEffort, median, learn, handLoad, kcal }
// terms: [[weight, suitability], ...]
function attempt(r, ch, spec, terms, hours = spec.median) {
  const se = effSkill(ch, spec.skill, spec.handLoad);
  const mean = terms.reduce((s, [w, x]) => s + w * Math.log(Math.max(x, 1e-3)), 0) + spec.kSkill * se + spec.kEffort * Math.log(hours / spec.median);
  const sd = 1 - 0.7 * ch.skills[spec.skill]; // experts are more consistent
  const z = mean + sd * r.normal();
  const p = 1 - normCdf((spec.theta - mean) / sd);
  // Learning peaks when success is uncertain: p(1 − p).
  ch.skills[spec.skill] = clamp(ch.skills[spec.skill] + spec.learn * p * (1 - p) * (1 - ch.skills[spec.skill]));
  work(ch, hours, spec.handLoad, spec.kcal);
  ch.attempts++;
  return { success: z > spec.theta, margin: z - spec.theta, p };
}
const workmanship = margin => clamp(1 / (1 + Math.exp(-1.5 * margin)));

// Archard: wear ∝ load × distance / hardness. Dulling per hour ∝ (worked hardness / tool hardness)².
function dull(tool, hours, workedHardness, k = 1.2) {
  tool.props.sharpness = clamp(tool.props.sharpness - k * hours * (workedHardness / tool.props.hardness) ** 2);
}
function retouch(tool) {
  if (tool.name !== 'flake') { tool.props.mass = 0; return false; } // natural edges and bone splinters are just discarded
  tool.props.sharpness = clamp(0.5 + 0.35 * tool.props.fracture);
  tool.props.mass -= 1.5;
  tool.retouched = (tool.retouched ?? 0) + 1;
  return tool.props.mass > 3;
}
const woodHardness = density => 1 + 3 * density;

// Moisture relaxes toward ambient: about a third of the gap per day for split, cut wood.
export function dry(item, days, ambient) {
  item.props.moisture = ambient + (item.props.moisture - ambient) * Math.exp(-0.4 * days);
}

// ------------------------------------------------------------ processes (fire chain)

let nextId = 1;
const item = (name, props, provenance) => ({ id: nextId++, name, props, provenance });

export function knapFlakes(r, ch, stone, hammer, anvil) {
  // Bipolar flaking is forgiving: low threshold, and near misses still yield a flake.
  const res = attempt(r, ch, { skill: 'knapping', kSkill: 3, theta: -0.5, kEffort: 0.5, median: 0.25, learn: 0.08, handLoad: 1.5, kcal: 200 },
    [[1, ROLES.knapStone(stone.props, ch.skills.knapping)], [0.5, ROLES.pounder(hammer.props)], [0.3, ROLES.anvil(anvil.props)]]);
  const n = res.success ? Math.min(4, 1 + Math.floor(res.margin * 2)) : res.margin > -1.2 ? 1 : 0;
  const flakes = [];
  for (let i = 0; i < n; i++) {
    flakes.push(item('flake', {
      sharpness: clamp(0.55 + 0.3 * stone.props.fracture + 0.08 * res.margin + r.normal(0, 0.05)),
      hardness: stone.props.hardness, fracture: stone.props.fracture, mass: Math.round(r.uniform(5, 20)),
    }, stone.provenance));
  }
  return { ...res, flakes };
}

const NOTCH = { skill: 'woodwork', kSkill: 2.5, theta: -0.4, kEffort: 0.6, median: 0.4, learn: 0.06, handLoad: 1, kcal: 160 };
// hours is a choice: slower work scores higher (k_effort · log(hours / median)), but wears the edge longer.
export function notchHearth(r, ch, wood, cutter, hours = NOTCH.median) {
  const res = attempt(r, ch, NOTCH, [[1, ROLES.cutter(cutter.props, ch.skills.woodwork)]], hours);
  dull(cutter, hours, woodHardness(wood.props.density));
  // Even a crude groove gathers some dust: notch quality has a floor.
  const board = item('hearth board', { density: wood.props.density, resin: wood.props.resin, moisture: wood.props.moisture, notch: 0.15 + 0.85 * workmanship(res.margin + 0.5), life: 1, socket: 0 }, wood.provenance);
  return { ...res, board };
}
// Touch up an existing notch: each pass moves it part of the way toward ideal, so several slow
// passes with a poor edge add up. A bad slip can make it slightly worse.
export function refineNotch(r, ch, board, cutter, hours = 0.6) {
  const res = attempt(r, ch, NOTCH, [[1, ROLES.cutter(cutter.props, ch.skills.woodwork)]], hours);
  dull(cutter, hours, woodHardness(board.props.density));
  const before = board.props.notch;
  if (res.margin < -1.5) board.props.notch = Math.max(0.15, before - 0.05); // same floor as a fresh notch
  else board.props.notch = clamp(before + (1 - before) * 0.5 * workmanship(res.margin));
  return { ...res, before, after: board.props.notch };
}

export function carveSpindle(r, ch, shoot, cutter) {
  const res = attempt(r, ch, { skill: 'woodwork', kSkill: 2.5, theta: -0.4, kEffort: 0.6, median: 0.5, learn: 0.06, handLoad: 1, kcal: 160 },
    [[1, ROLES.cutter(cutter.props, ch.skills.woodwork)]]);
  dull(cutter, 0.5, woodHardness(shoot.props.density));
  const spindle = item('spindle', {
    density: shoot.props.density, moisture: shoot.props.moisture, length: 70,
    // A poor tool leaves the shaft rough, but it can't bend a straight shoot: small effect on straightness.
    straightness: clamp(shoot.props.straightness * (0.93 + 0.07 * workmanship(res.margin))),
  }, shoot.provenance);
  return { ...res, spindle };
}

export function makeTinder(r, ch, material) {
  const res = attempt(r, ch, { skill: 'firecraft', kSkill: 2, theta: -0.8, kEffort: 0.5, median: 0.2, learn: 0.04, handLoad: 0.5, kcal: 140 }, []);
  return { ...res, tinder: item('tinder bundle', { moisture: material.props.moisture, fineness: clamp(0.45 + 0.4 * workmanship(res.margin)) }, material.provenance) };
}

// Calibrated against anchor cases (per attempt, fresh and rested, good spindle):
// novice + ideal hearth ≈ 10%, novice + marginal ≈ 1%, expert + marginal ≈ 40%, expert + ideal ≈ 85%.
export const HAND_DRILL = { skill: 'firecraft', kSkill: 1.89, theta: 1.2, kEffort: 0.5, median: 0.25, learn: 0.08, handLoad: 3, kcal: 400 };
export function handDrill(r, ch, board, spindle) {
  const sk = ch.skills.firecraft;
  // An unseated socket costs about a third of the odds at first; each attempt burns it in further.
  const res = attempt(r, ch, HAND_DRILL, [[1, ROLES.hearth(board.props, sk)], [1, ROLES.spindle(spindle.props, sk)], [0.6, board.props.notch], [0.4, 0.4 + 0.6 * board.props.socket]]);
  board.props.socket = clamp(board.props.socket + (1 - board.props.socket) * 0.3);
  board.props.life = clamp(board.props.life - (0.05 + 0.1 * (0.45 - board.props.density))); // soft boards burn through faster
  spindle.props.length -= 1.5;
  const key = `hearth: ${board.provenance.name}`;
  const o = (ch.outcomes[key] ??= { tries: 0, embers: 0 });
  o.tries++;
  if (res.success) o.embers++;
  return { ...res, ember: res.success ? item('ember', { vigor: workmanship(res.margin) }, board.provenance) : null };
}

// Searching scree and outcrops for a naturally sharp piece: no skill, just looking.
export function searchNaturalEdge(r, ch, src) {
  work(ch, 0.5, 0.2, 180);
  ch.attempts++;
  const found = r.chance(clamp(0.25 + 0.6 * src.props.rate) * (0.7 + 0.3 * ch.focus));
  if (!found) return { flake: null };
  return { flake: item('natural edge', { sharpness: clamp(src.props.sharpness + r.normal(0, 0.12)), hardness: src.props.hardness, fracture: 0.2, mass: Math.round(r.uniform(10, 40)) }, src.provenance) };
}
export function splinterBone(r, ch, bone, hammer) {
  const res = attempt(r, ch, { skill: 'knapping', kSkill: 1.5, theta: -0.8, kEffort: 0.3, median: 0.2, learn: 0.04, handLoad: 0.5, kcal: 160 }, [[0.5, ROLES.pounder(hammer.props)]]);
  const n = res.success ? 1 + (res.margin > 0.5 ? 1 : 0) : 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push(item('bone splinter', { sharpness: clamp(0.6 + r.normal(0, 0.12)), hardness: 3, fracture: 0.3, mass: Math.round(r.uniform(4, 12)) }, bone.provenance));
  return { ...res, flakes: out };
}

export function lightFire(r, ch, ember, tinder) {
  const res = attempt(r, ch, { skill: 'firecraft', kSkill: 1.5, theta: -0.6, kEffort: 0.3, median: 0.15, learn: 0.05, handLoad: 0.3, kcal: 180 },
    [[1, ROLES.tinder(tinder.props, ch.skills.firecraft)], [0.8, ember.props.vigor]]);
  return res;
}

// ------------------------------------------------------------ narration of outcomes (the character's impressions)

function drillLine(res) {
  if (res.success) return 'smoke thickened, a mound of dark dust, and it glowed: an ember';
  if (res.margin > -0.6) return 'thick smoke and dark dust, but it died';
  if (res.margin > -1.6) return 'some smoke; the dust stayed coarse and pale';
  return 'barely warm; the spindle just polishes the socket';
}

// ------------------------------------------------------------ scenario: from bare hands to a fire

// Pick concrete materials from the world for a scenario: 'best' or 'marginal' hearth wood.
function pickMaterials(world, hearthChoice, ambient) {
  const mats = materialsOf(world);
  const site = 'camp';
  const withPatch = m => {
    const e = [...world.plants, ...world.stones].find(x => x.id === m.source);
    const vary = e?.varying?.find(v => v.id === 'woodDensity');
    const density = vary ? samplePatch(world, e.id, site, e.habitats[0].micro).traits.woodDensity : m.props.density;
    return { ...m, props: { ...m.props, density } };
  };
  const stones = mats.filter(m => m.material === 'stone');
  const knap = [...stones].sort((a, b) => b.props.fracture * (1 - b.props.flaws) - a.props.fracture * (1 - a.props.flaws))[0];
  const natural = mats.filter(m => m.material === 'natural-edge').sort((a, b) => b.props.rate * b.props.sharpness - a.props.rate * a.props.sharpness)[0];
  const boneSrc = mats.find(m => m.material === 'bone');
  const hammer = stones.filter(s => s.props.hardness >= 5.5).sort((a, b) => b.props.hardness - a.props.hardness)[0] ?? stones[0];
  const anvil = stones.find(s => s.props.slab) ?? stones[0];
  const dead = mats.filter(m => m.material === 'dead-wood').map(withPatch).filter(m => m.props.resin < 0.5);
  dead.sort((a, b) => Math.abs(a.props.density - 0.3) - Math.abs(b.props.density - 0.3));
  const usable = dead.filter(d => d.props.density >= 0.15 && d.props.density <= 0.55);
  const hearth = hearthChoice === 'best' ? dead[0] : (usable.length ? usable[usable.length - 1] : dead[dead.length - 1]);
  const stalk = mats.find(m => m.material === 'dead-stalk');
  const shoots = mats.filter(m => m.material === 'live-wood' && m.props.straight).map(withPatch);
  const deadShrub = mats.filter(m => m.material === 'dead-wood' && world.plants.find(p => p.id === m.source)?.form === 'shrub').map(withPatch)[0];
  const tinderMat = mats.find(m => m.material === 'dry-grass') ?? mats.find(m => m.material === 'fluff') ?? mats.find(m => m.material === 'fungus-tinder' || m.material === 'lichen-tinder') ?? mats.find(m => m.material === 'outer-bark' && m.props.papery);
  if (!stones.length || !hearth || !(stalk || shoots.length) || !tinderMat) return null;
  const prov = m => ({ name: `${m.sourceName} (${m.part})`, source: m.source, part: m.part, site });
  return {
    stone: item('stone', { fracture: knap.props.fracture, flaws: knap.props.flaws, hardness: knap.props.hardness }, prov(knap)),
    natural: natural ? { props: natural.props, provenance: prov(natural) } : null,
    bone: boneSrc ? item('bone', { hardness: 3 }, prov(boneSrc)) : null,
    hammer: item('hammerstone', { hardness: hammer.props.hardness, mass: 700 }, prov(hammer)),
    anvil: item('anvil', { mass: 6000 }, prov(anvil)),
    hearthWood: item('dead wood', { density: hearth.props.density, resin: hearth.props.resin, moisture: ambient + 0.08 }, prov(hearth)),
    spindleStock: stalk
      ? item('dead stalk', { density: 0.3, moisture: ambient, straightness: 0.95 }, prov(stalk))
      : item('green shoot', { density: shoots[0].props.density, moisture: 0.55, straightness: 0.9 }, prov(shoots[0])),
    seasonedStock: !stalk && deadShrub ? item('dead shoot', { density: deadShrub.props.density, moisture: ambient + 0.02, straightness: 0.72 }, { ...prov(deadShrub), name: `${deadShrub.sourceName} (dead shoots)` }) : null,
    tinderMat: item('tinder material', { moisture: ambient * 0.6 }, prov(tinderMat)),
    hearthCandidates: dead.map(d => `${d.sourceName} ${d.props.density.toFixed(2)}`),
  };
}

export function fireQuest(world, { skills = {}, hearthChoice = 'best', maxDays = 21, label = 'run', careful = true } = {}) {
  nextId = 1;
  const r = makeRng(`${world.seed}/craft/${label}`);
  // Equilibrium moisture of seasoned wood: about 0.11 in a temperate woodland, over 0.2 in a rainforest.
  const ambient = clamp(0.05 + 0.07 * world.environment.water, 0.05, 0.35);
  const ch = newCharacter(skills);
  const log = [];
  const m = pickMaterials(world, hearthChoice, ambient);
  if (!m) return { log: ['This world lacks something essential for the fire chain.'], ch };
  const say = (day, s) => log.push(`Day ${day}: ${s}`);

  // Day 1: edges, a hearth board, spindles, tinder.
  let flakes = [];
  const edgeLog = [];
  let knapFutile = false; // learned from experience: this stone doesn't flake
  const getEdges = (want) => {
    let k = 0, got = 0;
    while (!knapFutile && got < want && k < 8) { const f = knapFlakes(r, ch, m.stone, m.hammer, m.anvil).flakes; flakes.push(...f); got += f.length; k++; }
    if (k) edgeLog.push(`${k} rounds smashing ${m.stone.provenance.name}: ${got} flakes`);
    if (k >= 8 && got === 0) knapFutile = true;
    if (got < want && m.natural) {
      let j = 0, g2 = 0;
      while (got < want && j < 6) { const f = searchNaturalEdge(r, ch, m.natural).flake; if (f) { flakes.push(f); got++; g2++; } j++; }
      edgeLog.push(`${(j * 0.5).toFixed(1)} h searching ${m.natural.provenance.name}: ${g2} sharp pieces`);
    }
    if (got < want && m.bone) {
      let j = 0, g3 = 0;
      while (got < want && j < 4) { const f = splinterBone(r, ch, m.bone, m.hammer).flakes; flakes.push(...f); got += f.length; g3 += f.length; j++; }
      edgeLog.push(`smashed bones from ${m.bone.provenance.name}: ${g3} splinters`);
    }
    return got;
  };
  getEdges(4);
  say(1, `${edgeLog.join('; ')}${flakes.length ? ` (best edge ${Math.max(...flakes.map(f => f.props.sharpness)).toFixed(2)})` : ''}.`);
  if (!flakes.length) return { log, ch, m };
  // Edge policy: use the sharpest edge. If it's dull, retouch it (knapped flakes only) or go and get a
  // fresh one; fall back to the dull edge only if nothing better turns up. A dull edge beats no edge.
  const cutter = () => {
    const best = () => flakes.sort((a, b) => b.props.sharpness - a.props.sharpness)[0] ?? null;
    if (!flakes.length) { edgeLog.length = 0; getEdges(2); if (flakes.length) say(day, `needed new edges: ${edgeLog.join('; ')}.`); }
    let f = best();
    if (!f || ROLES.cutter(f.props, ch.skills.woodwork) >= 0.5) return f;
    if (f.name === 'flake') {
      const alive = retouch(f);
      say(day, `retouched a dull flake (now ${f.props.sharpness.toFixed(2)}, ${f.props.mass} g left)${alive ? '' : '; it is used up'}.`);
      if (!alive) flakes = flakes.filter(x => x !== f);
      return best() ?? cutter();
    }
    edgeLog.length = 0;
    const n0 = flakes.length;
    getEdges(1);
    if (flakes.length > n0) {
      flakes = flakes.filter(x => x !== f);
      say(day, `edge too dull; went looking and found a fresh one (${edgeLog.join('; ')}).`);
    }
    return best();
  };
  let day = 1;
  // Policy: with a poor edge, work slowly, then touch up the notch until it's decent.
  const makeBoard = (d, moisture) => {
    const c = cutter();
    if (!c) return null;
    const slow = careful && ROLES.cutter(c.props, ch.skills.woodwork) < 0.6;
    const b = notchHearth(r, ch, { ...m.hearthWood, props: { ...m.hearthWood.props, moisture } }, c, slow ? 1.0 : NOTCH.median).board;
    const first = b.props.notch;
    let passes = 0;
    while (careful && b.props.notch < 0.65 && passes < 3) {
      const c2 = cutter();
      if (!c2 || ROLES.cutter(c2.props, ch.skills.woodwork) < 0.2) break; // too dull to cut cleanly
      const rr = refineNotch(r, ch, b, c2);
      passes++;
      if (rr.after < rr.before) break; // a slip: stop before making it worse
    }
    say(d, `${slow ? 'slowly, with a poor edge, ' : ''}notched a hearth board from ${b.provenance.name} (density ${b.props.density.toFixed(2)}, notch ${first.toFixed(2)}${passes ? `, touched up ${passes}× to ${b.props.notch.toFixed(2)}` : ''}).`);
    return b;
  };
  let board = makeBoard(1, m.hearthWood.props.moisture);
  if (!board) { say(1, 'no edge sharp enough to notch a hearth board.'); return { log, ch, m }; }
  const spindles = [];   // ready to use
  const drying = [];     // green, seasoning
  const carve = (stock, k) => {
    for (let i = 0; i < k; i++) {
      const c = stock.name === 'dead stalk' ? { props: { sharpness: 0.8, hardness: 7 } } : cutter(); // stalks are trimmed by hand
      if (c) (stock.name === 'green shoot' ? drying : spindles).push(carveSpindle(r, ch, { ...stock, props: { ...stock.props } }, c).spindle);
    }
  };
  carve(m.spindleStock, 2);
  if (m.seasonedStock) carve(m.seasonedStock, 2);
  say(1, `${m.spindleStock.name === 'green shoot' ? 'carved two straight spindles from green shoots to season' : 'trimmed two spindles from dead stalks'}${m.seasonedStock ? `, and two crooked but dry ones from ${m.seasonedStock.provenance.name}` : ''}. ${flakes[0] ? `Working edge now ${flakes[0].props.sharpness.toFixed(2)}.` : "No usable edge left."}`);
  let tinder = makeTinder(r, ch, m.tinderMat).tinder;
  rest(ch);

  let fire = false;
  let spindle = null;
  const nextSpindle = () => {
    // Prefer the best-suited ready spindle; seasoned green ones join when dry enough.
    for (const g of [...drying]) if (g.props.moisture <= ambient + 0.03) { spindles.push(g); drying.splice(drying.indexOf(g), 1); }
    spindles.sort((a, b) => ROLES.spindle(b.props, ch.skills.firecraft) - ROLES.spindle(a.props, ch.skills.firecraft));
    return spindles.shift() ?? null;
  };
  for (day = 2; day <= maxDays && !fire; day++) {
    for (const s of [...spindles, ...drying, ...(spindle ? [spindle] : [])]) dry(s, 1, ambient);
    dry(board, 1, ambient);
    if (spindles.length + drying.length < 2) { carve(m.spindleStock, 2); say(day, m.spindleStock.name === 'green shoot' ? 'carved two more green spindles to season.' : 'trimmed two more spindles from dead stalks.'); }
    if (!spindle || drying.some(g => g.props.moisture <= ambient + 0.03)) {
      if (spindle) spindles.push(spindle);
      spindle = nextSpindle();
      if (spindle && spindle.provenance.name.includes('green') === false && spindle.props.straightness > 0.85 && day > 2) say(day, 'the green spindles have seasoned; switched to a straight one.');
    }
    if (!spindle) { say(day, 'no dry spindle yet; gathered food and waited.'); rest(ch); continue; }
    const tally = {};
    let n = 0, stopReason = 'out of daylight';
    while (n < 16) {
      if (ch.hands > 0.85) { stopReason = 'blisters opened; had to stop'; break; }
      if (ch.fatigue > 0.85) { stopReason = 'too tired to keep going'; break; }
      if (board.props.life <= 0.05) {
        say(day, 'hearth board burned through.');
        const nb = makeBoard(day, board.props.moisture);
        if (!nb) { stopReason = 'no usable edge left to notch a new board'; break; }
        board = nb;
      }
      if (spindle.props.length < 40) {
        spindle = nextSpindle();
        if (!spindle) { stopReason = 'spindles worn too short; new ones are seasoning'; break; }
      }
      const res = handDrill(r, ch, board, spindle);
      n++;
      const line = drillLine(res);
      tally[line] = (tally[line] ?? 0) + 1;
      if (res.ember) {
        const lit = lightFire(r, ch, res.ember, tinder);
        if (lit.success) { fire = true; stopReason = 'FIRE'; break; }
        tally['ember died in the tinder bundle'] = (tally['ember died in the tinder bundle'] ?? 0) + 1;
        tinder = makeTinder(r, ch, m.tinderMat).tinder;
      }
    }
    const summary = Object.entries(tally).map(([k, v]) => `${v}× ${k}`).join('; ');
    say(day, `${n} hand-drill attempts (${summary}). ${stopReason === 'FIRE' ? 'Blew the ember into flame: FIRE.' : `Stopped: ${stopReason}.`} Hands ${ch.hands.toFixed(2)}, firecraft ${ch.skills.firecraft.toFixed(2)}.`);
    rest(ch);
  }
  return { log, ch, fire, day: fire ? day - 1 : null, m, flakes };
}

// ------------------------------------------------------------ closed-form estimate (no simulation)

// Approximates the novice fire timeline from the same model:
//   per-attempt success from the normal CDF; attempts per day from the hand-damage budget;
//   spindle seasoning time from the drying curve; then a day-by-day survival product.
// Ignores learning (small for novices over these timescales) and fatigue.
// `efficiency` (fitted against simulations) absorbs frictions the estimate ignores:
// a damp first board, fatigue, embers dying in tinder, time spent re-knapping.
// ambient: how damp wood left out gets (0–1); by default the climate's usual, all year.
export function estimateFire(world, { skill = 0.06, hearthChoice = 'best', maxDays = 30, efficiency = 0.5, ambient: amb = null } = {}) {
  const ambient = amb ?? clamp(0.05 + 0.07 * world.environment.water, 0.05, 0.35);
  const m = pickMaterials(world, hearthChoice, ambient);
  if (!m) return { blocked: 'a fire-chain material is missing entirely' };
  // Gate: can a novice get a cutting edge at all? (one bipolar round yields a flake if z > −1.2)
  const knapMean = Math.log(Math.max(ROLES.knapStone(m.stone.props, skill), 1e-3)) + 3 * skill;
  const pFlake = 1 - normCdf((-1.7 - knapMean) / (1 - 0.7 * skill));
  const edgeSource = pFlake >= 0.05 ? 'knapping' : m.natural ? 'naturally sharp stone' : m.bone ? 'bone splinters' : null;
  if (!edgeSource) return { blocked: `no way to get a cutting edge (stone doesn't flake, no sharp scree, no bones)`, pFlake };
  const knapOK = (() => { const km = Math.log(Math.max(ROLES.knapStone(m.stone.props, skill), 1e-3)) + 3 * skill; return 1 - normCdf((-1.7 - km) / (1 - 0.7 * skill)) >= 0.05; })();
  const board = { density: m.hearthWood.props.density, resin: m.hearthWood.props.resin, moisture: ambient, notch: knapOK ? 0.8 : 0.45 }; // poor edges cut poor notches
  const pAttempt = spindle => {
    const mean = Math.log(Math.max(ROLES.hearth(board, skill), 1e-3)) + Math.log(Math.max(ROLES.spindle(spindle, skill), 1e-3))
      + 0.6 * Math.log(board.notch) + HAND_DRILL.kSkill * skill;
    return 1 - normCdf((HAND_DRILL.theta - mean) / (1 - 0.7 * skill));
  };
  const pLight = 0.85;
  const ready = m.spindleStock.name === 'green shoot'
    ? Math.log((0.55 - ambient) / 0.03) / 0.4 + 1  // days until the green spindle is dry enough
    : 1;
  const late0 = pAttempt({ straightness: m.spindleStock.props.straightness, moisture: m.spindleStock.name === 'green shoot' ? ambient + 0.02 : m.spindleStock.props.moisture, length: 70 });
  const early = m.spindleStock.name !== 'green shoot' ? late0 : m.seasonedStock ? pAttempt({ ...m.seasonedStock.props, length: 70 }) : 0;
  const late = pAttempt({ straightness: m.spindleStock.props.straightness, moisture: ambient + 0.02, length: 70 });
  const perAttempt = 0.25 * HAND_DRILL.handLoad * 0.09 * 0.85; // hand damage per attempt, light calluses
  const attemptsFirst = Math.floor(0.85 / perAttempt), attemptsLater = Math.floor((0.85 - 0.55 * 0.85) / perAttempt);
  let survive = 1, median = null;
  const curve = [];
  for (let day = 2; day <= maxDays; day++) {
    const p = (day >= ready ? late : early) * pLight * efficiency;
    const n = day === 2 ? attemptsFirst : attemptsLater;
    survive *= (1 - p) ** n;
    curve.push(1 - survive);
    if (median === null && survive <= 0.5) median = day;
  }
  return { median, pFlake, edgeSource, pFireBy: d => curve[d - 2] ?? 1, early, late, ready: Math.ceil(ready), ambient, hearth: m.hearthWood, spindle: m.seasonedStock ? 'crooked dead shoots, then seasoned green' : m.spindleStock.name };
}
