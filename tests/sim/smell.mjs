// Smell sources per world and how often something is smelled from the spawn over the first week.
import { generateWorld } from '../../src/generator.js';
import { generateLandscape } from '../../src/landscape.js';
import { chooseSpawn } from '../../src/geo.js';
import { windFor, smellSources, smellAt } from '../../src/smell.js';
import { makeRng } from '../../src/rng.js';
for (const seed of ['pig-rock', 'c', 'm', 'h', 'n7', 'a', 'b']) {
  const w = generateWorld(seed, { mcSamples: 10 }), L = generateLandscape(w), sp = chooseSpawn(L, seed), r = makeRng('smell');
  const days = [];
  for (let day = 1; day <= 7; day++) {
    const src = smellSources(w, L, day), wind = windFor(w, day);
    const got = smellAt(src, sp, wind, r);
    days.push(`d${day}: ${src.length} sources, wind from ${Math.round(wind.from)}°, smelled ${got.map(g => `${g.kind} ${Math.round(g.trueDist)} m`).join(', ') || 'nothing'}`);
  }
  console.log(`${seed} (${w.environment.bedrock}):\n  ` + days.join('\n  '));
}
