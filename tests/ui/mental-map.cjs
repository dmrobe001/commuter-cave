// The mental map: names, the mesh with walking times and stream marks, straight and relayed journeys,
// and notes when a walk takes longer or shorter than expected. Usage: node tests/ui/mental-map.cjs [seed]
const { JSDOM } = require('jsdom');
const { openPage } = require('./page.cjs');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const dom = openPage();
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
  click('[data-here="scan"]');
  click('[data-maproutes]'); // routes are hidden until asked for
  // out to the nearest landmark, on to a second, then home by tapping a route: an earlier place, then home
  click('[data-hike]', /hill|cliff|lake|falls|waterfall|stream|river|brook/);
  click('[data-hike]', /hill|cliff|lake|falls|waterfall|stream|river|brook/);
  click('[data-here="scan"]');
  const back = [...d.querySelectorAll('[data-hike]')].filter(g => /^Head back to/.test(g.getAttribute('aria-label')) && !/where I woke/.test(g.getAttribute('aria-label')));
  if (back[0]) back[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  click('[data-hike]', /where I woke/);
  console.log(`JOURNAL (${seed})\n` + [...d.querySelectorAll('#journal > *')].map(e => e.tagName === 'H3' ? '== ' + e.textContent : e.textContent).join('\n'));
  console.log('\nMAP MARKERS:\n' + [...d.querySelectorAll('.mapsvg .node')].map(g => '  ' + g.getAttribute('aria-label')).join('\n'));
  console.log('TIME LABELS ROTATED: ' + [...d.querySelectorAll('.etime')].filter(t => /rotate/.test(t.getAttribute('transform'))).length + ' of ' + d.querySelectorAll('.etime').length);
  const svg = d.querySelector('.mapsvg');
  console.log(`\nMESH: ${svg.querySelectorAll('.node').length} nodes, ${svg.querySelectorAll('line.edge').length} edges (${svg.querySelectorAll('line.edge.known').length} walked), ${svg.querySelectorAll('.stream').length} streams drawn`);
  console.log('EDGES: ' + [...svg.querySelectorAll('line.edge title')].map(t => t.textContent).join(' | '));
  console.log('errors:', errors.length ? errors : 'none');
})();
