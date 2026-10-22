// Regression: chasing a landmark must end. Hikes toward one suspected landmark, again and again, until
// it is found or comes off the map; fails if the character stands still for three hikes in a row while
// it is still on the map (the old "probably further on" estimate made ever-shorter hops that ended on
// the same place). Also replays a reported record that got stuck that way, then keeps going.
// Usage: node tests/ui/no-chase.cjs [seed ...]
const { JSDOM } = require('jsdom');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['adzsb', 'pig-rock', 'c', 'm', 'wgxdd'];
// the reported game: a hill one cell off, tapped again and again (its first 13 actions)
const REPORTED = { game: 'hands-and-knowledge', seed: 'adzsb', preset: '', actions: ['u1', 'u2', 'u5', 'u3', 'scan', 'u4', 'scan', 'u6', 'hex-35', 'u6', 'scan', 'u15', 'u6'].map(a => ({ d: a === 'scan' ? { here: 'scan' } : { hike: a } })) };

async function page() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window, errs = [];
  w.addEventListener('error', e => errs.push(e.message));
  await wait(50);
  return { w, d: w.document, errs };
}
const here = d => { const c = d.querySelector('.mapsvg .node.here circle'); return c ? `${c.getAttribute('cx')},${c.getAttribute('cy')}` : ''; };
const node = (d, key) => d.querySelector(`.mapsvg [data-hike="${key}"]`);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

// Hike toward `key` until it's off the map or `tries` run out; returns a complaint, or null.
async function chase(w, d, key, tries = 6) {
  let still = 0;
  for (let k = 0; k < tries && node(d, key); k++) {
    const before = here(d);
    click(w, node(d, key));
    still = here(d) === before && node(d, key) ? still + 1 : 0;
    if (still >= 3) return `stuck chasing ${key}: three hikes without moving. The journal ended:\n    ${[...d.querySelectorAll('.entry')].slice(-6).map(e => e.textContent).join('\n    ')}`;
  }
  return null;
}

(async () => {
  const fails = [];
  { // the reported record
    const { w, d, errs } = await page();
    d.querySelector('#replay-text').value = JSON.stringify(REPORTED);
    d.querySelector('#replay').click();
    await wait(300);
    const target = node(d, 'u6') ? 'u6' : null;
    const why = target && await chase(w, d, target);
    console.log(`reported record: ${target ? (why ?? `the hill is ${node(d, 'u6') ? 'still on the map' : 'found or lost'} after more hikes`) : 'the hill was already found or lost'}`);
    if (why) fails.push(`reported record: ${why}`);
    if (errs.length) fails.push(`reported record: ${errs.join('; ')}`);
  }
  for (const seed of seeds) {
    const { w, d, errs } = await page();
    d.querySelector('#seed').value = seed; d.querySelector('#check').click();
    for (let k = 0; k < 50 && !d.querySelector('#begin'); k++) await wait(100);
    d.querySelector('#begin').click();
    click(w, d.querySelector('[data-here="scan"]'));
    const chased = [];
    for (let n = 0; n < 4; n++) {
      const sus = [...d.querySelectorAll('.mapsvg .node.sus[data-hike]')].map(g => g.dataset.hike).find(k => !chased.includes(k));
      if (!sus) break;
      chased.push(sus);
      const why = await chase(w, d, sus);
      if (why) fails.push(`${seed}: ${why}`);
      const s = d.querySelector('[data-here="scan"]:not([disabled])'); if (s) click(w, s);
    }
    console.log(`${seed}: chased ${chased.join(', ')}; ${chased.filter(k => !node(d, k)).length} found or lost`);
    if (errs.length) fails.push(`${seed}: ${errs.join('; ')}`);
  }
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('no-chase: all passed');
})();
