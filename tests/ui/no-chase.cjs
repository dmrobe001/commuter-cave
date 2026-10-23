// Regression: chasing a landmark must end. Hikes toward one suspected landmark, again and again, until
// it is found or comes off the map; fails if the character stands still for three hikes in a row while
// it is still on the map (the old "probably further on" estimate made ever-shorter hops that ended on
// the same place). Also replays a reported record that got stuck that way, then keeps going. Played
// without drawing; the map is read as data.
// Usage: node tests/ui/no-chase.cjs [seed ...]
const { game } = require('./drive.cjs');
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['adzsb', 'pig-rock', 'c', 'm', 'wgxdd'];
// the reported game: a hill one cell off, tapped again and again (its first 13 actions)
const REPORTED = { game: 'hands-and-knowledge', seed: 'adzsb', preset: '', actions: ['u1', 'u2', 'u5', 'u3', 'scan', 'u4', 'scan', 'u6', 'hex-35', 'u6', 'scan', 'u15', 'u6'].map(a => ({ d: a === 'scan' ? { here: 'scan' } : { hike: a } })) };

const onMap = (g, key) => g.map().targets.some(t => t.hike === key);
// Hike toward `key` until it's off the map or `tries` run out; returns a complaint, or null.
function chase(g, key, tries = 6) {
  let still = 0;
  for (let k = 0; k < tries && onMap(g, key); k++) {
    const before = g.here();
    g.hike(key);
    const now = g.here();
    still = now.x === before.x && now.y === before.y && onMap(g, key) ? still + 1 : 0;
    if (still >= 3) return `stuck chasing ${key}: three hikes without moving. The journal ended:\n    ${g.journal().slice(-6).join('\n    ')}`;
  }
  return null;
}

(async () => {
  const fails = [];
  { // the reported record
    const g = await game(null, { record: REPORTED });
    const target = onMap(g, 'u6') ? 'u6' : null;
    const why = target && chase(g, target);
    console.log(`reported record: ${target ? (why ?? `the hill is ${onMap(g, 'u6') ? 'still on the map' : 'found or lost'} after more hikes`) : 'the hill was already found or lost'}`);
    if (why) fails.push(`reported record: ${why}`);
    if (g.errs.length) fails.push(`reported record: ${g.errs.join('; ')}`);
  }
  for (const seed of seeds) {
    const g = await game(seed);
    g.act({ here: 'scan' });
    const chased = [];
    for (let n = 0; n < 4; n++) {
      const sus = g.map().targets.filter(t => t.kind === 'sus').map(t => t.hike).find(k => !chased.includes(k));
      if (!sus) break;
      chased.push(sus);
      const why = chase(g, sus);
      if (why) fails.push(`${seed}: ${why}`);
      if (g.can('scan')) g.act({ here: 'scan' });
    }
    console.log(`${seed}: chased ${chased.join(', ')}; ${chased.filter(k => !onMap(g, k)).length} found or lost`);
    if (g.errs.length) fails.push(`${seed}: ${g.errs.join('; ')}`);
  }
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('no-chase: all passed');
})();
