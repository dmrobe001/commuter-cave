const { JSDOM } = require('jsdom');
const { strikeOut } = require('./tap-map.cjs');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document, errors = [];
w.addEventListener('error', e => errors.push(e.message));
const label = x => x.getAttribute('aria-label') ?? x.textContent;
const click = (sel, re) => { const b = [...d.querySelectorAll(sel)].find(x => !x.disabled && (!re || re.test(label(x)))); if (b) b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !!b; };
setTimeout(() => {
  d.querySelector('#seed').value = 'pig-rock'; d.querySelector('#preset').value = 'temperate-woodland';
  d.querySelector('#check').click();
  setTimeout(() => {
    d.querySelector('#begin').click();
    const start = d.querySelectorAll('.entry').length;
    click('[data-here="look"]'); click('[data-look="focus:spindle"]');
    console.log('look button: ' + d.querySelector('[data-here="look"]').textContent);
    strikeOut(w, d, 'east');
    strikeOut(w, d, 'south');
    click('[data-here="look"]'); // stop looking
    click('[data-here="look"]'); click('[data-look="distant:water"]');
    click('[data-here="look"]');
    click('[data-here="look"]'); const g = [...d.querySelectorAll('[data-look^="entity:"]')].find(b => /grub|beetle|worm/i.test(b.textContent)); if (g) g.click();
    click('[data-here="look"]');
    click('[data-here="scan"]');
    console.log('\n' + [...d.querySelectorAll('.entry')].slice(start).map(e => e.textContent.replace(/^(\d\d:\d\d)/, '[$1] ')).join('\n'));
    console.log('\nerrors:', errors.length ? errors : 'none');
  }, 600);
}, 50);
