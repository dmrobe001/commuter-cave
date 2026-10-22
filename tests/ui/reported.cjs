// Regression: a reported game (seed hbgk9). Up a stream to its spring, then down to where it runs into
// a lake. It had two places marked "spring" for one spring, a downstream arrow at the lake's edge that
// went nowhere, and a guessed stream link drawn across the lake. Recreated from map positions (a record
// of the original would drift as the rules change): onto the stream below the spring, follow it up
// until it stops at the spring, then down until it stops at the lake. Checks: one spring, marked on
// the spring's own cell; the mouth marked; no follow arrow that goes nowhere; the lake drawn. And a
// second reported game (seed gbn2f): getting round a lake (below).
const { JSDOM } = require('jsdom');
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
  if (errors.length) fails.push(...errors);
  console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'reported (hbgk9, gbn2f): all passed');
  if (fails.length) process.exitCode = 1;
}, 50);
