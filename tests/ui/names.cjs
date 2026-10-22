// Names, crossings and shores (a batch of the player's ideas):
// - things are called what they are: every landmark and place label is a plain noun ("hill", "falls"),
//   except names given by me or earned by a stream;
// - a stretch of stream walked from end to end (here: outlet to fork, twice, then fork to mouth) gets a
//   name, written along it, and the fork at its head bears the name of the stretch below it;
// - an item's origin can be named, and the place then keeps a marker once I've left it;
// - a crossing (a ford, here) is noticed from the next cell, marked, and labelled "crossing";
// - where I crossed a stream keeps a marker until walking along the stream there joins it up;
// - a lake's shore can be walked in stages, either way round, and every stage moves me along it.
// Usage: node tests/ui/names.cjs
const { JSDOM } = require('jsdom');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document, errors = [], fails = [];
w.addEventListener('error', e => errors.push(e.message));
const click = el => el?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const lines = () => [...d.querySelectorAll('.entry')].map(e => e.textContent);
const at = () => { const c = d.querySelector('.mapsvg .node.here circle'); return `${c?.getAttribute('cx')},${c?.getAttribute('cy')}`; };
const play = (seed, actions) => { d.querySelector('#replay-text').value = JSON.stringify({ game: 'hands-and-knowledge', seed, preset: '', actions: actions.map(a => ({ d: typeof a === 'string' ? (a === 'scan' ? { here: 'scan' } : { hike: a }) : a })) }); d.querySelector('#replay').click(); };
const PLAIN = /^(hill|cliff|lake|falls|cascade|river|stream|brook|tree line|crossing|fork|spring|mouth|outlet|where I woke|wood|thicket|clearing|stream bank|gravel bar|marsh|rocks|scree|clay bank|deadfall|dead thing|sulfur smell|musky smell|smell|patch)\??$/;
setTimeout(async () => {
  // stretches named on seed gbn2f: up from the falls to the fork, up both branches to their outlets, down to the mouth
  play('gbn2f', ['go:70_54', 'follow:up:71_55', 'follow:up:71_56', 'go:71_55', 'follow:up:72_56', 'go:71_55', 'follow:down', 'follow:down']);
  const named = lines().filter(t => /walked all of this stretch/.test(t));
  if (named.length !== 3) fails.push(`gbn2f: expected three stretches walked end to end, got ${named.length}: ${named.join(' | ')}`);
  // zoom in on the river (as a wheel does; jsdom's map has no size, so tapAt's inversion applies) so the names fit
  { const svg = d.querySelector('.mapsvg'), [x, y, span] = svg.getAttribute('viewBox').split(' ').map(Number);
    svg.dispatchEvent(new w.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -600, clientX: (69 - x) / span - 0.5, clientY: (55 - y) / span - 0.5 }));
    await new Promise(r => setTimeout(r, 250)); }
  const segLabels = [...d.querySelectorAll('.mapsvg .flabel.stream')].map(t => t.textContent);
  if (!segLabels.length) fails.push('gbn2f: no stream name written along a stretch');
  if (segLabels.some(t => !/^[A-Z][a-z]+( [A-Z][a-z]+)* (Brook|Stream|River)( \d+)?$/.test(t))) fails.push(`gbn2f: odd stream names: ${segLabels.join(', ')}`);
  const below = (named.find(t => /from the fork to where it runs into the lake/.test(t)) ?? '').match(/(?:call it|more of) ([^.]+)\./)?.[1];
  const fork = d.querySelector('.mapsvg .node.site.fork')?.getAttribute('aria-label') ?? '';
  if (!below || !fork.includes(below)) fails.push(`gbn2f: the fork should bear the name of the stretch below it (${below}); its marker says: ${fork}`);
  const given = named.map(t => t.match(/(?:call it|more of) ([^.]+)\./)?.[1]).filter(Boolean); // stream names, from the journal
  for (const t of d.querySelectorAll('.mapsvg .node text')) if (!PLAIN.test(t.textContent) && !given.includes(t.textContent)) fails.push(`gbn2f: a label with a modifier: "${t.textContent}"`);

  // the walk up from the falls crossed water that the follows then walked along: no loose crossing left
  if (d.querySelector('.mapsvg .crossed')) fails.push(`gbn2f: a crossing still marked on its own after walking along the stream there: ${[...d.querySelectorAll('.mapsvg .crossed')].map(g => g.getAttribute('aria-label')).join('; ')}`);
  // a crossing not joined to the stream by any walking keeps its marker
  play('gbn2f', ['go:70_54', 'go:71_60']);
  if (!lines().some(t => /crossed the stream/.test(t))) fails.push('gbn2f: the walk from the falls to 71,60 should cross the stream');
  else if (!d.querySelector('.mapsvg .crossed')) fails.push('gbn2f: crossed a stream, but no marker where I crossed');

  // an item's origin named: the place keeps its marker after I leave
  play('gbn2f', ['go:70_54', { originOf: 'p70_54', nameTo: 'Damson corner' }, 'go:62_64']);
  if (![...d.querySelectorAll('.mapsvg .node.site')].some(g => /Damson corner/.test(g.getAttribute('aria-label')))) fails.push('gbn2f: a place named for an item\'s origin has no marker once I leave');
  // and the button is there for something collected
  play('gbn2f', ['go:70_54', 'scan']);
  click(d.querySelector('[data-here="survey"]'));
  click(d.querySelector('[data-here="collect"]'));
  click(d.querySelector('[data-pk="part"]'));
  click(d.querySelector('[data-gather]:not([disabled])'));
  click(d.querySelector('.tabs button[data-tab="pack"]') ?? d.querySelector('[data-tab="pack"]'));
  if (!d.querySelector('.item')) fails.push('gbn2f: couldn\'t collect anything at the falls to test naming its origin');
  else if (!d.querySelector('[data-origin]')) fails.push('gbn2f: a collected item has no "Name where this came from" button');

  // a ford on seed m, seen from the next cell
  play('m', ['go:70_69']);
  if (!lines().some(t => /Marked the crossing/.test(t))) fails.push(`m: passing next to the ford at 71,70 didn't notice it: ${lines().slice(-4).join(' | ')}`);
  if (!d.querySelector('.mapsvg .crossing') || ![...d.querySelectorAll('.mapsvg .flabel')].some(t => t.textContent === 'crossing')) fails.push('m: the crossing isn\'t drawn and labelled "crossing"');

  // the shore of a lake on seed hbgk9, walked both ways
  for (const side of ['left', 'right']) {
    play('hbgk9', ['go:64_68']);
    for (let k = 0; k < 4; k++) {
      const arrow = d.querySelector(`.mapsvg .follow[data-hike="shore:${side}"]`), before = at(), n = lines().length;
      if (!arrow) { fails.push(`hbgk9: no shore arrow (water on my ${side}) at ${before}`); break; }
      click(arrow);
      if (at() === before) fails.push(`hbgk9: walking the shore (water on my ${side}) didn't move me from ${before}`);
      if (!lines().slice(n).some(t => /Walked the shore of the lake/.test(t))) fails.push(`hbgk9: no "Walked the shore" line: ${lines().slice(n).join(' | ')}`);
    }
  }
  if (errors.length) fails.push(...errors);
  console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'names: all passed');
  if (fails.length) process.exitCode = 1;
}, 50);
