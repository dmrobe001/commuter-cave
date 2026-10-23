// The game record reproduces a game exactly: play a few hundred random actions, copy the record,
// replay it in a fresh page, and compare the journals and the state. Usage: node tests/ui/replay.cjs [seed] [steps]
const { JSDOM } = require('jsdom');
const { openPage } = require('./page.cjs');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const seed = process.argv[2] ?? 'pig-rock', steps = Number(process.argv[3] ?? 40);
const wait = ms => new Promise(r => setTimeout(r, ms));
function page() { const dom = openPage(); return { w: dom.window, d: dom.window.document }; }
const journal = S => S.log.map(e => `${e.day} ${e.t.toFixed(3)} ${e.text}`).join('\n'); // the log itself, not its rendering
(async () => {
  const A = page();
  await wait(50);
  A.w.__hk.start(seed);
  let x = 12345; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; // the test's own clicks, reproducible
  for (let i = 0; i < steps; i++) {
    const opts = [...A.d.querySelectorAll('[data-here], [data-gather], [data-pk], [data-hike], [data-look], [data-rest], [data-craft], [data-eat], [data-inspect], [data-follow]')].filter(b => !b.disabled);
    const b = opts[Math.floor(rnd() * opts.length)];
    if (b) b.dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
  }
  A.d.querySelector('[data-record="copy"]').click();
  const rec = A.d.querySelector('#record-text').value;
  const SA = A.w.__hk.state();
  const B = page();
  await wait(50);
  B.d.querySelector('#replay-text').value = rec;
  B.d.querySelector('#replay').click();
  const SB = B.w.__hk.state();
  const ja = journal(SA).split('\n').filter(l => !/Copied the game record/.test(l)).join('\n'), jb = journal(SB).split('\n').filter(l => !/Replayed a game record|Copied the game record/.test(l)).join('\n');
  const same = ja === jb, state = JSON.stringify([SA.day, SA.t, SA.inv.map(i => i.name), SA.sites.length, SA.body.hyd]) === JSON.stringify([SB.day, SB.t, SB.inv.map(i => i.name), SB.sites.length, SB.body.hyd]);
  console.log(`${seed}: ${JSON.parse(rec).actions.length} actions recorded; journals identical: ${same}; state identical: ${state}; day ${SA.day} ${SA.t.toFixed(2)}`);
  if (!same) { const a = ja.split('\n'), b = jb.split('\n'); const i = a.findIndex((l, k) => l !== b[k]); console.log('first difference at line', i, '\n A:', a[i], '\n B:', b[i]); }
})();
