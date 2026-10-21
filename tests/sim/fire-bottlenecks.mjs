import { generateWorld } from '../../src/generator.js';
import { reachable, materialsOf, candidatesFor } from '../../src/process.js';
const N = 300, c = { noFire: 0, noFlake: 0, noHearth: 0, noSpindle: 0, noTinder: 0 };
const hearth = { material: 'dead-wood', where: { density: [0.2, 0.45], resin: [0, 0.5] } };
for (let i = 0; i < N; i++) {
  const w = generateWorld(`stats-${i}`, { mcSamples: 50 });
  const { have } = reachable(w);
  if (have.has('fire')) continue;
  c.noFire++;
  const m = materialsOf(w);
  if (!have.has('flake')) c.noFlake++;
  if (!candidatesFor(hearth, m).length) c.noHearth++;
  if (!have.has('spindle')) c.noSpindle++;
  if (!have.has('tinder-bundle')) c.noTinder++;
}
console.log(c);
