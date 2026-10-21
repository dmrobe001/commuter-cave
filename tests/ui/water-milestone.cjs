// Regression: walking to a heard stream and arriving on its bank is finding water. (Before the fix the
// milestone only fired for water spotted nearby, so a later, different brook got "Water! ... Found water.")
const { JSDOM } = require('jsdom');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document;
setTimeout(() => {
  d.querySelector('#replay-text').value = JSON.stringify({ game: 'hands-and-knowledge', seed: 'wgxdd', preset: '', actions: [{ d: { hike: 'u1' } }] });
  d.querySelector('#replay').click();
  const t = [...d.querySelectorAll('.entry')].map(e => e.textContent);
  const i = t.findIndex(x => /Found water\./.test(x)), j = t.findIndex(x => /Stream bank|There’s water/.test(x));
  console.log(i >= 0 && i <= j ? 'ok: water found on reaching the stream' : `FAIL: ${t.join(' | ')}`);
}, 50);
