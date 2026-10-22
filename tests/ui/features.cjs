// Lakes and cliffs on the map: after a fixed itinerary of hikes and scans, the lakes and cliffs I've
// seen are drawn (lakes shaded, cliffs as ticked lines), each labelled at most once, by what it is; tapping a lake ends where I
// can drink or says why not, and tapping a cliff ends by it or says why not.
// Usage: node tests/ui/features.cjs [seed ...]
const { JSDOM } = require('jsdom');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['m', 'pig-rock', 'c', 'h'];

(async () => {
  const fails = [];
  let lakes = 0, cliffs = 0;
  for (const seed of seeds) {
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window, d = w.document, errs = [];
    w.addEventListener('error', e => errs.push(e.message));
    await wait(50);
    d.querySelector('#seed').value = seed; d.querySelector('#check').click();
    for (let k = 0; k < 50 && !d.querySelector('#begin'); k++) await wait(100);
    d.querySelector('#begin').click();
    const click = el => el?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const entries = () => [...d.querySelectorAll('.entry')].map(e => e.textContent);
    click(d.querySelector('[data-here="scan"]'));
    for (let k = 1; k <= 20; k++) { const o = [...d.querySelectorAll('.mapsvg [data-hike]')]; click(o[(k * 7) % o.length]); if (k % 2) click(d.querySelector('[data-here="scan"]:not([disabled])')); }
    const L = d.querySelectorAll('.mapsvg .feature.lake').length, C = d.querySelectorAll('.mapsvg .feature.cliff').length;
    lakes += L; cliffs += C;
    const names = [...d.querySelectorAll('.mapsvg .flabel:not(.stream)')].map(t => t.textContent);
    // each lake or cliff labelled at most once, by what it is (no modifiers: "lake", "cliff")
    const drawn = { lake: L, cliff: C, crossing: d.querySelectorAll('.mapsvg .crossing').length, 'where I crossed': d.querySelectorAll('.mapsvg .crossed').length };
    for (const [kind, n] of Object.entries(drawn)) if (names.filter(t => t === kind).length > n) fails.push(`${seed}: more "${kind}" labels than markers drawn: ${names.join(', ')}`);
    for (const t of names) if (!(t in drawn)) fails.push(`${seed}: a feature label that isn't just what it is: "${t}"`);
    if (d.querySelector('.mapsvg .feature.cliff') && !d.querySelector('.mapsvg .feature.cliff .tick')) fails.push(`${seed}: a cliff without ticks`);
    for (const kind of ['lake', 'cliff']) {
      const g = d.querySelector(`.mapsvg .feature.${kind}`);
      if (!g) continue;
      const n = entries().length;
      click(g);
      const said = entries().slice(n).join(' | ');
      const ok = kind === 'lake' ? !!d.querySelector('[data-here="drink"]') || /Didn’t reach/.test(said) : /Pushed toward/.test(said);
      if (!ok) fails.push(`${seed}: tapped ${g.getAttribute('aria-label')}: ${said}`);
    }
    console.log(`${seed}: ${L} lake pieces, ${C} cliffs drawn; named ${names.join(', ')}`);
    if (errs.length) fails.push(`${seed}: ${errs.join('; ')}`);
  }
  if (!lakes || !cliffs) fails.push(`over all seeds, ${lakes} lake pieces and ${cliffs} cliffs drawn: expected some of each`);
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('features: all passed');
})();
