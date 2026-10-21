#!/usr/bin/env node
// cli.js — headless use.
//   node cli.js generate --seed pig-rock --preset temperate-woodland --out ./out
//   node cli.js patch --seed pig-rock --preset temperate-woodland --entity P3 --n 6
//   node cli.js stats --n 300 [--preset temperate-woodland]

import fs from 'node:fs';
import path from 'node:path';
import { generateWorld, samplePatch, PRESETS } from './generator.js';
import { toMarkdown } from './report.js';
import { toLong, pivotWide, toCSV } from './tables.js';
import { newMemory, observeSite } from './notes.js';
import { networkMarkdown, treeLines, thoughtWalk } from './network-report.js';
import { expandGoal, reachable, ITEMS, PROCESSES } from './process.js';
import { fireQuest } from './craft.js';

const [cmd = 'generate', ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, '')] = rest[i + 1];
if (args.preset && !PRESETS[args.preset]) {
  console.error(`Unknown preset. Options: ${Object.keys(PRESETS).join(', ')}`);
  process.exit(1);
}
const opts = args.preset ? { preset: args.preset } : {};
const seed = args.seed ?? 'demo';

if (cmd === 'generate') {
  const dir = path.join(args.out ?? '.', `world-${seed}`);
  fs.mkdirSync(dir, { recursive: true });
  const w = generateWorld(seed, opts);
  fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify(w, null, 2));
  fs.writeFileSync(path.join(dir, 'report.md'), toMarkdown(w));
  const long = toLong(w);
  fs.writeFileSync(path.join(dir, 'long.csv'), toCSV(['category', 'entity', 'name', 'part', 'property', 'value'], long));
  for (const [cat, file] of [['mineral', 'minerals.csv'], ['plant', 'plants.csv'], ['animal', 'animals.csv']]) {
    const { cols, rows } = pivotWide(long, cat);
    fs.writeFileSync(path.join(dir, file), toCSV(cols, rows));
  }
  console.log(`${w.environment.biome}: ${w.stones.length} stones, ${w.plants.length} plants, ${w.animals.length} animals -> ${dir}/`);
} else if (cmd === 'patch') {
  const w = generateWorld(seed, opts);
  const e = [...w.stones, ...w.plants, ...w.animals].find(x => x.id === args.entity);
  if (!e) { console.error('Unknown --entity'); process.exit(1); }
  const n = Number(args.n ?? 6);
  console.log(`${e.id} ${e.gmName ?? e.name}: varying traits ${e.varying.map(t => t.id).join(', ')}`);
  for (let i = 0; i < n; i++) {
    const h = e.habitats[i % e.habitats.length];
    console.log(JSON.stringify(samplePatch(w, e.id, `site-${i}`, h.micro)));
  }
} else if (cmd === 'network') {
  const w = generateWorld(seed, opts);
  const dir = path.join(args.out ?? '.', `world-${seed}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'network.md'), networkMarkdown(w));
  const { unreachable } = reachable(w);
  console.log(`${PROCESSES.length} processes; unreachable in this world: ${unreachable.map(k => ITEMS[k].name).join(', ') || 'none'} -> ${dir}/network.md`);
} else if (cmd === 'goal') {
  const w = generateWorld(seed, opts);
  const tree = expandGoal(args.goal ?? 'fire', w);
  console.log(treeLines(tree).join('\n'));
  console.log('\n' + thoughtWalk(tree).map(t => '  ' + t).join('\n'));
} else if (cmd === 'craft') {
  // Bare hands to fire, for several characters and hearth-wood choices.
  const w = generateWorld(seed, { ...opts, mcSamples: 200 });
  const runs = [
    ['Novice, best local hearth wood', {}, 'best'],
    ['Novice, worst usable hearth wood', {}, 'marginal'],
    ['Expert, worst usable hearth wood', { knapping: 0.85, woodwork: 0.85, firecraft: 0.9 }, 'marginal'],
    ['Expert, best local hearth wood', { knapping: 0.85, woodwork: 0.85, firecraft: 0.9 }, 'best'],
  ];
  for (const [title, skills, hearthChoice] of runs) {
    const out = fireQuest(w, { skills, hearthChoice, label: title });
    console.log(`=== ${title}${out.m?.hearthCandidates ? ` (dead wood by density: ${out.m.hearthCandidates.join(', ')})` : ''}`);
    for (const line of out.log) console.log('  ' + line);
    const o = Object.entries(out.ch.outcomes).map(([k, v]) => `${k}: ${v.embers} embers in ${v.tries} tries`).join('; ');
    console.log(`  -> ${out.fire ? `fire on day ${out.day}` : 'no fire yet'}; ${out.ch.attempts} actions total; peak hand damage ${out.ch.peakHands.toFixed(2)}; calluses ${out.ch.callus.toFixed(2)}; skills ${Object.entries(out.ch.skills).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}. Provenance: ${o}\n`);
  }
} else if (cmd === 'walk') {
  // A scripted walk through sites, printing the character's field notes.
  const w = generateWorld(seed, opts);
  const mem = newMemory();
  const present = new Set(w.environment.microhabitats.map(m => m.id));
  const route = ['glade', 'edge', 'woodland', 'streambank', 'glade', 'woodland', 'edge', 'outcrop', 'streambank',
    'glade', 'pond', 'woodland', 'glade', 'edge', 'woodland', 'streambank', 'glade', 'outcrop']
    .filter(m => present.has(m)).slice(0, Number(args.n ?? 18));
  route.forEach((micro, i) => {
    const time = ['dawn', 'day', 'day', 'dusk'][i % 4];
    const out = observeSite(w, mem, { site: `node-${i + 1}`, micro, skill: Number(args.skill ?? 0.5), time });
    console.log(`[${i + 1}, ${time}${out.mode === 'inventory' ? ', inventory' : ''}] ${out.text}\n`);
  });
} else if (cmd === 'stats') {
  const n = Number(args.n ?? 300);
  const tally = {}, biomes = {};
  let lookalike = 0, toxicFrac = 0, species = 0, allMet = 0, corrs = [];
  const nameCounts = new Map();
  const reach = {};
  for (let i = 0; i < n; i++) {
    const w = generateWorld(`stats-${i}`, { ...opts, mcSamples: 300 });
    biomes[w.environment.biome] = (biomes[w.environment.biome] ?? 0) + 1;
    for (const s of w.starter) tally[s.need] = (tally[s.need] ?? 0) + (s.met ? 1 : 0);
    if (w.starter.every(s => s.met)) allMet++;
    const { have } = reachable(w);
    for (const k of Object.keys(ITEMS)) reach[k] = (reach[k] ?? 0) + (have.has(k) ? 1 : 0);
    if (w.plants.some(p => p.lookalike)) lookalike++;
    species += w.plants.length + w.animals.length;
    toxicFrac += w.plants.filter(p => p.parts.some(x => x.food && /severe|lethal/.test(x.food.raw))).length / w.plants.length;
    for (const x of [...w.plants, ...w.animals, ...w.stones]) {
      const v = x.variation;
      if (v) for (let a = 0; a < v.ids.length; a++) for (let b = a + 1; b < v.ids.length; b++) corrs.push(v.corr[a][b]);
    }
    for (const p of w.plants.filter(p => p.form === 'tree')) {
      const base = p.name.split(' ').pop();
      nameCounts.set(base, (nameCounts.get(base) ?? 0) + 1);
    }
  }
  console.log(`Worlds sampled: ${n}${args.preset ? ` (preset ${args.preset})` : ''}\n`);
  console.log('Starter needs met:');
  for (const [k, v] of Object.entries(tally)) console.log(`  ${(100 * v / n).toFixed(0).padStart(3)}%  ${k}`);
  console.log(`  ${(100 * allMet / n).toFixed(0).padStart(3)}%  ALL needs met\n`);
  console.log(`Mean archetypes per world (plants + animals): ${(species / n).toFixed(1)}`);
  console.log(`Mean fraction of plants with a severely toxic raw part: ${(toxicFrac / n).toFixed(2)}`);
  console.log(`Worlds with a deadly lookalike: ${(100 * lookalike / n).toFixed(0)}%`);
  const abs = corrs.map(Math.abs);
  const frac = t => (100 * abs.filter(x => x >= t).length / abs.length).toFixed(0);
  console.log(`Within-archetype trait correlations: ${corrs.length} pairs; |r| ≥ 0.2: ${frac(0.2)}%, ≥ 0.4: ${frac(0.4)}%, ≥ 0.6: ${frac(0.6)}%`);
  console.log(`Distinct tree base names: ${nameCounts.size}; most common: ${[...nameCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ')}\n`);
  console.log('Process network, share of worlds where each item is reachable from bare hands:');
  for (const [k, v] of Object.entries(reach).sort((a, b) => a[1] - b[1]).filter(([, v]) => v < n)) console.log(`  ${(100 * v / n).toFixed(0).padStart(3)}%  ${ITEMS[k].name}`);
  console.log(`  (all other ${Object.values(reach).filter(v => v === n).length} items: 100%)\n`);
  console.log('Biomes:');
  for (const [k, v] of Object.entries(biomes).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
}
