import { generateWorld } from '../../src/generator.js';
import { fireQuest, estimateFire } from '../../src/craft.js';
const worlds = [], sims = [];
for (let i = 0; i < 40; i++) {
  const w = generateWorld(`fit-${i}`, { mcSamples: 50 });
  const est = estimateFire(w);
  if (est.blocked) continue;
  const days = [];
  for (let k = 0; k < 100; k++) { const o = fireQuest(w, { label: `f${k}`, maxDays: 40 }); days.push(o.fire ? o.day : 41); }
  days.sort((a, b) => a - b);
  worlds.push(w); sims.push(days[50]);
}
for (const eff of [0.4, 0.5, 0.6, 0.7, 0.8, 1.0]) {
  const err = worlds.map((w, i) => (estimateFire(w, { efficiency: eff, maxDays: 40 }).median ?? 41) - sims[i]);
  const mae = err.reduce((a, b) => a + Math.abs(b), 0) / err.length;
  const bias = err.reduce((a, b) => a + b, 0) / err.length;
  console.log(`efficiency ${eff}: mean abs error ${mae.toFixed(1)} days, bias ${bias > 0 ? '+' : ''}${bias.toFixed(1)} (over ${worlds.length} worlds)`);
}
