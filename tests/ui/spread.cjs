// The range of what could have happened, in the game: after a drink, a survey and a walk, the last
// action run again with other dice (__hk.spreadLast). Checks: run again with the same dice, each comes
// out as it did; a drink's chance of leaving sickness brewing shows; a survey's counts are the place's
// own under this attempt's luck and vary under the place's; a walk's steps get their odds; looking
// changes nothing in the game; the panel draws.
// Usage: node tests/ui/spread.cjs [seed]
const { game, toward } = require('./drive.cjs');
const seed = process.argv[2] ?? 'm';

(async () => {
  const fails = [], say = [];
  const g = await game(seed);
  g.act({ here: 'scan' });
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
    const r = g.hk.spreadLast('act'), brew = r.leaves.find(e => e.path === 'body.pendingSick +n');
    say.push(`drink: sickness left brewing in ${brew ? Math.round(100 * brew.summary.mean) : 0}% of ${r.n} runs; reproduces ${r.reproduces}`);
    if (r.reproduces !== true) fails.push('drink: run again with the same dice, it comes out differently');
  } else say.push('drink: no water reached');
  g.act({ here: 'survey' });
  const byAct = g.hk.spreadLast('act'), byPlace = g.hk.spreadLast('place');
  const counts = r => r.leaves.filter(e => /^report\.seen\./.test(e.path) && e.summary.kind === 'num'), spreads = e => e.summary.min !== e.summary.max;
  say.push(`survey: ${counts(byAct).length} things seen at some point by this attempt's luck (${counts(byAct).filter(spreads).length} counts vary); by the place's luck ${counts(byPlace).filter(spreads).length} of ${counts(byPlace).length} vary; reproduces ${byAct.reproduces}`);
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
