// The range of a process's outcomes (spread.js), on the hand-made state.
// Checks:
// - varying nothing (this attempt's dice as they were, the place as it is) gives back what happened;
// - knapping, run 300 times: flakes' sharpness spread over quantiles, how many flakes made, and where
//   the one that happened ranks among them;
// - drinking: how often sickness is left brewing follows the water's pathogen score;
// - a survey varied by this attempt's luck sees different things but every count it reports is the
//   place's own (the same each time); varied by the place's luck (cells like this one), the counts vary;
// - what the process read is listed as its inputs.
// Usage: node tests/sim/spread.mjs
import { makeRng } from '../../src/rng.js';
import { attempt } from '../../src/act.js';
import { spread, reproduces } from '../../src/spread.js';
import { KNAP, DRINK, SURVEY } from '../../src/acts.js';
import { world, game } from './hand-state.mjs';
const fails = [], say = [];
const fmt = x => (typeof x === 'number' ? +x.toFixed(2) : x);

// knapping
{
  const core = { uid: 1, name: 'stone', kind: 'stone', props: { fracture: 0.8, flaws: 0.1, hardness: 7, mass: 800, germs: 0.05 }, from: { id: world.stones[0].id, name: 'grey' } };
  const G = game(), v0 = () => G.state({ core, hammer: { props: { hardness: 7, mass: 700 } }, anvil: { props: { mass: 6000 }, slab: true } });
  const rng = makeRng('knap/actual'), actAt = rng.copy(), place = key => makeRng(`${world.seed}/${key}`);
  const actual = attempt(KNAP, v0(), { act: rng, place });
  actual.tx.discard();
  if (!reproduces(KNAP, v0, actAt, place, actual)) fails.push('knap: running again with the same dice gives a different outcome');
  const r = spread(KNAP, v0, { n: 300, vary: 'act', actAt, place, actual });
  const sharp = r.leaves.find(e => e.path === 'made.edge.sharpness'), count = r.leaves.find(e => e.path === 'made (count)');
  say.push(`knap: ${r.n} runs; flakes made ${count.summary.q.map(fmt).join(' / ')} (5–95%), happened ${count.actual} (rank ${fmt(count.rank)}); sharpness ${sharp?.summary.q.map(fmt).join(' / ')}`);
  if (!sharp || !(sharp.summary.q[4] > sharp.summary.q[0])) fails.push('knap: no spread in the sharpness of flakes');
  if (count.rank == null || count.rank < 0 || count.rank > 1) fails.push('knap: what happened has no rank among the runs');
  if (!r.inputList.some(i => i.path === 'core.props.fracture')) fails.push('knap: the stone\'s fracture isn\'t listed among what it read');
  if (r.errors.length) fails.push(`knap: ${r.errors.join('; ')}`);
}
// drinking
for (const pathogen of [0.06, 0.5]) {
  const G = game({ here: { water: { name: 'w', pathogen } } }), v0 = () => G.state({});
  const r = spread(DRINK, v0, { n: 400 });
  const brew = r.leaves.find(e => e.path === 'body.pendingSick +n'), p = brew ? brew.summary.mean : 0;
  say.push(`drink (pathogen ${pathogen}): sickness left brewing in ${(100 * p).toFixed(0)}% of ${r.n} runs (expected ${(60 * pathogen).toFixed(0)}%)`);
  if (Math.abs(p - 0.6 * pathogen) > 0.07) fails.push(`drink: brewing ${p.toFixed(2)} at pathogen ${pathogen}, expected about ${(0.6 * pathogen).toFixed(2)}`);
}
// survey: this attempt's luck against the place's
{
  const G = game(), v0 = () => G.state({}), place = key => makeRng(`${world.seed}/${key}`);
  const byAct = spread(SURVEY, v0, { n: 60, vary: 'act', place }), byPlace = spread(SURVEY, v0, { n: 60, vary: 'place', actAt: makeRng('survey'), place });
  const counts = r => r.leaves.filter(e => /^report\.seen\./.test(e.path) && e.summary.kind === 'num');
  const fixed = counts(byAct).filter(e => e.summary.min !== e.summary.max);
  const varying = counts(byPlace).filter(e => e.summary.min !== e.summary.max);
  say.push(`survey: by this attempt's luck, ${counts(byAct).length} things seen at some point, every count the place's own (${fixed.length} vary); by the place's luck, ${varying.length} of ${counts(byPlace).length} counts vary`);
  if (fixed.length) fails.push(`survey: counts vary with this attempt's luck alone: ${fixed.map(e => e.path).join(', ')}`);
  if (!varying.length) fails.push('survey: counts don\'t vary from place to place');
}
console.log('spread:\n  ' + say.join('\n  '));
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('spread: all passed');
