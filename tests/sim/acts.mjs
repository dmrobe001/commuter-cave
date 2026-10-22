// The processes (acts.js), run headless against a small hand-made state: every one keeps to its
// contract (reads and writes only what it declares), and each does what it says.
// Checks:
// - drinking fills me up, and bad water sometimes leaves sickness brewing, good water seldom;
// - washing my hands cleans them toward the water's own germ load;
// - a bed of leaves goes down; a hut goes up, with its milestone once;
// - knapping makes flakes from a clean-breaking stone more often than from a poor one, and wears me;
// - every way of preparing food changes the food and names it;
// - eating fills the gut and feeds me, and is refused when I'm full;
// - a survey finds things that live here, and the same site always holds the same;
// - an hour asleep at -5 °C chills me and at 25 °C doesn't;
// - the crafts: a notched board, a carved spindle, a trimmed one, a digging stick, a hardened point, a
//   basin, a washed thing, a tinder bundle, bone splinters, each from its inputs; edges dull;
// - drilling burns the board and shortens the spindle, an ember comes now and then, and is refused
//   with raw palms; an ember with tinder and wood can light a fire; handling mixes germs and heat
//   kills them; resting eases tiredness;
// - a walking step: run again with other dice from where it began, it goes to a neighbouring cell,
//   the one taken among them; how often the step taken was the likely one, and a walk's surprisal;
// - every tick runs on its own;
// - a process that reads or writes past its contract is stopped.
// Usage: node tests/sim/acts.mjs
import { generateWorld } from '../../src/generator.js';
import { makeRng } from '../../src/rng.js';
import { newCharacter } from '../../src/craft.js';
import { newMemory } from '../../src/notes.js';
import { siteFactors } from '../../src/variation.js';
import { skyAt } from '../../src/sky.js';
import { groundAt } from '../../src/ground.js';
import { SHELTERS } from '../../src/body.js';
import { viewOf, rehearse, apply, stateOver } from '../../src/act.js';
import { DRINK, WASH_HANDS, MAKE_BED, BUILD_HUT, KNAP, PREPARE, EAT, SURVEY, SLEEP_HOUR, TICKS, POPULATION, GUT_KG, CRAFTS, DRILL_ATTEMPT, EMBER, HANDLE, REST } from '../../src/acts.js';
import { generateLandscape } from '../../src/landscape.js';
import { walk, chooseSpawn, stepView, WALK_STEP } from '../../src/geo.js';
const fails = [], say = [];

const world = generateWorld('acts', { preset: 'temperate-woodland' });
function game(over = {}) {
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
const dice = i => ({ act: makeRng(`acts/${i}`), place: key => makeRng(`${world.seed}/${key}`) });
// run a process the way the game does, but with no time passing: view, rehearse, apply
function run(G, proc, binding = {}, i = 0) {
  const st = G.state(binding), v = viewOf(proc, st);
  const fx = rehearse(proc, v, dice(i));
  apply(fx, st);
  return fx;
}
const tries = (n, f) => Array.from({ length: n }, (_, i) => f(i));

// water
{
  const brewing = (pathogen, n = 400) => tries(n, i => { const G = game({ here: { water: { name: 'w', pathogen } } }); run(G, DRINK, {}, i); return G.S.body.pendingSick.length; }).reduce((a, b) => a + b, 0) / n;
  const G = game(); run(G, DRINK);
  if (G.S.body.hyd !== 1) fails.push('drinking doesn\'t fill me up');
  const bad = brewing(0.5), good = brewing(0.06);
  say.push(`drink: sickness brewing ${(100 * bad).toFixed(0)}% of the time from lake water (pathogen 0.5), ${(100 * good).toFixed(0)}% from a spring (0.06)`);
  if (!(bad > 0.2 && good < 0.08)) fails.push('bad water isn\'t riskier than good');
  const H = game(); run(H, WASH_HANDS);
  if (!(H.S.body.germs < 0.3)) fails.push('washing doesn\'t clean my hands');
}
// shelter
{
  const G = game(), leaves = [{ uid: 1, name: 'leaves', kind: 'bedding', props: { loft: 0.4, moisture: 0.1 } }, { uid: 2, name: 'leaves', kind: 'bedding', props: { loft: 0.4, moisture: 0.1 } }];
  const fx = run(G, MAKE_BED, { stuff: leaves });
  if (!(G.S.site.bed?.clo > 0.5) || fx.use.length !== 2) fails.push('a bed of leaves doesn\'t go down, or the leaves aren\'t used up');
  const a = run(G, BUILD_HUT), b = run(G, BUILD_HUT);
  if (!G.S.site.hut || a.say.length !== 2 || b.say.length !== 1) fails.push('a hut doesn\'t go up, or its milestone isn\'t once only');
}
// stone
{
  const stone = (fracture, flaws) => ({ uid: 1, name: 'stone', kind: 'stone', props: { fracture, flaws, hardness: 7, mass: 800, germs: 0.05 }, from: { id: world.stones[0].id, name: 'grey' } });
  const flakes = (core, n = 300) => tries(n, i => run(game(), KNAP, { core, hammer: { props: { hardness: 7, mass: 700 } }, anvil: { props: { mass: 6000 }, slab: true } }, i).make.length).reduce((a, b) => a + b, 0) / n;
  const good = flakes(stone(0.85, 0.05)), poor = flakes(stone(0.35, 0.5));
  say.push(`knap: ${good.toFixed(2)} flakes a try from clean-breaking stone, ${poor.toFixed(2)} from poor`);
  if (!(good > poor)) fails.push('clean-breaking stone doesn\'t knap better');
  const G = game(); run(G, KNAP, { core: stone(0.85, 0.05), hammer: { props: { hardness: 7, mass: 700 } }, anvil: { props: { mass: 6000 }, slab: true } });
  if (!(G.S.body.fatigue > 0 && G.S.body.attempts === 1)) fails.push('knapping doesn\'t wear me');
}
// food
const plant = world.plants.find(p => p.parts.some(x => x.food && x.chem && x.chem.water > 0.3));
const part = plant.parts.find(x => x.food && x.chem && x.chem.water > 0.3);
const food = (mass = 0.3) => ({ uid: 9, name: `${part.part} to eat`, base: `${part.part} to eat`, kind: 'food', prep: [], notes: {}, props: { chem: structuredClone(part.chem), mass, germs: 0.1 }, from: { id: plant.id, name: plant.name, part: part.part } });
{
  const stones = [1, 2, 3].map(i => ({ uid: 20 + i, name: 'cobble', kind: 'stone', props: { hardness: 6, mass: 900, rough: 0.5, spall: 0.3 } }));
  const modes = { pound: null, grind: null, chop: null, roast: 'quick', leach: '8', soak: '8', dryfood: 'sun', stoneboil: null };
  for (const [id, mode] of Object.entries(modes)) {
    const f = food(), G = game({ S: { site: { key: 's1', micro: 'woodland', known: new Set(), basin: { kind: 'rock hollow' } } } });
    run(G, PREPARE(id), { food: f, mode, stone: stones[0], edge: { props: { sharpness: 0.8 } }, stones });
    if (!f.prep.length || f.name === f.base) fails.push(`${id} doesn't change or name the food`);
  }
  const G = game(); const f = food(); const e0 = G.S.body.energy;
  run(G, EAT, { food: f });
  if (!(G.S.body.gut > 0) || G.S.body.energy === e0) fails.push('eating doesn\'t fill me or feed me');
  const full = game({ S: { body: { ...game().S.body, gut: GUT_KG } } });
  let refused = false; try { const v = viewOf(EAT, full.state({ food: food() })); refused = EAT.ready(v) !== true; } catch { refused = false; }
  if (!refused) fails.push('eating isn\'t refused when I\'m full');
}
// survey
{
  const G = game(), fx = run(G, SURVEY);
  const p1 = run(game(), POPULATION).report.present, p2 = run(game(), POPULATION, {}, 7).report.present;
  say.push(`survey: saw ${Object.keys(fx.report.seen).length} kinds of thing of ${Object.keys(p1).length} living here; knows ${G.S.site.known.size}`);
  if (!Object.keys(fx.report.seen).length || !G.S.site.known.size) fails.push('a survey in daylight finds nothing');
  if (JSON.stringify(p1) !== JSON.stringify(p2)) fails.push('the same site holds different things on another try');
}
// sleep
{
  const hour = T => { const G = game(); run(G, SLEEP_HOUR, { night: { tempC: T, windMs: 3, precip: null, groundWet: 0.3, snowCm: 0, biters: false }, shelter: SHELTERS.open, fireC: 0, dt: 1 }); return G.S.body.chill; };
  if (!(hour(-5) > 0) || hour(25) > 0) fails.push('an hour asleep doesn\'t chill me in the cold, or does in the warm');
}
// ticks
for (const tick of TICKS) {
  const G = game({ S: { inv: [food()] } });
  try { run(G, tick, { tick: { dt: 0.5, kcal: 150 }, was: skyAt(world, 1, 9.5) }); } catch (e) { fails.push(`tick ${tick.id}: ${e.message}`); }
}
// crafts
{
  const from = { id: world.plants[0].id, name: 'test', part: 'dead wood' };
  const item = (uid, kind, props, extra = {}) => ({ uid, name: kind, kind, props: { germs: 0.05, ...props }, from, notes: {}, ...extra });
  const edge = () => item(50, 'edge', { sharpness: 0.8, hardness: 7 });
  const wood = item(51, 'wood', { density: 0.3, resin: 0.1, moisture: 0.12 }), shoot = item(52, 'shoot', { density: 0.5, moisture: 0.15, straightness: 0.9 });
  const cases = [
    ['notch', { wood, edge: edge(), mode: 'careful' }, fx => fx.make[0]?.kind === 'board'],
    ['carve', { shoot, edge: edge() }, fx => fx.make[0]?.kind === 'spindle'],
    ['trim', { stalk: item(53, 'stalk', { density: 0.3, straightness: 0.95 }) }, fx => fx.make[0]?.props.length === 70],
    ['digstick', { stick: shoot, tool: edge() }, fx => fx.make[0]?.kind === 'diggingstick'],
    ['tinder', { mat: item(54, 'tindermat', { moisture: 0.1 }, { from: { ...from, part: 'grass' } }) }, fx => fx.make[0]?.kind === 'tinder'],
    ['bone', { bone: item(55, 'bone', { hardness: 3 }), hammer: item(56, 'stone', { hardness: 7, mass: 700 }) }, fx => fx.use.length === 1],
    ['wash', { thing: item(57, 'stone', { germs: 0.6 }) }, fx => fx.changes.some(c => c.path === 'thing.props.germs' && c.to < 0.6)],
  ];
  for (const [id, b, ok] of cases) {
    let fx = null;
    try { fx = run(game(), CRAFTS[id], b); } catch (e) { fails.push(`${id}: ${e.message}`); continue; }
    if (!ok(fx)) fails.push(`${id} didn't do what it says`);
  }
  const G = game({ here: { fire: true } }), stick = item(58, 'diggingstick', { hardness: 0.4, moisture: 0.3, hardened: 0 });
  run(G, CRAFTS.harden, { stick, mode: 'careful' });
  if (!(stick.props.hardness > 0.4 && stick.props.hardened === 1)) fails.push('hardening doesn\'t harden the point');
  const B = game({ S: { site: { key: 's1', micro: 'claybank', known: new Set() } } }); run(B, CRAFTS.basin);
  if (B.S.site.basin?.kind !== 'clay-lined pit') fails.push('no basin dug in a clay bank');
  const e = edge(); let n = 0; while (e.props.sharpness >= 0.35 && n++ < 40) run(game(), CRAFTS.carve, { shoot: { ...shoot, props: { ...shoot.props, density: 0.9 } }, edge: e }, n);
  if (!e.toldDull) fails.push('an edge carving hard wood never goes dull');
}
// the drill, the ember, handling, rest
{
  const board = { uid: 60, name: 'board', kind: 'board', props: { density: 0.3, resin: 0.1, moisture: 0.1, notch: 0.8, life: 1, socket: 0 }, from: { name: 'test' }, provenance: { name: 'test' } };
  const spindle = { uid: 61, name: 'spindle', kind: 'spindle', props: { density: 0.3, moisture: 0.1, straightness: 0.95, length: 70 }, from: { name: 'test' } };
  let embers = 0;
  for (let i = 0; i < 40; i++) { const G = game({ S: { body: { ...game().S.body, skills: { knapping: 0.5, woodwork: 0.5, firecraft: 0.6 } } } }); const fx = run(G, DRILL_ATTEMPT, { board: structuredClone(board), spindle: structuredClone(spindle) }, i); if (fx.report.ember != null) embers++; }
  const G = game(), b = structuredClone(board), sp = structuredClone(spindle); run(G, DRILL_ATTEMPT, { board: b, spindle: sp });
  say.push(`drill: ${embers} embers in 40 goes for a fair hand on a good board; one go takes the board's life to ${b.props.life.toFixed(2)} and the spindle to ${sp.props.length} cm`);
  if (!(b.props.life < 1 && sp.props.length < 70)) fails.push('drilling doesn\'t wear the board and spindle');
  if (!embers) fails.push('no ember in 40 goes for a fair hand');
  const raw = game({ S: { body: { ...game().S.body, hands: 0.9 } } });
  if (DRILL_ATTEMPT.ready(viewOf(DRILL_ATTEMPT, raw.state({ board, spindle }))) === true) fails.push('drilling with raw palms isn\'t refused');
  let fires = 0;
  for (let i = 0; i < 40; i++) { const F = game(); const fx = run(F, EMBER, { ember: { props: { vigor: 0.8 } }, tinder: { uid: 62, props: { moisture: 0.05, fineness: 0.9 } }, wood: { uid: 63, props: {} } }, i); if (fx.report?.fire) { fires++; if (!(F.S.site.fireUntil > 10)) fails.push('a fire lit, but not burning'); } }
  if (!fires) fails.push('a strong ember in fine dry tinder never lights a fire');
  const H = game({ S: { inv: [{ uid: 70, props: { germs: 0.8 } }, { uid: 71, props: { germs: 0 } }] } });
  run(H, HANDLE, { handled: [70, 71], kill: 0.05 });
  if (!(H.S.inv[0].props.germs < 0.1 && H.S.body.germs !== 0.3)) fails.push('handling doesn\'t mix germs, or heat doesn\'t kill them');
  const R = game({ S: { body: { ...game().S.body, fatigue: 0.8 } } }); run(R, REST, { hours: 2, dusk: false });
  if (!(R.S.body.fatigue < 0.8)) fails.push('resting doesn\'t ease tiredness');
}
// a walking step, run again with other dice from where it began
{
  const L = generateLandscape(world), from = chooseSpawn(L, world.seed), rng = makeRng('acts/walk');
  const trip = walk(L, from, { x: Math.min(120, from.x + 25), y: Math.max(5, from.y - 20) }, { rng, maxHours: 3 });
  let likely = 0, forced = 0, surprisal = 0;
  for (let i = 0; i < trip.steps.length; i++) {
    const v0 = stepView(L, trip, i), counts = {};
    for (let k = 0; k < 200; k++) { const fx = rehearse(WALK_STEP, v0, { act: makeRng(`acts/step/${i}/${k}`) }); const to = fx.report.to; counts[`${to.x},${to.y}`] = (counts[`${to.x},${to.y}`] ?? 0) + 1; }
    const took = trip.path[trip.steps[i].at], p = (counts[`${took.x},${took.y}`] ?? 0) / 200;
    if (Object.keys(counts).some(k => { const [x, y] = k.split(',').map(Number); return Math.max(Math.abs(x - trip.steps[i].p.x), Math.abs(y - trip.steps[i].p.y)) !== 1; })) fails.push(`walk step ${i}: an outcome that isn't a neighbouring cell`);
    if (!p) fails.push(`walk step ${i}: the cell taken never comes up again from where the step began`);
    if (p >= 0.5) likely++;
    if (p >= 0.9) forced++;
    surprisal += -Math.log2(Math.max(p, 1 / 200));
  }
  say.push(`walk: ${trip.steps.length} steps; the cell taken was the likelier one ${likely} times and near-forced (≥ 90%) ${forced} times; the walk's surprisal ${surprisal.toFixed(1)} bits`);
}
// the contract holds
{
  const sneaky = { id: 'sneaky', reads: ['body.hyd'], writes: [], run(v) { v.body.hyd = 1; } };
  const nosy = { id: 'nosy', reads: ['body.hyd'], writes: [], run(v) { return { report: v.body.energy }; } };
  for (const p of [sneaky, nosy]) { let stopped = false; try { run(game(), p); } catch { stopped = true; } if (!stopped) fails.push(`a process that ${p.id === 'sneaky' ? 'writes' : 'reads'} past its contract isn't stopped`); }
}
console.log('acts:\n  ' + say.join('\n  '));
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('acts: all passed');
