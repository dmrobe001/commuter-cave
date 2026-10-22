// page.cjs — open the built game in jsdom for a test. Made worlds (species, landscape, spawn) are kept
// on disk between runs in out/cache/worlds, keyed by seed, preset and a hash of the code that makes
// them (see checkWorld in game.js), so each test doesn't make the same worlds again; a world made by
// older code is never used, and is cleared out when its replacement is kept. { draw: false } leaves
// the screen undrawn after each action (see __hk.draw in game.js) for tests that read the game's state
// rather than the page. A test page doesn't check a random world on opening: each test picks its own.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'dist', 'commuter-cave.html'), 'utf8');
const dir = path.join(root, 'out', 'cache', 'worlds');
const fileOf = key => path.join(dir, `${key.replace(/[^\w-]+/g, '_')}.json`);
const store = {
  get(key) { try { return fs.readFileSync(fileOf(key), 'utf8'); } catch { return null; } },
  set(key, text) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const hash = key.split('|').pop();
      for (const f of fs.readdirSync(dir)) if (!f.endsWith(`_${hash}.json`) && f.endsWith('.json')) fs.rmSync(path.join(dir, f), { force: true });
      const tmp = `${fileOf(key)}.${process.pid}.tmp`; // tests run side by side: write whole, then move into place
      fs.writeFileSync(tmp, text); fs.renameSync(tmp, fileOf(key));
    } catch { /* a kept world is a convenience */ }
  },
};
function openPage({ draw = true } = {}) {
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.__worldStore = store; w.__testPage = true; if (!draw) w.__noDraw = true; } });
}
module.exports = { openPage, html, JSDOM };
