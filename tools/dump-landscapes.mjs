import { generateWorld } from '../src/generator.js';
import { generateLandscape, microShares, N, CELL } from '../src/landscape.js';
import fs from 'node:fs';
const out = [];
for (const [seed, preset] of [['pig-rock', 'temperate-woodland'], ['c', ''], ['h', ''], ['d', '']]) {
  const w = generateWorld(seed, { ...(preset ? { preset } : {}), mcSamples: 40 });
  const t0 = performance.now();
  const L = generateLandscape(w);
  const ms = performance.now() - t0;
  const e = w.environment;
  out.push({ seed, biome: e.biome, relief: e.relief, water: e.water, ms: Math.round(ms), A: Math.round(L.A),
    elev: Array.from(L.elev, v => Math.round(v * 10) / 10), chan: Array.from(L.chan), lake: Array.from(L.lake), veg: Array.from(L.veg, v => Math.round(v * 100) / 100), slope: Array.from(L.slope, v => Math.round(v * 1000) / 1000),
    features: L.features, spawn: L.spawn, shares: microShares(L) });
  console.log(`${seed.padEnd(9)} ${e.biome.padEnd(32)} relief ${e.relief} water ${e.water}  ${Math.round(ms)} ms  local relief ${Math.round(L.A)} m`);
  console.log(`          hills ${L.features.hills.length}, lakes ${L.features.lakes.length} (${L.features.lakes.map(l => l.areaHa + ' ha').join(', ')}), waterfalls ${L.features.waterfalls.length}, springs ${L.features.springs.length}, escarpments ${L.features.escarpments.length}; spawn ${L.spawn ? `(${L.spawn.x},${L.spawn.y}), water ${L.spawn.waterM} m` : 'NONE'}`);
  console.log(`          microhabitats %: ${JSON.stringify(microShares(L))}`);
}
fs.writeFileSync(new URL('../out/lands.json', import.meta.url), JSON.stringify(out));
