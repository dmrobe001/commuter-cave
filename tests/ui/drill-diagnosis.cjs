const { JSDOM } = require('jsdom');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document;
setTimeout(() => {
  d.querySelector('#seed').value = 'pig-rock'; d.querySelector('#preset').value = 'temperate-woodland';
  d.querySelector('#check').click();
  setTimeout(() => {
    d.querySelector('#begin').click();
    const S = w.__hk.state();
    const mk = (name, kind, props) => { const it = { uid: S.uid++, name, kind, props, from: { name, id: null, part: kind }, notes: {}, provenance: { name } }; S.inv.push(it); return it; };
    // pack order: crooked spindle first, then a straight one, then a good board
    const crooked = mk('spindle, crooked test', 'spindle', { density: 0.4, moisture: 0.11, length: 70, straightness: 0.72 });
    const straight = mk('spindle, straight test', 'spindle', { density: 0.4, moisture: 0.11, length: 70, straightness: 0.95 });
    mk('hearth board, ideal test', 'board', { density: 0.3, resin: 0.05, moisture: 0.11, notch: 0.85, life: 1, socket: 0.9 });
    // render, then see what the drill slot defaults to and drill
    d.querySelector('[data-here="survey"]').click();
    d.querySelector('[data-here="make"]').click();
    const slot = d.querySelector('select[data-slot="drill:spindle"]');
    console.log('drill spindle slot default:', slot.options[slot.selectedIndex].textContent);
    d.querySelector('[data-craft="drill"][data-mode="until"]').click();
    const last = [...d.querySelectorAll('.entry')].map(e => e.textContent).filter(t => /drill/.test(t)).pop();
    console.log('journal:', last);
    console.log(`lengths after: crooked ${crooked.props.length}, straight ${straight.props.length}`);
  }, 500);
}, 50);
