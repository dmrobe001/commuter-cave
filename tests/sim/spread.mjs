// The range of a process's outcomes (spread.js), on the hand-made state.
// Checks:
// - varying nothing (this attempt's dice as they were, the place as it is) gives back what happened;
// - knapping, run 300 times: the attempt's chance and margin, flakes' sharpness spread over quantiles,
//   how many made, and where the one that happened ranks;
// - drinking: how often it leaves illness to come matches the chance it gives (about 0.6 × pathogen);
// - a survey varied by this attempt's luck: each thing that lives here is noticed about as often as its
//   chance says, with the place's count always the same; varied by the place's luck (cells like this
//   one), what lives here and how many vary;
// - what the process read is listed as its inputs.
// Usage: node tests/sim/spread.mjs
import { makeRng } from '../../src/rng.js';
import { attempt } from '../../src/act.js';
import { spread, reproduces, describeObservable } from '../../src/spread.js';
import { KNAP, DRINK, SURVEY } from '../../src/acts.js';
import { world, game } from './hand-state.mjs';
const fails = [], say = [];
const fmt = x => (typeof x === 'number' ? +x.toFixed(2) : x);
const field = (o, f) => o?.fields.find(x => x.field === f);

// knapping
{
  const core = { uid: 1, name: 'stone', kind: 'stone', props: { fracture: 0.8, flaws: 0.1, hardness: 7, mass: 800, germs: 0.05 }, from: { id: world.stones[0].id, name: 'grey' } };
  const G = game(), st = () => G.state({ core, hammer: { props: { hardness: 7, mass: 700 } }, anvil: { props: { mass: 6000 }, slab: true } });
  const rng = makeRng('knap/actual'), actAt = rng.copy(), place = key => makeRng(`${world.seed}/${key}`);
  const actual = attempt(KNAP, st(), { act: rng, place });
  actual.tx.discard();
  if (!reproduces(KNAP, st, actAt, place, actual)) fails.push('knap: running again with the same dice gives a different outcome');
  const r = spread(KNAP, st, { n: 300, vary: 'act', actAt, place, actual });
  const att = r.observables.find(o => o.kind === 'attempt' && o.id === 'knap'), p = field(att, 'p'), margin = field(att, 'margin'), flakes = field(att, 'flakes');
  const sharp = r.leaves.find(e => e.path === 'made.edge.sharpness');
  say.push(`knap: ${r.n} runs; chance of success ${fmt(p?.summary.q[2])}, margin ${margin?.summary.q.map(fmt).join(' / ')}; flakes ${flakes?.summary.q.map(fmt).join(' / ')}, happened ${flakes?.actual} (rank ${fmt(flakes?.rank)}); sharpness ${sharp?.summary.q.map(fmt).join(' / ')}`);
  if (!att || !(margin.summary.q[4] > margin.summary.q[0])) fails.push('knap: no spread in the attempt\'s margin');
  if (!sharp || !(sharp.summary.q[4] > sharp.summary.q[0])) fails.push('knap: no spread in the sharpness of flakes');
  if (flakes?.rank == null) fails.push('knap: what happened has no rank among the runs');
  if (!r.inputList.some(i => i.path === 'core.props.fracture')) fails.push('knap: the stone\'s fracture isn\'t listed among what it read');
  if (r.errors.length) fails.push(`knap: ${r.errors.join('; ')}`);
}
// drinking
for (const pathogen of [0.06, 0.5]) {
  const G = game({ here: { water: { name: 'w', pathogen } } });
  const r = spread(DRINK, () => G.state({}), { n: 400 });
  const ill = r.observables.find(o => o.kind === 'made ill');
  say.push(`drink (pathogen ${pathogen}): made ill in ${(100 * ill.observed).toFixed(0)}% of ${r.n} runs, at a chance of ${fmt(field(ill, 'p').summary.mean)}`);
  if (Math.abs(ill.observed - field(ill, 'p').summary.mean) > 0.07) fails.push(`drink: made ill ${ill.observed.toFixed(2)} of runs at pathogen ${pathogen}, against a chance of ${field(ill, 'p').summary.mean.toFixed(2)}`);
}
// survey: this attempt's luck against the place's
{
  const G = game(), st = () => G.state({}), place = key => makeRng(`${world.seed}/${key}`);
  const byAct = spread(SURVEY, st, { n: 200, vary: 'act', place }), byPlace = spread(SURVEY, st, { n: 60, vary: 'place', actAt: makeRng('survey'), place });
  const noticed = byAct.observables.filter(o => o.kind === 'noticed' && field(o, 'p')?.summary.mean > 0);
  const off = noticed.filter(o => Math.abs(o.observed - field(o, 'p').summary.mean) > 0.1);
  const fixedCounts = byAct.observables.filter(o => o.kind === 'lives here').every(o => field(o, 'count').summary.min === field(o, 'count').summary.max);
  const placeVaries = byPlace.observables.filter(o => o.kind === 'lives here' && (o.observed < 1 || field(o, 'count').summary.min !== field(o, 'count').summary.max));
  say.push(`survey: by this attempt's luck, ${noticed.length} things noticed at some point, ${off.length} more than 0.1 off their chance; by the place's luck, ${placeVaries.length} of ${byPlace.observables.filter(o => o.kind === 'lives here').length} things vary in whether or how many live here`);
  say.push(`  e.g. ${describeObservable(noticed[0]).head}: ${describeObservable(noticed[0]).parts.join('; ')}`);
  if (off.length) fails.push(`survey: noticed more or less often than their chance: ${off.map(o => o.name).join(', ')}`);
  if (!fixedCounts) fails.push('survey: what lives here varies with this attempt\'s luck alone');
  if (!placeVaries.length) fails.push('survey: what lives here doesn\'t vary from place to place');
}
console.log('spread:\n  ' + say.join('\n  '));
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('spread: all passed');
