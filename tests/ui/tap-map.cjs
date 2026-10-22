// Shared by the UI tests: pick a spot on the map and go there, as a player does (tap open map to drop a
// pin, tap the pin). jsdom lays nothing out, so the map's screen rectangle is empty and the game's
// screen-to-map conversion (toUser in game.js) falls back to a 1-pixel square; tapAt inverts exactly
// that. strikeOut picks a spot `cells` away from where I stand toward a compass direction.
const DIRS = { north: [0, -1], northeast: [0.71, -0.71], east: [1, 0], southeast: [0.71, 0.71], south: [0, 1], southwest: [-0.71, 0.71], west: [-1, 0], northwest: [-0.71, -0.71] };

function tapAt(w, d, gx, gy) {
  const svg = d.querySelector('.mapsvg');
  if (!svg) return false;
  const [x, y, span] = svg.getAttribute('viewBox').split(' ').map(Number);
  svg.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: (gx - x) / span - 0.5, clientY: (gy - y) / span - 0.5 }));
  const pin = d.querySelector('.mapsvg .pin[data-hike]');
  if (!pin) return false;
  pin.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return true;
}
function strikeOut(w, d, dir, cells = 13) {
  const here = d.querySelector('.mapsvg .node.here circle');
  if (!here) return false;
  const [dx, dy] = DIRS[dir] ?? DIRS.north;
  const clampC = v => Math.max(0, Math.min(127, Math.round(v)));
  return tapAt(w, d, clampC(+here.getAttribute('cx') + dx * cells), clampC(+here.getAttribute('cy') + dy * cells));
}
module.exports = { tapAt, strikeOut, DIRS };
