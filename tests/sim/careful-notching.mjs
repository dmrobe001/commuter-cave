import { generateWorld } from '../../src/generator.js';
import { fireQuest } from '../../src/craft.js';
const q = (xs, p) => xs.length ? xs[Math.floor(p * (xs.length - 1))] : '—';
for (const seed of ['pig-rock', 'h', 'i']) {
  const w = generateWorld(seed, seed === 'pig-rock' ? { preset: 'temperate-woodland', mcSamples: 100 } : { mcSamples: 100 });
  for (const careful of [false, true]) {
    const days = []; let fails = 0;
    for (let k = 0; k < 300; k++) { const o = fireQuest(w, { label: `c${k}`, maxDays: 30, careful }); if (o.fire) days.push(o.day); else fails++; }
    days.sort((a, b) => a - b);
    console.log(`${seed.padEnd(9)} ${careful ? 'careful notching, touch-ups' : 'quick notching          '}  median day ${q(days, 0.5)} (10–90%: ${q(days, 0.1)}–${q(days, 0.9)}), no fire in 30 days ${(100 * fails / 300).toFixed(0)}%`);
  }
}
