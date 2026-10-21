const { JSDOM } = require('jsdom');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document;
setTimeout(() => {
  d.querySelector('#seed').value = process.argv[2]; d.querySelector('#preset').value = '';
  d.querySelector('#check').click();
  setTimeout(() => {
    console.log('START: ' + d.querySelector('#profile').textContent.replace(/Begin here.*/, '').replace(/\s+/g, ' ').trim());
    d.querySelector('#begin').click();
    const n = d.querySelectorAll('.entry').length;
    [...d.querySelectorAll('[data-here]')].find(b => b.dataset.here === 'scan').click();
    [...d.querySelectorAll('[data-here]')].find(b => b.dataset.here === 'scan').click();
    console.log([...d.querySelectorAll('.entry')].map(e => e.textContent).join('\n'));
  }, 800);
}, 50);
