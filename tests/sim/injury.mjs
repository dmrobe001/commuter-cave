// The risk of getting hurt on the move (injury.js), against its calibration targets: about one minor
// injury in 300 hours on easy, familiar ground by day, rested; something like one in 40 hours on
// unfamiliar ground by day, averaged over real walks across several worlds; one in an hour or two on
// scree on a moonless night. And each factor pushes the way it should: dark, wet, tired, hungry,
// unfamiliar, steep all raise the risk. Usage: node tests/sim/injury.mjs
import { generateWorld } from '../../src/generator.js';
import { generateLandscape, N } from '../../src/landscape.js';
import { walk, stepHours } from '../../src/geo.js';
import { hazard } from '../../src/injury.js';
import { makeRng } from '../../src/rng.js';
const day = { lux: 50000, weather: 'clear' }, moonless = { lux: 0.002, weather: 'clear' }, fullMoon = { lux: 0.25, weather: 'clear' };
const rested = { fatigue: 0.1, energy: 0.7, sick: 0, limp: 0 };
const fails = [], seeds = process.env.QUICK ? ['m', 'gbn2f'] : ['m', 'gbn2f', 'hmfqm', 'pig-rock', 'c', 'h'];
let easy = null, scree = null, walked = 0, expected = 0;
for (const seed of seeds) {
  const L = generateLandscape(generateWorld(seed, {}));
  for (let c = 0; c < N * N; c++) {
    if (!easy && L.micro[c] === 'glade' && L.slope[c] < 0.05 && L.veg[c] < 0.2) easy = { L, c };
    if (!scree && L.micro[c] === 'scree') scree = { L, c };
  }
  // real walks by day over unfamiliar ground: from the spawn to points around it
  const r = makeRng(`${seed}/injury-test`);
  for (let k = 0; k < 12; k++) {
    const to = { x: Math.max(0, Math.min(N - 1, L.spawn.x + Math.round(r.uniform(-25, 25)))), y: Math.max(0, Math.min(N - 1, L.spawn.y + Math.round(r.uniform(-25, 25)))) };
    const t = walk(L, L.spawn, to, { rng: r, maxHours: 2 });
    for (let i = 1; i < t.path.length; i++) { const h = stepHours(L, t.path[i - 1], t.path[i]); walked += h; expected += hazard(L, t.path[i].y * N + t.path[i].x, day, rested, false) * h; }
  }
}
const per = x => (1 / x).toFixed(0);
const hEasy = hazard(easy.L, easy.c, day, rested, true), hScree = hazard(scree.L, scree.c, moonless, rested, false), hWalks = expected / walked;
console.log(`injury: hours per injury — easy familiar ground by day ${per(hEasy)}; real walks over new ground by day ${per(hWalks)} (${walked.toFixed(0)} h walked); scree, moonless night ${(1 / hScree).toFixed(1)}; scree, full moon ${(1 / hazard(scree.L, scree.c, fullMoon, rested, false)).toFixed(1)}`);
if (1 / hEasy < 200 || 1 / hEasy > 450) fails.push(`easy familiar ground by day: one injury in ${per(hEasy)} h, not about 300`);
if (1 / hWalks < 20 || 1 / hWalks > 120) fails.push(`real walks by day: one injury in ${per(hWalks)} h, not about 40`);
if (1 / hScree > 3) fails.push(`scree on a moonless night: one injury in ${(1 / hScree).toFixed(1)} h, not one or two`);
const { L, c } = scree, h0 = hazard(L, c, day, rested, false);
for (const [what, h] of [['dark', hazard(L, c, moonless, rested, false)], ['full moon (between day and dark)', hazard(L, c, fullMoon, rested, false)], ['rain', hazard(L, c, { ...day, weather: 'rain' }, rested, false)],
  ['tired', hazard(L, c, day, { ...rested, fatigue: 0.9 }, false)], ['hungry', hazard(L, c, day, { ...rested, energy: 0.1 }, false)], ['a limp', hazard(L, c, day, { ...rested, limp: 0.5 }, false)]]) if (!(h > h0)) fails.push(`${what} doesn't raise the risk`);
if (!(hazard(L, c, moonless, rested, false) > hazard(L, c, fullMoon, rested, false))) fails.push('a full moon doesn\'t help');
if (!(hazard(L, c, day, rested, true) < h0)) fails.push('familiar ground isn\'t safer');
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('injury: all passed');
