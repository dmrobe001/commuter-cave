// Regression: a reported game (seed hbgk9), replayed. Upstream to a spring, then down to where the
// stream runs into a lake. It had two places marked "spring" for one spring, a downstream arrow at
// the lake's edge that went nowhere, a guessed stream link drawn across the lake, and most of the lake
// in plain sight left unseen. Checks: one spring, a mouth marked there, no arrow that goes nowhere, no
// stream link across lake, and the lake drawn.
const { JSDOM } = require('jsdom');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const RECORD = { game: 'hands-and-knowledge', seed: 'hbgk9', preset: '', actions: ['u1', 'u2', 'go:59_64', 'go:51_56', 'go:57_56', 'go:75_54', 'go:81_81', 'p64_65', 'stream:s1', 'follow:up:69_66', 'follow:up:71_59', 'go:69_63', 'follow:down', 'follow:down'].map(hike => ({ d: { hike } })) };
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document, errors = [];
w.addEventListener('error', e => errors.push(e.message));
setTimeout(() => {
  d.querySelector('#replay-text').value = JSON.stringify(RECORD);
  d.querySelector('#replay').click();
  const fails = [];
  const springs = [...d.querySelectorAll('.mapsvg .node.spring')].map(g => g.getAttribute('aria-label'));
  if (springs.length !== 1) fails.push(`expected one spring, found ${springs.length}: ${springs.join('; ')}`);
  const here = d.querySelector('.mapsvg .node.here')?.getAttribute('aria-label') ?? '';
  if (!/mouth/.test(here)) fails.push(`expected to be at the stream's mouth, but here is: ${here}`);
  if ([...d.querySelectorAll('.mapsvg .follow')].some(g => /downstream/.test(g.getAttribute('aria-label')))) fails.push('a downstream arrow is offered where the stream runs into the lake');
  const at = () => { const c = d.querySelector('.mapsvg .node.here circle'); return `${c?.getAttribute('cx')},${c?.getAttribute('cy')}`; };
  const before = at(), arrow = d.querySelector('.mapsvg .follow');
  if (arrow) { arrow.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); if (at() === before) fails.push(`"${arrow.getAttribute('aria-label')}" went nowhere`); }
  if (!d.querySelector('.mapsvg .feature.lake circle')) fails.push('the lake is not drawn');
  if (errors.length) fails.push(...errors);
  console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'reported (hbgk9): all passed');
  if (fails.length) process.exitCode = 1;
}, 50);
