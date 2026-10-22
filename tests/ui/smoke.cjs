const STEPS = Number(process.env.SMOKE_STEPS ?? 100); // random clicks per world (was 250; set SMOKE_STEPS for a longer soak)
const { JSDOM } = require('jsdom');
const { strikeOut, DIRS } = require('./tap-map.cjs');
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
for (const seed of ['pig-rock', 'a', 'i', 'h']) {
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.addEventListener('error', e => errors.push(e.message));
  w.Element.prototype.scrollIntoView = () => {};
  const d = w.document;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  (async () => {
    d.querySelector('#seed').value = seed;
    if (seed === 'pig-rock') d.querySelector('#preset').value = 'temperate-woodland';
    d.querySelector('#check').click();
    for (let k = 0; k < 50 && !d.querySelector('#begin'); k++) await wait(100); // the world check takes a moment
    d.querySelector('#begin').click();
    let rnd = 1;
    const rand = n => { rnd = (rnd * 16807) % 2147483647; return rnd % n; };
    const prefer = ['[data-craft="drill"][data-mode="until"]', '[data-craft]', '[data-gather]', '[data-here="survey"]', '[data-here="poke"]', '[data-here="scan"]', '[data-here="look"]', '[data-look]', '[data-here="collect"]', '[data-pk]', '[data-inspect]', '[data-here="inspect"]', '[data-here="drink"]', '[data-eat]', '[data-think]', '[data-test]', '[data-hike]', '[data-here="follow"]', '[data-follow]', '[data-here="lookout"]', '[data-hike]', '[data-here="hut"]', '[data-here="feed"]', '[data-here="make"]', '[data-here="rest"]', '[data-rest]'];
    for (let step = 0; step < STEPS; step++) {
      const opts = prefer.flatMap(sel => [...d.querySelectorAll(sel)].filter(b => !b.disabled));
      if (!opts.length) break;
      // mostly explore the list in priority-weighted random order
      const b = opts[rand(Math.min(opts.length, 8 + rand(opts.length)))];
      try { b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); } catch (e) { errors.push(`${b.outerHTML.slice(0, 60)}: ${e.message}`); }
      // now and then pick a spot on the map and go there (drop a pin, tap it)
      if (step % 10 === 9) try { strikeOut(w, d, Object.keys(DIRS)[rand(8)], 6 + rand(14)); } catch (e) { errors.push(`picking a spot: ${e.message}`); }
      // occasionally change a slot selection
      const sels = [...d.querySelectorAll('select[data-slot]')];
      if (sels.length && rand(5) === 0) { const s = sels[rand(sels.length)]; if (s.options.length) { s.selectedIndex = rand(s.options.length); s.dispatchEvent(new w.Event('change', { bubbles: true })); } }
    }
    const entries = [...d.querySelectorAll('.entry')];
    const ms = [...d.querySelectorAll('.entry.milestone')].map(e => e.textContent.replace(/^\d\d:\d\d/, ''));
    console.log(`${seed}: ${errors.length ? 'ERRORS: ' + [...new Set(errors)].slice(0, 5).join(' | ') : 'no errors'}; ${d.querySelector('#when').textContent}; ${entries.length} journal entries; milestones: ${ms.join(', ') || 'none'}`);
  })();
}
