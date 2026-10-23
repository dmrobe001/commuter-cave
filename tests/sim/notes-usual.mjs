// Things met again aren't "the usual" (or "as expected", "nothing remarkable") until the character
// has started remarking on newness; before that they're "again", "more of those", "pretty common
// around here". Walks a few worlds' habitats over and over and checks the notes on either side of the
// point where newness starts being remarked on. Usage: node tests/sim/notes-usual.mjs
import { generateWorld } from '../../src/generator.js';
import { newMemory, observeSite } from '../../src/notes.js';
const EXPECTING = /The usual|More of the same|as expected|as you'd expect|nothing remarkable|Nothing new|Nothing I haven't seen/;
const AGAIN = / again\.|Seen before:|More of those|The common|pretty common around here/;
const seeds = process.env.QUICK ? ['c', 'm'] : ['c', 'm', 'pig-rock', 'gbn2f', 'hmfqm'];
const fails = [];
let early = 0, againEarly = 0, late = 0, usualLate = 0;
for (const seed of seeds) {
  const w = generateWorld(seed, {}), mem = newMemory();
  const micros = w.environment.microhabitats.map(m => m.id).filter(m => m !== 'lake');
  for (let i = 0; i < 60; i++) {
    const aware = !!mem.noveltyAware;
    const { text } = observeSite(w, mem, { site: `n${i}`, micro: micros[i % Math.min(3, micros.length)], time: 'day' });
    if (!aware) { early++; if (EXPECTING.test(text)) fails.push(`${seed} visit ${i + 1}, before newness is remarked on: "${text.match(EXPECTING)[0]}" in: ${text}`); if (AGAIN.test(text)) againEarly++; }
    else { late++; if (EXPECTING.test(text)) usualLate++; }
  }
}
console.log(`notes-usual: ${early} visits before newness was remarked on (${againEarly} with "again"-style phrases), ${late} after (${usualLate} with "the usual"-style phrases)`);
if (!againEarly) fails.push('no "again"-style phrases at all before newness is remarked on');
if (fails.length) { console.log('FAIL\n  ' + fails.slice(0, 8).join('\n  ')); process.exit(1); }
console.log('notes-usual: all passed');
