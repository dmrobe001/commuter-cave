// Regression: a reported game (seed hbgk9). Up a stream to its spring, then down to where it runs into
// a lake. It had two places marked "spring" for one spring, a downstream arrow at the lake's edge that
// went nowhere, and a guessed stream link drawn across the lake. Recreated from map positions (a record
// of the original would drift as the rules change): onto the stream below the spring, follow it up
// until it stops at the spring, then down until it stops at the lake. Checks: one spring, marked on
// the spring's own cell; the mouth marked; no follow arrow that goes nowhere; the lake drawn. And a
// second reported game (seed gbn2f): getting round a lake, and a fork marked off the lines (below).
const { JSDOM } = require('jsdom');
const { tidiness } = require('./stream-lines.cjs');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document, errors = [], fails = [];
w.addEventListener('error', e => errors.push(e.message));
const click = el => el?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const at = () => { const c = d.querySelector('.mapsvg .node.here circle'); return `${c?.getAttribute('cx')},${c?.getAttribute('cy')}`; };
const lines = () => [...d.querySelectorAll('.entry')].map(e => e.textContent);
// follow the stream one way until a stage says it stopped for `stop`; every offered arrow must move me
function follow(way, stop) {
  for (let k = 0; k < 8; k++) {
    const arrow = [...d.querySelectorAll('.mapsvg .follow')].find(g => new RegExp(way).test(g.getAttribute('aria-label')));
    if (!arrow) return false;
    const before = at(), n = lines().length;
    click(arrow);
    if (at() === before) fails.push(`"${arrow.getAttribute('aria-label')}" went nowhere`);
    if (lines().slice(n).some(t => stop.test(t))) return true;
  }
  return false;
}
setTimeout(() => {
  d.querySelector('#replay-text').value = JSON.stringify({ game: 'hands-and-knowledge', seed: 'hbgk9', preset: '', actions: [{ d: { hike: 'go:69_66' } }] });
  d.querySelector('#replay').click();
  if (!follow('upstream', /spring|source/)) fails.push(`never followed up to the spring: ${lines().slice(-3).join(' | ')}`);
  click(d.querySelector('[data-here="scan"]'));
  if (!follow('downstream', /runs into a lake/)) fails.push(`never followed down to the lake: ${lines().slice(-3).join(' | ')}`);
  const springs = [...d.querySelectorAll('.mapsvg .node.spring')].map(g => g.getAttribute('aria-label'));
  if (springs.length !== 1) fails.push(`expected one spring, found ${springs.length}: ${springs.join('; ')}`);
  else if (d.querySelector('.mapsvg .node.spring circle').getAttribute('cx') !== '71') fails.push('the spring is marked off its own cell (71,59)');
  const here = d.querySelector('.mapsvg .node.here')?.getAttribute('aria-label') ?? '';
  if (!/mouth/.test(here)) fails.push(`expected to be at the stream's mouth, but here is: ${here}`);
  if ([...d.querySelectorAll('.mapsvg .follow')].some(g => /downstream/.test(g.getAttribute('aria-label')))) fails.push('a downstream arrow is offered where the stream runs into the lake');
  if (!d.querySelector('.mapsvg .feature.lake circle')) fails.push('the lake is not drawn');

  // A second reported game (seed gbn2f): at a stream's mouth on a lake, taps on the lake and on things
  // across it didn't move me. Now: the lake says I'm on its shore already; a spot across the water is
  // walked round to; a spot in the water gets as near as the shore allows.
  const go = (...hikes) => { d.querySelector('#replay-text').value = JSON.stringify({ game: 'hands-and-knowledge', seed: 'gbn2f', preset: '', actions: hikes.map(hike => ({ d: { hike } })) }); d.querySelector('#replay').click(); return at(); };
  if (go('go:67_53') !== '67,53') fails.push(`gbn2f: didn't reach the mouth at 67,53 (at ${at()})`);
  const lake = d.querySelector('.mapsvg .feature.lake'), n = lines().length;
  if (lake) { click(lake); if (!lines().slice(n).some(t => /shore of .* already/.test(t)) && at() === '67,53') fails.push(`gbn2f: tapping the lake from its shore neither moved me nor said I was there: ${lines().slice(n).join(' | ')}`); }
  for (const [x, y] of [[62, 53], [64, 47]]) { const end = go('go:67_53', `go:${x}_${y}`); if (end !== `${x},${y}`) fails.push(`gbn2f: a spot across the lake (${x},${y}) wasn't reached; ended at ${end}`); }
  const wet = go('go:67_53', 'go:66_51'), said = lines().slice(-4).join(' | ');
  if (wet === '67,53' && !/as near as I can get/.test(said)) fails.push(`gbn2f: a spot in the lake gave neither a move nor an explanation: ${said}`);
  // gbn2f again: a stream with two branches out of a lake, followed from the falls up to the fork, up
  // each branch to its outlet, and down to the mouth. The fork was marked two cells off where the
  // lines met (fixes within two cells of each other were taken for one). Now: one fix per cell, every
  // cell of a followed stretch on the line, so the lines run unbroken from each outlet to the mouth
  // and meet at the fork.
  go('go:70_54', 'follow:up:71_55', 'follow:up:71_56', 'go:71_55', 'follow:up:72_56', 'go:71_55', 'follow:down', 'follow:down');
  const tidy = tidiness(d);
  fails.push(...tidy.bad.map(b => `gbn2f: ${b}`));
  if (!/mouth/.test(d.querySelector('.mapsvg .node.here')?.getAttribute('aria-label') ?? '')) fails.push(`gbn2f: followed down from the fork but didn't reach the mouth (at ${at()})`);
  const fork = d.querySelector('.mapsvg .node.site.fork circle');
  if (!fork || `${fork.getAttribute('cx')},${fork.getAttribute('cy')}` !== '71,55') fails.push(`gbn2f: expected the fork marked at 71,55, found ${fork ? `${fork.getAttribute('cx')},${fork.getAttribute('cy')}` : 'none'}`);
  for (const end of ['71,58', '73,57', '67,53']) if (!tidy.deg.has(end)) fails.push(`gbn2f: no solid line reaches ${end}`);
  if (tidy.lines.length !== 2 || tidy.deg.get('71,55') !== 3) fails.push(`gbn2f: expected two solid lines meeting at the fork (one from an outlet down to the mouth, the other branch ending at the fork), got ${tidy.lines.length}, ${tidy.deg.get('71,55') ?? 0} ends at the fork`);
  // A third (seed hmfqm): a stream followed up from its falls to its spring had a kink where it turned
  // sharply between drawn points (the curve arrived one way and left another). Now one direction per point.
  d.querySelector('#replay-text').value = JSON.stringify({ game: 'hands-and-knowledge', seed: 'hmfqm', preset: '', actions: ['u1', 'scan', 'u2', 'go:56_49', 'go:78_55', 'u3', 'u3', 'follow:up:82_50', 'follow:up:86_47', 'follow:up:93_45', 'follow:up:99_42', 'follow:up:104_39', 'follow:up:108_34'].map(a => ({ d: a === 'scan' ? { here: 'scan' } : { hike: a } })) });
  d.querySelector('#replay').click();
  if (!/spring/.test(d.querySelector('.mapsvg .node.here')?.getAttribute('aria-label') ?? '')) fails.push(`hmfqm: didn't follow up to the spring (at ${at()})`);
  fails.push(...tidiness(d).bad.map(b => `hmfqm: ${b}`));
  if (errors.length) fails.push(...errors);
  console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'reported (hbgk9, gbn2f, hmfqm): all passed');
  if (fails.length) process.exitCode = 1;
}, 50);
