// What preparation is worth: for each food part in a few worlds, net kcal per hour (gathering plus
// preparation time) and harm, raw and after each standard preparation; and how foods compare.
// QUICK=1: two worlds.
import { generateWorld } from '../../src/generator.js';
import { expose, nutrients, harm } from '../../src/food.js';
import { hazard } from '../../src/life.js';
const PREPS = {
  raw: { ex: {}, h: 0 },
  roast: { ex: { heat: { mode: 'roast', minutes: 15 } }, h: 0.3 },
  'pound+roast': { ex: { crush: 0.5, heat: { mode: 'roast', minutes: 15 } }, h: 0.55 },
  'grind+roast': { ex: { crush: 0.9, heat: { mode: 'roast', minutes: 15 } }, h: 1.05 },
  'pound+leach 8h+roast': { ex: { crush: 0.5, water: { mode: 'running', hours: 8 }, heat: { mode: 'roast', minutes: 15 } }, h: 0.8 }, // the 8 h of soaking is waiting, not working
  'stone-boil': { ex: { heat: { mode: 'boil', minutes: 20 } }, h: 0.75 },
  'pound+leach 8h+stone-boil': { ex: { crush: 0.5, water: { mode: 'running', hours: 8 }, heat: { mode: 'boil', minutes: 20 } }, h: 1.0 },
};
const seeds = process.env.QUICK ? ['pig-rock', 'c'] : ['pig-rock', 'c', 'm', 'h', 'n7', 'a'];
const rows = [];
for (const seed of seeds) {
  const w = generateWorld(seed, { mcSamples: 5 });
  const foods = [
    ...w.plants.flatMap(p => p.parts.filter(x => x.chem).map(x => ({ name: `${p.name} ${x.part}`, chem: x.chem }))),
    ...w.animals.filter(a => a.chem).map(a => ({ name: `${a.name} (handful)`, chem: a.chem })),
    ...w.animals.filter(a => a.honeyChem).map(a => ({ name: 'honeycomb', chem: a.honeyChem })),
  ];
  for (const f of foods) {
    const out = {};
    for (const [k, P] of Object.entries(PREPS)) {
      const st = expose(f.chem, P.ex, 0.8), n = nutrients(st, f.chem.gather);
      out[k] = { batch: Math.round(n.net), perHour: Math.round(n.net / (0.5 + P.h)), harm: hazard(harm(st)), parasites: st.compounds.parasites ?? 0 };
    }
    const ok = v => v.harm === 'safe' && v.parasites < 0.1;
    const best = Object.entries(out).filter(([, v]) => ok(v)).sort((a, b) => b[1].batch - a[1].batch)[0];
    rows.push({ world: seed, food: f.name.slice(0, 26), cls: f.chem.cls, 'raw net/batch': out.raw.batch, 'raw harm': out.raw.harm + (out.raw.parasites >= 0.1 ? ', parasites' : ''), best: best ? best[0] : 'none safe', 'best net/batch': best ? best[1].batch : 0, 'best kcal/h': best ? best[1].perHour : 0 });
  }
}
console.table(rows.filter(r => r['best net/batch'] > 100 || r.best !== 'raw').slice(0, process.env.QUICK ? 25 : 50));
const byCls = {};
for (const r of rows) (byCls[r.cls] ??= []).push(r);
const med = xs => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
console.log('\nby kind of food (medians; a batch is half an hour of gathering): net kcal raw → best safe preparation, and kcal per hour including preparation time');
for (const [k, v] of Object.entries(byCls)) console.log(`  ${k.padEnd(13)} raw ${String(med(v.map(r => r['raw net/batch']))).padStart(5)} → best ${String(med(v.map(r => r['best net/batch']))).padStart(5)}   ${String(med(v.map(r => r['best kcal/h']))).padStart(5)} kcal/h   preparation is best for ${v.filter(r => r.best !== 'raw' && r.best !== 'none safe').length}/${v.length}, nothing safe for ${v.filter(r => r.best === 'none safe').length}`);
