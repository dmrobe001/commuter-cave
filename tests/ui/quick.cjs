// Quick UI check: one page, several worlds, every kind of action once, the map, the water milestone,
// and a short replay. Meant for the inner development loop (seconds, not minutes): it catches
// thrown errors and the regressions that have bitten before, not balance or prose.
// Usage: node tests/ui/quick.cjs
const { JSDOM } = require('jsdom');
const { strikeOut } = require('./tap-map.cjs');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const errors = [];
function page() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.addEventListener('error', e => errors.push(e.message));
  return { w: dom.window, d: dom.window.document };
}
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const tap = ({ w, d }, sel, re) => {
  const b = [...d.querySelectorAll(sel)].find(x => !x.disabled && (!re || re.test(x.getAttribute('aria-label') ?? x.textContent)));
  if (b) b.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return !!b;
};
const log = ({ w }) => w.__hk.state().log.map(e => e.text);

setTimeout(() => {
  const P = page(), S = () => P.w.__hk.state();

  // 1. an opening, and every action once
  P.w.__hk.start('c');
  check(log(P).length >= 3, 'opening wrote to the journal');
  for (const a of ['survey', 'poke', 'scan', 'inspect', 'collect', 'make', 'rest']) { tap(P, `[data-here="${a}"]`); tap(P, '[data-pk="close"]'); }
  tap(P, '[data-here="look"]'); tap(P, '[data-look="focus:food"]');
  check(/Looking for/.test(P.d.querySelector('[data-here="look"]').textContent), 'look stays active');
  tap(P, '[data-here="look"]');
  check(!/Looking for/.test(P.d.querySelector('[data-here="look"]').textContent), 'look stops on a second tap');
  tap(P, '[data-here="collect"]'); tap(P, '[data-pk="part"]'); tap(P, '.picker [data-gather]');

  // 2. the map: hike to a landmark and to unexplored ground; time labels lie along their lines
  const before = S().t;
  tap(P, '[data-hike]', /Head for the /);
  strikeOut(P.w, P.d, 'east');
  tap(P, '[data-maproutes]'); // routes are hidden until asked for
  check(S().t > before, 'hikes take time');
  check(S().sites.length >= 2, 'hikes make places');
  const labels = [...P.d.querySelectorAll('.etime')];
  check(labels.length && labels.every(t => /rotate/.test(t.getAttribute('transform'))), 'edge times are rotated');
  const landButton = () => P.d.querySelector('[data-mapland]')?.textContent ?? '';
  const landModes = [landButton()]; for (let k = 0; k < 3; k++) { tap(P, '[data-mapland]'); landModes.push(landButton()); }
  check(/seen/.test(landModes[0]) && /whole map/.test(landModes[1]) && /none/.test(landModes[2]) && landModes[3] === landModes[0], 'the land button cycles seen, whole map, none');

  // 3. the water milestone lands on reaching a heard stream (seed wgxdd, first suspect)
  P.d.querySelector('#replay-text').value = JSON.stringify({ game: 'hands-and-knowledge', seed: 'wgxdd', preset: '', actions: [{ d: { hike: 'u1' } }] });
  P.d.querySelector('#replay').click();
  const L = log(P), i = L.findIndex(t => /^Found water\./.test(t)), j = L.findIndex(t => /There’s water|Stream bank|Gravel bar/.test(t));
  check(i >= 0 && i <= j, 'water found on reaching the stream');

  // 3b. food: gather, pound, soak or leach, taste, eat; the exact-properties view
  // (back in the wood where I woke, which has berries; the stream bed has nothing to eat)
  tap(P, '[data-hike]', /where I woke/);
  const foodBefore = S().inv.filter(i => i.kind === 'food').length;
  tap(P, '[data-here="collect"]'); if (tap(P, '[data-pk="part"]', /to eat/)) tap(P, '.picker [data-gather]'); tap(P, '[data-pk="close"]');
  tap(P, '[data-here="collect"]'); if (tap(P, '[data-pk="part"]', /stone/i)) tap(P, '.picker [data-gather]'); tap(P, '[data-pk="close"]');
  const food = S().inv.find(i => i.kind === 'food');
  check(food && food.props.chem && food.props.mass > 0, 'food carries its make-up and mass');
  if (food) {
    tap(P, '[data-here="make"]');
    tap(P, '[data-craft="pound"]'); tap(P, '[data-craft="leach"][data-mode="2"]') || tap(P, '[data-craft="soak"][data-mode="2"]');
    check(/\(/.test(food.name), 'preparation is recorded in the name');
    tap(P, '[data-pk="close"]');
    tap(P, '[data-test]', /Staged taste/);
    const cb = P.d.querySelector('[data-toggle="props"]'); cb.checked = true; cb.dispatchEvent(new P.w.Event('change', { bubbles: true }));
    check(P.d.querySelectorAll('ul.exact li').length > 0 && /net -?\d+ kcal/.test(P.d.querySelector('ul.exact').textContent), 'exact properties shown');
    check(typeof food.props.germs === 'number' && typeof S().body.germs === 'number', 'germ loads tracked');
    if (tap(P, '[data-here="make"]')) { tap(P, '[data-craft="wash"]'); tap(P, '[data-pk="close"]'); }
    tap(P, '[data-here="washhands"]');
    const e0 = S().body.energy; tap(P, `[data-eat="${food.uid}"]`);
    check(S().body.energy !== e0 || S().body.gut > 0, 'eating digests');
  }

  // 4. a short replay reproduces a game
  P.w.__hk.start('pig-rock');
  let x = 7; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 20; k++) {
    const opts = [...P.d.querySelectorAll('[data-here], [data-gather], [data-pk], [data-hike], [data-look], [data-rest]')].filter(b => !b.disabled);
    opts[Math.floor(rnd() * opts.length)]?.dispatchEvent(new P.w.MouseEvent('click', { bubbles: true }));
  }
  tap(P, '[data-record="copy"]');
  const rec = P.d.querySelector('#record-text').value, sa = S();
  const Q = page();
  Q.d.querySelector('#replay-text').value = rec;
  Q.d.querySelector('#replay').click();
  const sb = Q.w.__hk.state(), strip = s => s.log.map(e => e.text).filter(t => !/Replayed a game record|Copied the game record/.test(t)).join('\n');
  check(strip(sa) === strip(sb) && sa.t === sb.t && sa.day === sb.day, 'replay reproduces the game');

  for (const e of errors) fails.push(`page error: ${e}`);
  console.log(fails.length ? `quick: ${fails.length} problem(s)\n  ${fails.join('\n  ')}` : 'quick: all checks passed');
  process.exitCode = fails.length ? 1 : 0;
}, 50);
