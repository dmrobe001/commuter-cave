import { generateWorld } from '../../src/generator.js';
import { fireQuest, estimateFire } from '../../src/craft.js';
const q = (xs, p) => xs[Math.floor(p * (xs.length - 1))];
let simMs = 0, estMs = 0, genMs = 0, runs = 0;
for (const seed of ['pig-rock', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) {
  let t = performance.now();
  const w = generateWorld(seed, seed === 'pig-rock' ? { preset: 'temperate-woodland', mcSamples: 100 } : { mcSamples: 100 });
  genMs += performance.now() - t;
  t = performance.now();
  const est = estimateFire(w);
  estMs += performance.now() - t;
  const e = w.environment;
  const head = `${seed.padEnd(9)} ${e.biome.padEnd(34)} wood moisture ${(0.05 + 0.07 * e.water).toFixed(2)}`;
  if (est.blocked) { console.log(`${head}\n          BLOCKED: ${est.blocked}\n`); continue; }
  t = performance.now();
  const days = []; let fails = 0;
  for (let i = 0; i < 200; i++) { const o = fireQuest(w, { label: `n-${i}`, maxDays: 30 }); if (o.fire) days.push(o.day); else fails++; runs++; }
  simMs += performance.now() - t;
  days.sort((a, b) => a - b);
  console.log(`${head}\n          edges: ${est.edgeSource}; hearth: ${est.hearth.provenance.name} (density ${est.hearth.props.density.toFixed(2)}); spindles: ${est.spindle}${est.spindle.includes('green') ? ` (dry by day ${est.ready})` : ''}`);
  console.log(`          per-attempt odds: early ${(100 * est.early).toFixed(1)}%, with good spindle ${(100 * est.late).toFixed(1)}%`);
  console.log(`          SIMULATION: median day ${days.length ? q(days, 0.5) : '—'} (10–90%: ${days.length ? `${q(days, 0.1)}–${q(days, 0.9)}` : '—'}), no fire in 30 days ${(fails / 2).toFixed(0)}%`);
  console.log(`          ESTIMATE:   median day ${est.median ?? '>30'}, P(fire by day 5) ${(100 * est.pFireBy(5)).toFixed(0)}%, by day 10 ${(100 * est.pFireBy(10)).toFixed(0)}%\n`);
}
console.log(`timing: world generation ${(genMs / 10).toFixed(0)} ms/world; one simulated run ${(simMs / runs).toFixed(2)} ms; closed-form estimate ${(estMs / 10).toFixed(2)} ms/world`);
