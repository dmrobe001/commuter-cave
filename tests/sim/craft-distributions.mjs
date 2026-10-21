import { generateWorld } from '../../src/generator.js';
import { fireQuest } from '../../src/craft.js';
const w = generateWorld('pig-rock', { preset: 'temperate-woodland', mcSamples: 100 });
const expert = { knapping: 0.85, woodwork: 0.85, firecraft: 0.9 };
const q = (xs, p) => xs[Math.floor(p * (xs.length - 1))];
for (const [label, skills, h] of [['novice, best wood', {}, 'best'], ['novice, worst usable', {}, 'marginal'], ['expert, worst usable', expert, 'marginal'], ['expert, best wood', expert, 'best']]) {
  const days = [], tries = [];
  let fails = 0;
  for (let i = 0; i < 200; i++) {
    const out = fireQuest(w, { skills, hearthChoice: h, label: `${label}-${i}`, maxDays: 30 });
    if (out.fire) { days.push(out.day); tries.push(Object.values(out.ch.outcomes)[0].tries); } else fails++;
  }
  days.sort((a, b) => a - b); tries.sort((a, b) => a - b);
  console.log(`${label.padEnd(22)} day of first fire: median ${q(days, 0.5)}, 10–90%: ${q(days, 0.1)}–${q(days, 0.9)}; drill attempts median ${q(tries, 0.5)}; no fire within 30 days: ${(fails / 2).toFixed(0)}%`);
}
