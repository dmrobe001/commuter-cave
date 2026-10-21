import { generateWorld } from '../../src/generator.js';
import { generateLandscape } from '../../src/landscape.js';
import { chooseSpawn, perceive, walk, isLookout, bearingWord, distM, CUE_WORDS } from '../../src/geo.js';
import { makeRng } from '../../src/rng.js';
let ok = 0, fallback = 0;
const seeds = ['pig-rock', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', ...Array.from({ length: 20 }, (_, i) => `s${i}`)].slice(0, process.env.QUICK ? 8 : 30); // QUICK=1: 8 worlds
for (const seed of seeds) {
  const w = generateWorld(seed, seed === 'pig-rock' ? { preset: 'temperate-woodland', mcSamples: 30 } : { mcSamples: 30 });
  const L = generateLandscape(w);
  const t0 = performance.now();
  const sp = chooseSpawn(L, seed);
  const ms = performance.now() - t0;
  if (sp.fallback) fallback++; else ok++;
  if (['pig-rock', 'c', 'd', 'h'].includes(seed)) {
    const here = perceive(L, sp, { time: 'dawn' });
    console.log(`\n${seed} (${w.environment.biome}): spawn (${sp.x},${sp.y}), water ${sp.waterM} m away, ${sp.fallback ? 'FALLBACK' : `lookout ${Math.round(distM(sp, sp.lookout))} m ${bearingWord(Math.atan2(sp.lookout.x - sp.x, -(sp.lookout.y - sp.y)) * 180 / Math.PI)}`}; spawn search ${Math.round(ms)} ms`);
    console.log('  from spawn at dawn: ' + (here.map(c => `${CUE_WORDS[c.kind]} (${c.channel}, ${Math.round(c.trueDist)} m ${bearingWord(c.trueBearing)})`).join('; ') || 'nothing'));
    if (sp.lookout) {
      const rng = makeRng('t');
      const trip = walk(L, sp, sp.lookout, { rng, maxHours: 4 });
      const top = perceive(L, trip.end, { time: 'day', lookout: isLookout(L, trip.end.x, trip.end.y) });
      const kinds = {};
      for (const c of top) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      console.log(`  walked to the lookout in ${trip.hours.toFixed(1)} h (${trip.crossings.length} water crossings); lookout here: ${isLookout(L, trip.end.x, trip.end.y)}; from the top: ${JSON.stringify(kinds)}`);
    }
  }
}
console.log(`\nsurvivable spawns: ${ok}/${seeds.length}, fallbacks: ${fallback}`);
