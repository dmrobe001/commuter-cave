import { generateWorld } from '../../src/generator.js';
const N = 3000, fruit = {}, sigs = new Map(), names = new Map();
let shrubs = 0;
for (let i = 0; i < N; i++) {
  const w = generateWorld(`probe-${i}`, { preset: 'temperate-woodland', bedrock: 'sandstone' });
  for (const p of w.plants) {
    if (p.form === 'shrub') { shrubs++; fruit[p.traits.fruit] = (fruit[p.traits.fruit] ?? 0) + 1; }
    if (p.form !== 'tree') continue;
    const t = p.traits;
    const vis = p.cues.join(' | ');
    sigs.set(vis, (sigs.get(vis) ?? 0) + 1);
    const n = p.name.replace(/ \(form \d+\)/, '');
    names.set(n, (names.get(n) ?? 0) + 1);
  }
}
console.log('shrub fruit freq:', Object.fromEntries(Object.entries(fruit).map(([k, v]) => [k, (v / shrubs).toFixed(2)])));
console.log('distinct tree visible signatures:', sigs.size, ' distinct tree names:', names.size);
const sorted = [...sigs.values()].sort((a, b) => b - a), tot = sorted.reduce((a, b) => a + b, 0);
let cum = 0, k50 = 0; for (const v of sorted) { cum += v; k50++; if (cum >= tot / 2) break; }
console.log('signatures covering half of all trees:', k50);
console.log('top tree names:', [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
