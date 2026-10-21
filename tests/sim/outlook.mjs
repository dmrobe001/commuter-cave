// Start-screen outlook across worlds, plus a check on the panorama: one percept per source, never more.
import { generateWorld } from '../../src/generator.js';
import { generateLandscape } from '../../src/landscape.js';
import { chooseSpawn, hear } from '../../src/geo.js';
import { estimateFire } from '../../src/craft.js';
import { outlook } from '../../src/outlook.js';
const seeds = ['pig-rock', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', ...Array.from({ length: 20 }, (_, i) => `s${i}`)].slice(0, process.env.QUICK ? 8 : 30); // QUICK=1: 8 worlds
let dupes = 0;
for (const seed of seeds) {
  const w = generateWorld(seed, { mcSamples: 40 });
  const L = generateLandscape(w);
  const sp = chooseSpawn(L, seed);
  const o = outlook(w, L, sp, estimateFire(w), seed);
  const heard = hear(L, sp, { boost: 1.6 });
  if (new Set(heard.map(c => c.key)).size !== heard.length) dupes++;
  const t = o.water.trials.map(x => (Number.isFinite(x) ? x.toFixed(1) : 'never')).join(' ');
  console.log(`${seed.padEnd(9)}${sp.fallback ? ' (fallback)' : ''} ${Object.values(o.text).join(', ')}\n          water trials (h): ${t}; heard on a scan at the spawn: ${heard.length}`);
}
console.log(`\nworlds with a source heard twice in one scan: ${dupes} (want 0)`);
