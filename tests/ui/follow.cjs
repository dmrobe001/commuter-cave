// Following a stream in stages from the map: at a stream, the arrows by me follow it about a quarter of
// an hour downstream or up a branch, stopping early at a fork, waterfall, spring, lake, source or the
// edge of the land; the stretch walked is drawn solid; places along a stream that are nothing in
// their own right get no marker once I've moved on; the solid lines step cell to cell and meet only at
// marked forks. Played without drawing; the map is read as data (mapData).
// Usage: node tests/ui/follow.cjs [seed ...]
const { game, toward } = require('./drive.cjs');
const { tidyData } = require('./stream-lines.cjs');
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['wgxdd', 'a', 'pig-rock', 'm', 'h'];

(async () => {
  const fails = [];
  let stages = 0, stops = {};
  for (const seed of seeds) {
    const g = await game(seed);
    const followArrows = () => g.map().follows.filter(o => o.key.startsWith('follow:'));
    g.act({ here: 'scan' });
    // get to some water: a stream on the map, else a heard one, else strike out
    for (let k = 0; k < 6 && !followArrows().length; k++) {
      const m = g.map(), t = m.targets.find(t => t.kind === 'stream') ?? m.targets.find(t => t.kind === 'sus' && /brook|stream|river/.test(t.name));
      g.hike(t ? t.hike : toward(m.here, ['north', 'east', 'south'][k % 3]));
    }
    if (!followArrows().length) { console.log(`${seed}: never got to a stream`); continue; }
    for (let k = 0; k < 6; k++) {
      const arrows = followArrows();
      if (!arrows.length) break;
      const a = arrows.find(o => (k < 3 ? /downstream/ : /upstream/).test(o.say)) ?? arrows[0];
      const before = g.here(), said = g.hike(a.key).join(' | ');
      const m = said.match(/Followed .+? (downstream|upstream) for [^,.]+(?:, ([^.]+))?\./);
      if (!m) { fails.push(`${seed}: took "${a.say}"; no "Followed …" line: ${said}`); continue; }
      stages++;
      const why = m[2] ?? 'a quarter of an hour';
      stops[why] = (stops[why] ?? 0) + 1;
      const now = g.here();
      if (now.x === before.x && now.y === before.y && !/source|edge of a lake|dare/.test(why)) fails.push(`${seed}: followed but didn't move: ${said}`);
    }
    const map = g.map();
    if (!map.streams.some(t => t.lines.some(l => l.known))) fails.push(`${seed}: followed a stream but no stretch is drawn solid`);
    fails.push(...tidyData(map).bad.map(b => `${seed}: ${b}`)); // followed stretches: unbroken, meeting at forks
    // plain stream stops I've left are not drawn as places (forks, falls, springs and the start are)
    const plain = map.nodes.filter(v => v.drawn && v.kind === 'site' && !v.here && /gravel bar|stream bank/.test(v.name) && !/where I woke/.test(v.name));
    if (plain.length) console.log(`${seed}: still marked by water: ${plain.map(v => v.name).join('; ')} (fine only if a fork, falls or spring)`);
    if (g.errs.length) fails.push(`${seed}: ${g.errs.join('; ')}`);
  }
  console.log(`follow: ${stages} stages; stopped: ${Object.entries(stops).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('follow: all passed');
})();
