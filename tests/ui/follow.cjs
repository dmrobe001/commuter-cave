// Following a stream in stages from the map: at a stream, the arrows by me follow it about a quarter of
// an hour downstream or up a branch, stopping early at a fork, waterfall, spring, lake, source or the
// edge of the land; the stretch walked is drawn solid; places along a stream that are nothing in
// their own right get no marker once I've moved on. Usage: node tests/ui/follow.cjs [seed ...]
const { JSDOM } = require('jsdom');
const { strikeOut } = require('./tap-map.cjs');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['wgxdd', 'a', 'pig-rock', 'm', 'h'];

(async () => {
  const fails = [];
  let stages = 0, stops = {};
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
    const here = () => { const c = d.querySelector('.mapsvg .node.here circle'); return c ? `${c.getAttribute('cx')},${c.getAttribute('cy')}` : ''; };
    click(d.querySelector('[data-here="scan"]'));
    // get to some water: a stream on the map, else a heard one, else strike out
    for (let k = 0; k < 6 && !d.querySelector('.mapsvg .follow'); k++) {
      const g = d.querySelector('.mapsvg .stream[data-hike]') ?? [...d.querySelectorAll('.mapsvg .node.sus[data-hike]')].find(g => /brook|stream|river/.test(g.getAttribute('aria-label'))) ;
      if (g) click(g); else strikeOut(w, d, ['north', 'east', 'south'][k % 3]);
    }
    if (!d.querySelector('.mapsvg .follow')) { console.log(`${seed}: never got to a stream`); continue; }
    const visited = [];
    for (let k = 0; k < 6; k++) {
      const arrows = [...d.querySelectorAll('.mapsvg .follow')];
      if (!arrows.length) break;
      const a = arrows.find(g => (k < 3 ? /downstream/ : /upstream/).test(g.getAttribute('aria-label'))) ?? arrows[0];
      const before = here(), n = entries().length;
      visited.push(before);
      click(a);
      const said = entries().slice(n).join(' | ');
      const m = said.match(/Followed .+? (downstream|upstream) for [^,.]+(?:, ([^.]+))?\./);
      if (!m) { fails.push(`${seed}: tapped "${a.getAttribute('aria-label')}"; no "Followed …" line: ${said}`); continue; }
      stages++;
      const why = m[2] ?? 'a quarter of an hour';
      stops[why] = (stops[why] ?? 0) + 1;
      if (here() === before && !/source|edge of a lake|dare/.test(why)) fails.push(`${seed}: followed but didn't move: ${said}`);
    }
    if (!d.querySelector('.mapsvg .stream .flow.known')) fails.push(`${seed}: followed a stream but no stretch is drawn solid`);
    // plain stream stops I've left are not drawn as places (forks, falls, springs and the start are)
    const marked = [...d.querySelectorAll('.mapsvg .node.site:not(.here)')].map(g => g.getAttribute('aria-label'));
    const plain = marked.filter(l => /gravel bar|stream bank/.test(l) && !/where I woke/.test(l));
    if (plain.length) console.log(`${seed}: still marked by water: ${plain.join('; ')} (fine only if a fork, falls or spring)`);
    if (errs.length) fails.push(`${seed}: ${errs.join('; ')}`);
  }
  console.log(`follow: ${stages} stages; stopped: ${Object.entries(stops).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('follow: all passed');
})();
