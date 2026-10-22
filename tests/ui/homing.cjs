// Regression: heading for water I've heard or seen ends in the water, where I can drink, not short of
// it or across it; and nothing I've noticed is drawn as a landmark on the spot where I stand.
// Usage: node tests/ui/homing.cjs [seed ...]
const { JSDOM } = require('jsdom');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['wgxdd', 'pig-rock', 'c', 'm', 'adzsb', 'h', 'a', 'i', 'q', 'z'];

(async () => {
  const fails = [];
  let trips = 0, wet = 0;
  for (const seed of seeds) {
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window, d = w.document, errs = [];
    w.addEventListener('error', e => errs.push(e.message));
    await wait(50);
    d.querySelector('#seed').value = seed; d.querySelector('#check').click();
    for (let k = 0; k < 50 && !d.querySelector('#begin'); k++) await wait(100);
    d.querySelector('#begin').click();
    const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const entries = () => [...d.querySelectorAll('.entry')].map(e => e.textContent);
    const onTop = () => { // a landmark marker within a cell of where I stand
      const h = d.querySelector('.mapsvg .node.here circle'); if (!h) return null;
      const hx = +h.getAttribute('cx'), hy = +h.getAttribute('cy');
      const g = [...d.querySelectorAll('.mapsvg .node.sus')].find(g => { const c = g.querySelector('circle'); return Math.hypot(+c.getAttribute('cx') - hx, +c.getAttribute('cy') - hy) <= 1; });
      return g ? g.getAttribute('aria-label') : null;
    };
    click(d.querySelector('[data-here="scan"]'));
    for (let n = 0; n < 6; n++) {
      const g = [...d.querySelectorAll('.mapsvg .node.sus[data-hike]')].find(g => /lake|stream|brook|river|rapids/.test(g.getAttribute('aria-label')));
      if (!g) { const s = d.querySelector('[data-here="scan"]:not([disabled])'); if (s) click(s); continue; }
      const name = g.querySelector('text')?.textContent.replace(/\?$/, ''), before = entries().length;
      click(g);
      const now = entries().slice(before);
      trips++;
      if (now.some(t => new RegExp(`Found the ${name}\\b`).test(t))) {
        wet++;
        if (!d.querySelector('[data-here="drink"]')) fails.push(`${seed}: found ${name} but can't drink here. ${now.join(' | ')}`);
      }
      const top = onTop(); if (top) fails.push(`${seed}: a landmark drawn where I stand: ${top}`);
      // and back to a place by water I've been to, as in the report (the water heard on arrival was drawn on top of me)
      const back = [...d.querySelectorAll('.mapsvg .node.site[data-hike]')].find(g => /lake|stream|brook|river/.test(g.getAttribute('aria-label')));
      if (back) { click(back); const top2 = onTop(); if (top2) fails.push(`${seed}: back at ${back.getAttribute('aria-label')}, a landmark drawn where I stand: ${top2}`); }
    }
    if (errs.length) fails.push(`${seed}: ${errs.join('; ')}`);
  }
  console.log(`homing: ${trips} hikes toward water, ${wet} found it`);
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('homing: all passed');
})();
