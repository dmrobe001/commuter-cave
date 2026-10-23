// Things that go together turn up together (population.js guilds), without changing how often each
// turns up on its own. Over many sites of a few worlds: each species' site luck has mean ≈ 0 and
// variance ≈ 1 (so its rate of turning up is as before), and two members of a guild have correlated
// luck, ≈ ρ_a ρ_b (flowers and bees, prey and hunters, ...), while non-members are uncorrelated.
// Every thing has an id of its own (its luck is keyed by it). And the counts follow: bees are thicker where
// flowering plants are.
// Usage: node tests/sim/guilds.mjs
import { generateWorld } from '../../src/generator.js';
import { siteLuck, guildsOf, populationAt, densityAt } from '../../src/population.js';
import { makeRng } from '../../src/rng.js';
const seeds = process.env.QUICK ? ['c'] : ['c', 'm', 'gbn2f'];
const SITES = process.env.QUICK ? 1500 : 3000;
const fails = [], lines = [];
const corr = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
let pairs = 0;
for (const seed of seeds) {
  const w = generateWorld(seed, {}), place = key => makeRng(`${seed}/${key}`);
  const all = [...w.plants, ...w.animals];
  const ids = [...w.stones, ...all].map(e => e.id), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) fails.push(`${seed}: things sharing an id (and so their luck): ${dup.join(', ')}`);
  const luck = new Map(all.map(e => [e, Array.from({ length: SITES }, (_, i) => siteLuck(e, place(`abund/${e.id}/s${i}`).normal(), `s${i}`, place))]));
  for (const [e, z] of luck) {
    const m = z.reduce((a, b) => a + b, 0) / SITES, v = z.reduce((a, b) => a + (b - m) ** 2, 0) / SITES;
    if (Math.abs(m) > 0.1 || Math.abs(v - 1) > 0.12) fails.push(`${seed}: ${e.name}'s site luck isn't standard normal (mean ${m.toFixed(2)}, variance ${v.toFixed(2)})`);
  }
  const shared = (a, b) => { const gb = guildsOf(b); return guildsOf(a).reduce((s, g) => s + g.rho * (gb.find(h => h.id === g.id)?.rho ?? 0), 0); };
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j], want = shared(a, b), got = corr(luck.get(a), luck.get(b));
    if (Math.abs(got - want) > 0.08) fails.push(`${seed}: ${a.name} and ${b.name}: luck correlated ${got.toFixed(2)}, expected ${want.toFixed(2)}`);
    if (want > 0.2 && pairs < 12) { pairs++; lines.push(`${seed}: ${a.name} ~ ${b.name}: correlation ${got.toFixed(2)} (ρρ ${want.toFixed(2)})`); }
  }
  // the counts themselves: bees thicker where flowering plants are thick (log counts, every site, present or not)
  const bee = w.animals.find(a => a.traits.key === 'bee');
  if (bee) {
    const micro = bee.habitats[0].micro, bx = [], fx = [];
    for (let i = 0; i < SITES; i++) {
      const counts = {};
      populationAt(w, micro, `s${i}`, { fertility: 0 }, place, (k, id, f) => { counts[id] = f.count; });
      const fl = w.plants.filter(p => counts[p.id] != null && guildsOf(p).some(g => g.id === 'bloom'));
      if (!fl.length) break;
      bx.push(Math.log(counts[bee.id])); fx.push(fl.reduce((a, p) => a + Math.log(counts[p.id]), 0) / fl.length);
    }
    if (bx.length) { const c = corr(bx, fx); lines.push(`${seed}: bee count vs flowering plants' (log, by site): correlation ${c.toFixed(2)}`); if (c < 0.15) fails.push(`${seed}: bees barely follow the flowers (correlation ${c.toFixed(2)})`); }
  }
  const hunter = w.animals.find(a => a.traits.key === 'predator'), prey = w.animals.find(a => ['browser', 'hare', 'rodent'].includes(a.traits.key));
  if (hunter && prey) {
    const d = i => [densityAt(hunter, `s${i}`, place), densityAt(prey, `s${i}`, place)];
    const xs = Array.from({ length: SITES }, (_, i) => d(i));
    lines.push(`${seed}: ${hunter.name} density vs ${prey.name}: log correlation ${corr(xs.map(x => Math.log(x[0])), xs.map(x => Math.log(x[1]))).toFixed(2)}; mean ${hunter.name} ${(xs.reduce((a, x) => a + x[0], 0) / SITES).toFixed(2)}/km² (usual ${hunter.perKm2})`);
  }
}
console.log(`guilds:\n  ${lines.join('\n  ')}`);
if (!pairs) fails.push('no guild pairs found: the test checked nothing');
if (fails.length) { console.log('FAIL\n  ' + fails.slice(0, 10).join('\n  ')); process.exit(1); }
console.log('guilds: all passed');
