// scripted-player.cjs — a rule-based player that plays the built page through its real buttons.
//
//   node tests/ui/scripted-player.cjs <seed> [preset] [maxSteps]
//
// It only reads what a human sees (journal text, body words, item names and impressions, button labels)
// and only acts by clicking buttons and changing selects. It never reads hidden state for decisions.
// Policy, in priority order each step:
//   night → rest until morning;  thirsty → drink / walk to known water / follow water cues / look out / head for a hill;
//   very hungry → eat remembered-safe food, else gather calorie-dense food;  hands raw or exhausted → light work;
//   then the fire plan: edges → hearth board → spindle → tinder → spare wood → test, choose, drill.

const { JSDOM } = require('jsdom');
const { strikeOut } = require('./tap-map.cjs');
const path = require('path');
const html = require('fs').readFileSync(path.join(__dirname, '..', '..', 'dist', 'commuter-cave.html'), 'utf8');
const [seed = 'pig-rock', preset = '', maxStepsArg] = process.argv.slice(2);
const MAX_STEPS = Number(maxStepsArg ?? 600);

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window, d = w.document, errors = [];
w.addEventListener('error', e => errors.push(e.message));

// ---- perception helpers (what a player can see)
const all = sel => [...d.querySelectorAll(sel)];
const btn = (sel, re) => all(sel).find(b => !b.disabled && (!re || re.test(b.getAttribute('aria-label') ?? b.textContent)));
// Making happens in the Make picker, so open it before touching a recipe.
const makeOpen = () => /^Make$/.test(d.querySelector('.picker h4')?.textContent ?? '');
const ensureMake = () => { if (!makeOpen()) { d.querySelector('[data-pk="close"]')?.click(); d.querySelector('[data-here="make"]')?.click(); } };
const click = (sel, re) => { if (sel.includes('data-craft')) ensureMake(); const b = btn(sel, re); if (b) b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !!b; };
const journal = () => all('.entry').map(e => e.textContent);
const body = () => all('#body li').map(x => x.textContent).join(' | ');
const hour = () => Number((d.querySelector('#when').textContent.match(/(\d\d):/) || [0, 12])[1]);
const items = () => all('#pack .item').map(x => ({ el: x, name: x.querySelector('.item-name')?.textContent ?? '', imp: x.querySelector('.imp')?.textContent ?? '' }));
const packHas = re => items().some(i => re.test(i.name));
const count = re => items().filter(i => re.test(i.name)).length;
const closePicker = () => click('[data-pk="close"]');

// ---- action helpers
// Collect via the picker: choose a part, then the first species (optionally filtered) offering it.
function collect(partRe, speciesOk = () => true) {
  closePicker();
  if (!click('[data-here="collect"]')) return false;
  const part = btn('[data-pk="part"]', partRe);
  if (!part) { closePicker(); return false; }
  part.click();
  const sp = all('.picker [data-gather]').find(b => !b.disabled && speciesOk(b.textContent));
  if (sp) sp.click();
  closePicker();
  return !!sp;
}
function speciesFor(partRe) {
  closePicker();
  if (!click('[data-here="collect"]')) return [];
  const part = btn('[data-pk="part"]', partRe);
  if (!part) { closePicker(); return []; }
  part.click();
  const names = all('.picker [data-gather]').filter(b => !b.disabled).map(b => b.firstChild.textContent.trim());
  closePicker();
  return names;
}
// Run a field test on the first item matching nameRe that hasn't had it yet.
function testOne(nameRe, test) {
  for (const it of items()) {
    if (!nameRe.test(it.name)) continue;
    const b = [...it.el.querySelectorAll('[data-test]')].find(x => x.dataset.name === test);
    if (b) { b.click(); return true; }
  }
  return false;
}
// Choose an option in a recipe slot by its visible label.
function choose(slot, re, avoidValue) {
  ensureMake();
  const sl = d.querySelector(`select[data-slot="${slot}"]`);
  if (!sl) return false;
  const o = [...sl.options].find(o => re.test(o.textContent) && o.value !== avoidValue);
  if (!o) return false;
  if (sl.value !== o.value) { sl.value = o.value; sl.dispatchEvent(new w.Event('change', { bubbles: true })); }
  return true;
}
function lookOnce(spec) { // look here for one thing, then stop looking so travel isn't slowed
  closePicker();
  if (/Looking for/.test(d.querySelector('[data-here="look"]')?.textContent ?? '')) click('[data-here="look"]');
  if (!click('[data-here="look"]')) return false;
  const ok = click(`[data-look="${spec}"]`);
  if (/Looking for/.test(d.querySelector('[data-here="look"]')?.textContent ?? '')) click('[data-here="look"]');
  return ok;
}
function setFocus(v) {
  const f = d.querySelector('#focus');
  if (f && f.value !== v) { f.value = v; f.dispatchEvent(new w.Event('change', { bubbles: true })); }
}
// Explore: prefer a remembered target matching `want`, else a compass direction (rotating).
let dirTurn = 0;
function explore(want, focus = '') {
  closePicker();
  if (want && click('[data-hike]', want)) return true;
  return strikeOut(w, d, ['north', 'east', 'south', 'west', 'northeast', 'southwest', 'southeast', 'northwest'][(dirTurn++ * 3) % 8]); // about 1 km
}

const WATER = /water|river|stream|brook|lake|falls|cascade|tree line/;
let refinesSinceDrill = 0;
const triedBones = new Set(), triedSharp = new Set();
const where = () => d.querySelector('#where').textContent;

function step() {
  if (/, night/.test(d.querySelector('#when').textContent)) { closePicker(); click('[data-here="rest"]'); return click('[data-rest="morning"]'); } // night, as the header says
  const b = body();
  // water
  if (/(^| )(Thirsty|Very thirsty|Parched)/.test(b)) {
    if (click('[data-here="drink"]')) return true;
    const known = btn('[data-hike]', /brook|stream|lake|river|falls|cascade|spring/);
    if (known) { known.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return true; }
    if (click('[data-here="lookout"]')) return true;
    return explore(WATER, 'water') || explore(/hill/, 'water');
  }
  // food
  if (/Very hungry|Starving/.test(b) && !/Full\./.test(b)) { // hungry for days still, but a full stomach can't take more now
    const safe = items().find(i => i.el.querySelector('[data-eat]') && !/sick/.test(i.imp));
    if (safe) { safe.el.querySelector('[data-eat]').click(); return true; }
    for (const re of [/^(Eggs|Small creatures|Nuts|Fruits|Berries|Pods|Seed heads|Tubers|Bulbs|Corms|Taproots)/, /^(Flowers|Stems|Leaves)/]) if (collect(re, t => !/sick/.test(t))) return true; // the calorie-dense first; greens only if that's all (in spring there may be nothing ripe)
  }
  // light work when hands or body need a rest
  if (/raw|Exhausted/.test(b)) {
    if (count(/^Dead wood/i) < 4 && collect(/^Dead wood/)) return true;
    return click('[data-here="survey"]') || explore();
  }
  // the fire plan
  if (!packHas(/flake|edge|splinter/i)) {
    const stones = speciesFor(/^Fist-sized stone/);
    const missing = stones.find(n => !packHas(new RegExp(`^Stone, ${n}`, 'i')));
    if (missing && count(/^Stone/i) < 4) return collect(/^Fist-sized stone/, t => t.startsWith(missing));
    if (testOne(/^Stone/i, 'Test break') || testOne(/^Stone/i, 'Scratch')) return true;
    if (/shell-like|rough curved/.test(d.querySelector('#pack').textContent)) {
      choose('knap:core', /shell-like|rough curved/);
      ensureMake();
      const core = d.querySelector('select[data-slot="knap:core"]')?.value;
      choose('knap:hammer', /scratches most/, core) || choose('knap:hammer', /./, core);
      if (click('[data-craft="knap"]')) return true;
    }
    if (!triedSharp.has(where())) { triedSharp.add(where()); if (lookOnce('focus:sharp')) return true; }
    if (packHas(/long bone/i) && click('[data-craft="bone"]')) return true;
    if (!packHas(/long bone/i) && collect(/^Bones/, t => /Big/.test(t))) return true;
    if (!packHas(/long bone/i) && !triedBones.has(where())) { triedBones.add(where()); return lookOnce('focus:bones'); }
    return explore(/bare rock|gravel/, 'stone');
  }
  if (!packHas(/hearth board/i)) {
    const woods = speciesFor(/^Dead wood/);
    const missing = woods.find(n => !packHas(new RegExp(`^Dead wood, ${n}`, 'i')));
    if (missing && count(/^Dead wood/i) < 4) return collect(/^Dead wood/, t => t.startsWith(missing));
    if (!packHas(/^Dead wood/i)) return explore(/trees/, 'hearth');
    if (testOne(/^Dead wood/i, 'Thumbnail and heft')) return true;
    choose('notch:wood', /light; dents easily|fairly light/);
    choose('notch:edge', /flake/i);
    return click('[data-craft="notch"][data-mode="careful"]');
  }
  if (count(/^Spindle/i) < 2) {
    if (packHas(/stalk/i) && click('[data-craft="trim"]')) return true;
    if (collect(/^Dead stalk/)) return true;
    if (packHas(/shoot/i) && click('[data-craft="carve"]')) return true;
    if (collect(/^Green shoot/) || collect(/^Dead shoots/)) return true;
    if (!packHas(/^Spindle/i)) return explore(/bushes|tall plants/, 'spindle');
  }
  if (!packHas(/tinder bundle/i)) {
    if (packHas(/dry grass|fluff|papery bark|inner bark for tinder/i) && click('[data-craft="tinder"]')) return true;
    if (collect(/^(Dry grass|Seed fluff|Papery bark|Inner bark for tinder)/)) return true;
    return explore(/open grassy/, 'tinder');
  }
  if (count(/^Dead wood/i) < 2 && collect(/^Dead wood/)) return true;
  // test, choose, refine, drill
  if (testOne(/^Spindle/i, 'Snap test') || testOne(/^Hearth board/i, 'Inspect the notch')) return true;
  choose('drill:spindle', /straight.*snaps crisply/) || choose('drill:spindle', /snaps crisply/);
  const lastDrill = journal().filter(t => /attempts at the drill|attempt at the drill/.test(t)).pop() ?? '';
  if (/ragged notch/.test(lastDrill) && refinesSinceDrill < 2 && click('[data-craft="refine"]')) { refinesSinceDrill++; return true; }
  if (click('[data-craft="drill"][data-mode="until"]')) { refinesSinceDrill = 0; return true; }
  return click('[data-here="survey"]');
}

setTimeout(() => {
  d.querySelector('#seed').value = seed;
  d.querySelector('#preset').value = preset;
  d.querySelector('#check').click();
  setTimeout(() => {
    const profile = d.querySelector('#profile').textContent.replace(/Begin here.*/, '').replace(/\s+/g, ' ').trim();
    d.querySelector('#begin').click();
    let stalls = 0;
    for (let i = 0; i < MAX_STEPS; i++) {
      if (journal().some(t => /Fire, on day/.test(t))) break;
      const before = journal().length + d.querySelector('#when').textContent;
      step();
      if (journal().length + d.querySelector('#when').textContent === before) stalls++; else stalls = 0;
      if (stalls > 25) { console.log('(stalled: no action changed anything)'); break; }
    }
    if (process.env.DUMP) console.log(journal().join('\n')); // DUMP=1: the whole journal, for diagnosing
    const J = journal();
    const drills = J.filter(t => /at the drill/.test(t));
    const attempts = drills.reduce((s, t) => s + Number((t.replace(/^\d\d:\d\d/, '').match(/^(\d+) attempts/) || [0, 1])[1]), 0);
    const ms = all('.entry.milestone').map(e => e.textContent.replace(/^\d\d:\d\d/, ''));
    console.log(`${seed}: ${errors.length ? 'ERRORS ' + errors[0] : 'ok'}; ${d.querySelector('#when').textContent}; milestones: ${ms.join(' | ') || 'none'}`);
    console.log(`  start screen: ${profile.slice(0, 260)}`);
    console.log(`  drilling: ${drills.length} sessions, ${attempts} attempts; last: ${(drills.pop() ?? '—').replace(/^\d\d:\d\d/, '').slice(0, 240)}`);
    console.log(`  places: ${all('.places li').length}; pack: ${items().map(i => i.name).join(', ')}`);
  }, 700);
}, 50);
