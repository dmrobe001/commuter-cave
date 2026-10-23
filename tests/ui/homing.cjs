// Regression: heading for water I've heard or seen ends in the water, where I can drink, not short of
// it or across it; nothing I've noticed is drawn as a landmark on the spot where I stand; tapping a
// stream on the map ends in it or says why not. Played without drawing; the map is read as data.
// Usage: node tests/ui/homing.cjs [seed ...]
const { game } = require('./drive.cjs');
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['wgxdd', 'pig-rock', 'c', 'm', 'adzsb', 'h', 'a', 'i', 'q', 'z'];

(async () => {
  const fails = [];
  let trips = 0, wet = 0, streamTaps = 0;
  for (const seed of seeds) {
    const g = await game(seed);
    const onTop = () => { // a landmark marker within a cell of where I stand
      const m = g.map(), v = m.nodes.find(v => v.kind === 'sus' && v.drawn && Math.hypot(v.x - m.here.x, v.y - m.here.y) <= 1);
      return v ? v.name : null;
    };
    g.act({ here: 'scan' });
    for (let n = 0; n < 6; n++) {
      const t = g.map().targets.find(t => t.kind === 'sus' && /lake|stream|brook|river|rapids/.test(t.name));
      if (!t) { // nothing heard: rain or fog may be drowning it out, so wait a couple of hours and listen again
        g.act({ rest: '2' }); if (g.can('scan')) g.act({ here: 'scan' }); continue;
      }
      const name = t.name.replace(/^the /, ''), now = g.hike(t.hike);
      trips++;
      if (now.some(l => new RegExp(`Found the ${name}\\b`).test(l))) {
        wet++;
        if (!g.can('drink')) fails.push(`${seed}: found ${name} but can't drink here. ${now.join(' | ')}`);
      }
      const top = onTop(); if (top) fails.push(`${seed}: a landmark drawn where I stand: ${top}`);
      // and back to a place by water I've been to, as in the report (the water heard on arrival was drawn on top of me)
      const back = g.map().targets.find(t => t.kind === 'site' && /lake|stream|brook|river/.test(t.name));
      if (back) { g.hike(back.hike); const top2 = onTop(); if (top2) fails.push(`${seed}: back at ${back.name}, a landmark drawn where I stand: ${top2}`); }
    }
    // streams on the map: heading for one ends in the water (where I can drink) or says why not
    for (let n = 0; n < 3; n++) {
      const t = g.map().targets.find(t => t.kind === 'stream');
      if (!t) break;
      const now = g.hike(t.hike).join(' | ');
      streamTaps++;
      if (!g.can('drink') && !/doesn’t run this way|Didn’t reach|already/.test(now)) fails.push(`${seed}: headed for ${t.name} and ended dry, unexplained: ${now}`);
    }
    if (g.can('follow')) fails.push(`${seed}: Follow the water is still offered`);
    if (g.errs.length) fails.push(`${seed}: ${g.errs.join('; ')}`);
  }
  console.log(`homing: ${trips} hikes toward water, ${wet} found it; ${streamTaps} taps on streams`);
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('homing: all passed');
})();
