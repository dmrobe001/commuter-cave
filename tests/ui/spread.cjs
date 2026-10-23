// The range of what could have happened, in the game: after a scan, a walk, a drink and a survey, the
// last action run again with other dice (__hk.spreadLast). Checks: run again with the same dice, each
// comes out as it did; a scan's sources each come with their true and perceived bearings and distances,
// sounds less sure of their bearing than sights; a drink's chance of making me ill shows; a survey's
// counts are the place's own under this attempt's luck and vary under the place's; a walk's steps get
// their odds; looking changes nothing in the game; the panel draws.
// Usage: node tests/ui/spread.cjs [seed]
const { game, toward } = require('./drive.cjs');
const seed = process.argv[2] ?? 'm';

(async () => {
  const fails = [], say = [];
  const g = await game(seed);
  g.act({ here: 'scan' });
  const scan = g.hk.spreadLast('act', 60), sensed = scan.observables.filter(o => o.kind === 'sensed' && o.observed > 0);
  const sd = ch => { const xs = sensed.filter(o => o.fields.find(f => f.field === 'channel')?.summary.counts[ch]).map(o => o.fields.find(f => f.field === 'bearing error (°)')?.summary).filter(Boolean); return xs.length ? xs.reduce((a, s) => a + (s.q[4] - s.q[0]), 0) / xs.length : null; };
  say.push(`scan: ${sensed.length} sources registered at some point; 5–95% bearing error spread: sight ${sd('sight')?.toFixed(0)}°, sound ${sd('sound')?.toFixed(0)}°; reproduces ${scan.reproduces}`);
  if (scan.reproduces !== true) fails.push('scan: run again with the same dice, it comes out differently');
  if (!sensed.length || !sensed.every(o => o.fields.some(f => f.field === 'trueBearing') && o.fields.some(f => f.field === 'dist / true'))) fails.push('scan: a source without its true and perceived bearing and distance');
  if (sd('sight') != null && sd('sound') != null && !(sd('sound') > sd('sight'))) fails.push('scan: sounds no less sure of their bearing than sights');
  // walk to water heard, else anywhere on the map
  const t = g.map().targets.find(t => t.kind === 'sus' && /stream|brook|river|lake/.test(t.name)) ?? g.map().targets[0];
  g.hike(t ? t.hike : toward(g.here(), 'north'));
  const before = JSON.stringify([g.state().day, g.state().t, g.state().body, g.state().sites.length, g.journal().length]);
  const walk = g.hk.spreadLast('act');
  if (!walk) fails.push('no range for the walk');
  else {
    say.push(`walk: ${walk.n} runs, reproduces ${walk.reproduces}; ${walk.leaves.filter(e => e.varies).length} things vary; steps ${walk.walk?.steps.length}, ${walk.walk?.steps.filter(s => s.p < 0.9).length} open, ${walk.walk?.bits.toFixed(1)} bits`);
    if (walk.reproduces !== true) fails.push('walk: run again with the same dice, it comes out differently');
    if (!walk.walk?.steps.length) fails.push('walk: no odds for its steps');
    if (walk.errors.length) fails.push(`walk: ${walk.errors[0]}`);
  }
  if (JSON.stringify([g.state().day, g.state().t, g.state().body, g.state().sites.length, g.journal().length]) !== before) fails.push('looking into the walk changed the game');
  if (g.can('drink')) {
    g.act({ here: 'drink' });
    const r = g.hk.spreadLast('act'), ill = r.observables.find(o => o.kind === 'made ill');
    say.push(`drink: made ill in ${ill ? Math.round(100 * ill.observed) : 0}% of ${r.n} runs, at a chance of ${ill?.fields.find(f => f.field === 'p').summary.mean.toFixed(2)}; reproduces ${r.reproduces}`);
    if (!ill) fails.push('drink: no chance of being made ill noted');
    if (r.reproduces !== true) fails.push('drink: run again with the same dice, it comes out differently');
  } else say.push('drink: no water reached');
  g.act({ here: 'survey' });
  const byAct = g.hk.spreadLast('act'), byPlace = g.hk.spreadLast('place');
  const counts = r => r.observables.filter(o => o.kind === 'lives here').map(o => ({ o, s: o.fields.find(f => f.field === 'count').summary })), spreads = ({ o, s }) => o.observed < 1 || s.min !== s.max;
  say.push(`survey: ${counts(byAct).length} things living here by this attempt's luck (${counts(byAct).filter(spreads).length} counts vary); by the place's luck ${counts(byPlace).filter(spreads).length} of ${counts(byPlace).length} vary; reproduces ${byAct.reproduces}`);
  if (counts(byAct).some(spreads)) fails.push('survey: a count varies with this attempt\'s luck alone');
  if (!counts(byPlace).some(spreads)) fails.push('survey: no count varies from place to place');
  if (byAct.reproduces !== true) fails.push('survey: run again with the same dice, it comes out differently');
  // the panel
  g.state().showProps = true;
  const d = g.draw();
  d.querySelector('[data-spread="place"]')?.dispatchEvent(new g.w.MouseEvent('click', { bubbles: true }));
  g.draw();
  if (!d.querySelector('.spread .tree li')) fails.push('the panel shows no outcome tree');
  if (g.errs.length) fails.push(...g.errs);
  console.log('spread (game):\n  ' + say.join('\n  '));
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('spread (game): all passed');
})();
