// drive.cjs — play the built game in a test without drawing it: start a world, act, and read the
// state, the journal and the map as data (__hk in game.js). Much faster than tapping a drawn page,
// since nothing is drawn after each action; draw() draws once, for a check on the drawing itself.
//   const g = await game('pig-rock');
//   g.act({ here: 'scan' }) → the journal lines it wrote;  g.hike(key) → the same, for a hike
//   g.map() → mapData (places, links, streams as drawn, lakes, cliffs, crossings, follow arrows, targets)
//   g.can('drink') → whether that action is on offer here;  g.here() → { x, y, name };  g.state() → the game's state
const { openPage } = require('./page.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));

async function game(seed, { preset = '', draw = false, record = null } = {}) {
  const dom = openPage({ draw }), w = dom.window, errs = [];
  w.addEventListener('error', e => errs.push(e.message));
  await wait(10);
  const hk = w.__hk;
  if (record) hk.replay(typeof record === 'string' ? record : JSON.stringify(record));
  else hk.start(seed, preset);
  const journal = () => hk.journal();
  const g = {
    w, d: w.document, hk, errs, journal,
    act(d) { const n = journal().length; hk.act(d); return journal().slice(n); },
    hike(key) { return g.act({ hike: key }); },
    map: () => hk.mapData(),
    here: () => hk.mapData().here,
    can: id => hk.actions().some(a => a.id === id && !a.disabled),
    state: () => hk.state(),
    draw: () => { hk.draw(); return w.document; },
  };
  return g;
}
// a spot `cells` from where I stand toward a compass direction, as a hike key (as tapping the map there and then the pin)
const DIRS = { north: [0, -1], northeast: [0.71, -0.71], east: [1, 0], southeast: [0.71, 0.71], south: [0, 1], southwest: [-0.71, 0.71], west: [-1, 0], northwest: [-0.71, -0.71] };
function toward(here, dir, cells = 13) {
  const [dx, dy] = DIRS[dir] ?? DIRS.north, c = v => Math.max(0, Math.min(127, Math.round(v)));
  return `go:${c(here.x + dx * cells)}_${c(here.y + dy * cells)}`;
}
module.exports = { game, toward, wait, DIRS };
