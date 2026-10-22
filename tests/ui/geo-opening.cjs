const { JSDOM } = require('jsdom');
const { strikeOut } = require('./tap-map.cjs');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const [seed, preset] = process.argv.slice(2);
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document, errors = [];
w.addEventListener('error', e => errors.push(e.message));
const btn = (sel, re) => [...d.querySelectorAll(sel)].find(b => !b.disabled && (!re || re.test(b.getAttribute('aria-label') ?? b.textContent)));
const click = (sel, re) => { const b = btn(sel, re); if (b) b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !!b; };
setTimeout(() => {
  d.querySelector('#seed').value = seed; d.querySelector('#preset').value = preset ?? '';
  d.querySelector('#check').click();
  setTimeout(() => {
    console.log('START: ' + d.querySelector('#profile').textContent.replace(/Begin here.*/, '').replace(/\s+/g, ' ').trim());
    d.querySelector('#begin').click();
    // head for high ground, look out, then go toward water, drink
    if (!click('[data-hike]', /hill|cliff/)) strikeOut(w, d, 'south');
    if (click('[data-here="lookout"]') === false) { click('[data-hike]', /hill/); click('[data-here="lookout"]'); }
    for (let k = 0; k < 5; k++) {
      if (click('[data-here="drink"]')) break;
      const waterPlace = btn('[data-hike]', /brook|stream|lake|river/);
      if (waterPlace) { waterPlace.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); continue; }
      if (!click('[data-hike]', /river|lake|stream|brook|falls|tree line/)) strikeOut(w, d, 'north');
    }
    click('[data-here="survey"]');
    console.log('\nJOURNAL\n' + [...d.querySelectorAll('#journal > *')].map(e => e.tagName === 'H3' ? `\n== ${e.textContent}` : e.textContent.replace(/^(\d\d:\d\d)/, '[$1] ')).join('\n'));
    console.log('\nMAP: ' + [...d.querySelectorAll('.mapsvg .node')].map(g => g.getAttribute('aria-label')).join(' | '));
    console.log('BODY: ' + [...d.querySelectorAll('#body li')].map(l => l.textContent).join(' '));
    console.log('errors:', errors.length ? errors : 'none');
  }, 600);
}, 50);
