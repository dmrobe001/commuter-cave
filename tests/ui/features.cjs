// Lakes and cliffs on the map: after a fixed itinerary of hikes and scans, the lakes and cliffs I've
// seen are drawn (lakes shaded, cliffs as ticked lines), each labelled at most once, by what it is;
// heading for a lake ends where I can drink or says why not, and heading for a cliff ends by it or says
// why not. The itinerary is played without drawing; the map is drawn once, to check its labels.
// Usage: node tests/ui/features.cjs [seed ...]
const { game } = require('./drive.cjs');
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['m', 'pig-rock', 'c', 'h'];

(async () => {
  const fails = [];
  let lakes = 0, cliffs = 0;
  for (const seed of seeds) {
    const g = await game(seed);
    g.act({ here: 'scan' });
    for (let k = 1; k <= 20; k++) { const o = g.map().targets; if (o.length) g.hike(o[(k * 7) % o.length].hike); if (k % 2 && g.can('scan')) g.act({ here: 'scan' }); }
    const d = g.draw();
    const L = d.querySelectorAll('.mapsvg .feature.lake').length, C = d.querySelectorAll('.mapsvg .feature.cliff').length;
    lakes += L; cliffs += C;
    const names = [...d.querySelectorAll('.mapsvg .flabel:not(.stream)')].map(t => t.textContent);
    // each lake or cliff labelled at most once, by what it is (no modifiers: "lake", "cliff")
    const drawn = { lake: L, cliff: C, crossing: d.querySelectorAll('.mapsvg .crossing').length, 'where I crossed': d.querySelectorAll('.mapsvg .crossed').length };
    for (const [kind, n] of Object.entries(drawn)) if (names.filter(t => t === kind).length > n) fails.push(`${seed}: more "${kind}" labels than markers drawn: ${names.join(', ')}`);
    for (const t of names) if (!(t in drawn)) fails.push(`${seed}: a feature label that isn't just what it is: "${t}"`);
    if (d.querySelector('.mapsvg .feature.cliff') && !d.querySelector('.mapsvg .feature.cliff .tick')) fails.push(`${seed}: a cliff without ticks`);
    for (const kind of ['lake', 'cliff']) {
      const t = g.map().targets.find(t => t.kind === kind);
      if (!t) continue;
      const said = g.hike(t.hike).join(' | ');
      const ok = kind === 'lake' ? g.can('drink') || /Didn’t reach/.test(said) : /Pushed toward/.test(said);
      if (!ok) fails.push(`${seed}: headed for the ${kind}: ${said}`);
    }
    console.log(`${seed}: ${L} lake pieces, ${C} cliffs drawn; named ${names.join(', ')}`);
    if (g.errs.length) fails.push(`${seed}: ${g.errs.join('; ')}`);
  }
  if (!lakes || !cliffs) fails.push(`over all seeds, ${lakes} lake pieces and ${cliffs} cliffs drawn: expected some of each`);
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('features: all passed');
})();
