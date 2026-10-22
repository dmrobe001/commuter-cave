const { JSDOM } = require('jsdom');
const { strikeOut } = require('./tap-map.cjs');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document, errors = [];
w.addEventListener('error', e => errors.push(e.message));
const label = x => x.getAttribute('aria-label') ?? x.textContent;
const click = (sel, re) => { const b = [...d.querySelectorAll(sel)].find(x => !x.disabled && (!re || re.test(label(x)))); if (b) b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !!b; };
const setGoal = v => { const g = d.querySelector('#goal'); g.value = v; g.dispatchEvent(new w.Event('change', { bubbles: true })); };
setTimeout(() => {
  d.querySelector('#seed').value = 'c';
  d.querySelector('#check').click();
  setTimeout(() => {
    d.querySelector('#begin').click();
    const start = d.querySelectorAll('.entry').length;
    console.log('goal options:', d.querySelector('#goal').options.length);
    setGoal('hearth-board'); click('[data-think="root"]');
    setGoal('spindle'); click('[data-think="root"]');
    setGoal('proc:hand-drill-ember'); click('[data-think="root"]');
    click('[data-here="look"]'); click('[data-look="focus:hearth"]'); // keeps looking along the way
    for (const dir of ['north', 'east', 'south', 'west']) strikeOut(w, d, dir);
    click('[data-here="look"]'); // stop
    click('[data-here="look"]'); click('[data-look="focus:stone"]'); click('[data-here="look"]');
    console.log([...d.querySelectorAll('.entry')].slice(start).map(e => e.textContent.replace(/^(\d\d:\d\d)/, '[$1] ')).filter(t => /To get|To spin|Looking for|On the way|nothing|best|Didn’t reach/.test(t)).join('\n'));
    console.log('map targets:', [...d.querySelectorAll('[data-hike]')].map(b => b.textContent).join(' | '));
    console.log('errors:', errors.length ? errors : 'none');
  }, 600);
}, 50);
