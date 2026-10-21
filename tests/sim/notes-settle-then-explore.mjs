import { generateWorld } from '../../src/generator.js';
import { newMemory, observeSite } from '../../src/notes.js';
const w = generateWorld('c', {});
const mem = newMemory();
const route = [...Array(10).fill(0).map((_, i) => ['glade', 'edge'][i % 2]), 'streambank', 'pond', 'outcrop', 'woodland', 'streambed'];
const present = new Set(w.environment.microhabitats.map(m => m.id));
route.filter(m => present.has(m)).forEach((micro, i) => {
  const out = observeSite(w, mem, { site: `n${i}`, micro, time: 'day' });
  if (i >= 8) console.log(`[${i + 1}] ${out.text}\n`);
});
console.log('aware:', mem.noveltyAware);
