// Poking around: what a survey misses, then the same with a digging stick, then fire-hardening it.
// Usage: node tests/ui/poke-around.cjs [seed]
const { JSDOM } = require('jsdom');
const { strikeOut } = require('./tap-map.cjs');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document, errors = [];
w.addEventListener('error', e => errors.push(e.message));
const seed = process.argv[2] ?? 'c';
const label = x => x.getAttribute('aria-label') ?? x.textContent;
const click = (sel, re) => { const b = [...d.querySelectorAll(sel)].find(x => !x.disabled && (!re || re.test(label(x)))); if (b) b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !!b; };
const entries = () => [...d.querySelectorAll('.entry')].map(e => e.textContent);
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await wait(50);
  d.querySelector('#seed').value = seed; d.querySelector('#check').click();
  for (let k = 0; k < 50 && !d.querySelector('#begin'); k++) await wait(100);
  d.querySelector('#begin').click();
  const S = w.__hk.state();
  // go somewhere wooded, if we know of anywhere
  if (!click('[data-hike]', /wood|thicket/)) strikeOut(w, d, 'north');
  let n0 = entries().length;
  click('[data-here="survey"]');
  click('[data-here="poke"]');
  click('[data-here="poke"]');
  console.log('SURVEY THEN POKE (bare hands):\n' + entries().slice(n0).join('\n'));
  // make a digging stick from whatever wood is to hand
  for (const part of [/^Green shoot/, /^Dead wood/]) {
    click('[data-here="collect"]'); if (click('[data-pk="part"]', part)) click('.picker [data-gather]'); click('[data-pk="close"]');
  }
  click('[data-here="collect"]'); if (click('[data-pk="part"]', /^Fist-sized stone/)) click('.picker [data-gather]'); click('[data-pk="close"]');
  if (!S.inv.some(i => i.kind === 'stone' || i.kind === 'edge')) S.inv.push({ uid: S.uid++, name: 'stone, test', kind: 'stone', props: { hardness: 6, mass: 700 }, from: { name: 'test', id: null, part: 'cobble' }, notes: {} }); // no stone here: lend one
  if (!S.inv.some(i => i.kind === 'shoot' || i.kind === 'wood')) S.inv.push({ uid: S.uid++, name: 'dead wood, test', kind: 'wood', props: { density: 0.6, moisture: 0.12 }, from: { name: 'test', id: null, part: 'dead wood' }, notes: {} });
  click('[data-here="make"]');
  const made = click('[data-craft="digstick"]');
  const stick = S.inv.find(i => i.kind === 'diggingstick');
  console.log(`\nmade a digging stick: ${made}${stick ? `, hardness ${stick.props.hardness.toFixed(2)}` : ''}`);
  if (stick) {
    n0 = entries().length;
    click('[data-pk="close"]');
    click('[data-here="poke"]'); click('[data-here="poke"]');
    console.log('POKE WITH THE STICK:\n' + entries().slice(n0).join('\n'));
    S.sites[S.here].fireUntil = (S.day - 1) * 24 + S.t + 5; // pretend a fire is burning here
    click('[data-here="make"]'); click('[data-craft="harden"][data-mode="careful"]');
    console.log(`after careful fire-hardening: hardness ${stick.props.hardness.toFixed(2)}; ${entries().slice(-1)[0]}`);
  }
  console.log('\nCARRYING: ' + [...d.querySelectorAll('#pack .item-name')].map(x => x.textContent).join(', '));
  console.log('errors:', errors.length ? errors : 'none');
})();
