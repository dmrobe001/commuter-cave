// report.js — renders a world as a game-master-readable Markdown document:
// overview, one table each for minerals, plants (plus a parts table), and animals,
// then a patch-variation section with mean ± SD and correlations per archetype.

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const pct = x => `${Math.round(x * 100)}%`;
const cell = v => String(v ?? '—').replace(/\|/g, '/').replace(/\n/g, ' ') || '—';
const field = (e, prefix) => e.fieldTests.find(([k]) => k.startsWith(prefix))?.[1] ?? '—';
const delib = (e, prefix) => e.deliberate.find(([k]) => k.startsWith(prefix))?.[1] ?? '—';

function table(L, headers, rows) {
  L.push(`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`);
  for (const r of rows) L.push(`| ${r.map(cell).join(' | ')} |`);
  L.push('');
}

const displayName = e => cap(e.gmName ?? e.name) + (e.gmName ? ` (shown to players as "${e.name}")` : '');

function where(e) {
  if (e.perKm2 != null) return `${e.habitats.map(h => h.name).join(', ')}${e.habitats.length === 1 ? ' only' : ''}; ~${e.perKm2}/km²`;
  if (e.kind === 'stone') return e.habitats.map(h => `${h.micro} ~${h.pieces}/instance`).join('; ');
  return e.habitats.map(h => `${h.name} ~${h.perInstance}/${h.unit}`).join('; ') + (e.habitats.length === 1 ? ' (only here)' : '');
}

function fmt(t, x) {
  return `${x}${t.unit && t.unit !== '×' ? ` ${t.unit}` : t.unit === '×' ? '×' : ''}`;
}

function variationBlock(L, e) {
  const v = e.variation;
  if (!v) return;
  let maxR = 0;
  v.corr.forEach((row, i) => row.forEach((r, j) => { if (i !== j) maxR = Math.max(maxR, Math.abs(r)); }));
  const label = v.traits.length < 2 ? 'single varying trait' : maxR >= 0.5 ? 'strongly linked traits' : maxR >= 0.25 ? 'moderately linked traits' : 'nearly independent traits';
  L.push(`**${e.id}. ${displayName(e)}** (${label})`, '');
  table(L, ['Trait', 'Kind', 'Mean ± SD', 'Middle 68% of patches'],
    v.traits.map(t => [t.label, t.kind, `${fmt(t, t.mean)} ± ${t.sd}`, `${fmt(t, t.q16)} to ${fmt(t, t.q84)}`]));
  if (v.traits.length > 1) {
    const short = v.traits.map(t => t.label.replace(/ \(.*\)$/, ''));
    const pairs = [];
    for (let i = 0; i < short.length; i++) for (let j = i + 1; j < short.length; j++) pairs.push([short[i], short[j], v.corr[i][j]]);
    pairs.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
    L.push(`Correlations across patches: ${pairs.map(([a, b, r]) => `${a} ↔ ${b} ${r > 0 ? '+' : ''}${r.toFixed(2)}`).join('; ')}.`, '');
  }
  const micros = Object.entries(v.microMeans);
  if (micros.length > 1) {
    L.push(`By microhabitat (means): ${micros.map(([m, vals]) => `${m}: ${v.traits.map(t => fmt(t, vals[t.id])).join(', ')}`).join('; ')}.`, '');
  }
}

export function toMarkdown(w) {
  const e = w.environment;
  const L = [];
  L.push(`# Generated environment: seed "${w.seed}"`, '');
  L.push(`Generator version ${w.version}. Game master's view: everything here is hidden from players until discovered. Full wide tables are in the accompanying CSV files.`, '');

  L.push('## Overview', '');
  L.push(`**Biome:** ${e.biome}. **Climate:** mean ${e.meanTempC} °C, ${e.precipMm} mm of rain per year, seasonality ${e.seasonality} (the lean season is ${e.leanSeason}). **Bedrock:** ${e.bedrockLabel}, with ${e.soil}. **Relief:** ${e.relief} (0 flat, 1 rugged). **Tree cover:** ${pct(e.treeCover)}. **Fire:** ${e.fireLabel}.`, '');

  L.push('### Starter check', '');
  table(L, ['Need', 'Met', 'Where to look'], w.starter.map(s => [
    s.need, s.met ? 'yes' : '**no**',
    (s.sources.slice(0, 4).join('; ') || '—') + (s.sources.length > 4 ? ` (+${s.sources.length - 4} more)` : ''),
  ]));

  L.push('### Microhabitats and landmarks', '');
  table(L, ['Microhabitat', 'Instances per km²', 'Counted as'], e.microhabitats.map(m => [`${m.name}${m.landmark ? ' (landmark)' : ''}`, m.perKm2, m.unit]));

  L.push('## Water', '');
  table(L, ['ID', 'Source', 'Where', 'Availability', 'At a glance', 'Smell and taste', 'Drinking untreated'],
    w.water.map(x => [x.id, x.name, x.micro, x.seasonal, x.cues.join('; '), x.fieldTests[0][1], x.deliberate[0][1]]));

  L.push('## Minerals', '');
  table(L, ['ID', 'Name', 'True type', 'Origin', 'Where', 'At a glance', 'Ring test', 'Test break', 'Scratch', 'Heft', 'Knapping (novice)', 'In fire', 'Uses'],
    w.stones.map(s => [s.id, cap(s.name), s.hidden.type, s.origin, where(s), s.cues.join('; '), field(s, 'Ring'), field(s, 'Test break'),
      field(s, 'Scratch'), field(s, 'Heft'), delib(s, 'Knap'), delib(s, 'Heat in'), s.uses.join('; ')]));
  if (w.clay.length) {
    table(L, ['ID', 'Name', 'Where', 'At a glance', 'Coil test', 'Feel', 'Test firing'],
      w.clay.map(c => [c.id, cap(c.name), c.where.join(', '), c.cues.join('; '), c.fieldTests[0][1], c.fieldTests[1][1], c.deliberate[0][1]]));
  }

  L.push('## Plants', '');
  table(L, ['ID', 'Name', 'Form', 'Where', 'At a glance', 'Crush and smell', 'Break a stem', 'Twist', 'Skin contact', 'Staged taste', 'Other deliberate tests'],
    w.plants.map(p => [p.id, displayName(p), p.form, where(p), p.cues.join('; '), field(p, 'Crush'), field(p, 'Break'), field(p, 'Twist'),
      field(p, 'Skin'), field(p, 'Staged'), p.deliberate.map(([k, v]) => `${k}: ${v}`).join('; ')]));
  const looks = w.plants.filter(p => p.lookalike);
  for (const p of looks) L.push(`**Lookalike:** ${p.note}`, '');

  L.push('### Plant parts', '');
  L.push('Food columns give the outcome of eating a portion. Where defense strength varies between patches, the range covers the middle 68% of patches.', '');
  table(L, ['Plant', 'Part', 'Collect with', 'Season', 'Raw', 'Cooked', 'Leached', 'Nutrition and uses'],
    w.plants.flatMap(p => p.parts.map(x => [
      `${p.id} ${p.gmName ?? p.name}`, x.part, x.collect, x.season,
      x.food?.raw, x.food?.cooked, x.food?.leached,
      [x.food ? x.nutrition : null, ...x.uses].filter(Boolean).join('; ') || '—',
    ])));

  L.push('## Animals', '');
  table(L, ['ID', 'Name', 'Class', 'Where', 'At a glance', 'Field tests', 'Catching', 'Season', 'Raw / cooked', 'Yields', 'Danger'],
    w.animals.map(a => [a.id, cap(a.name), a.cls, where(a), a.cues.join('; '),
      a.fieldTests.map(([k, v]) => `${k}: ${v}`).join('; '), a.catch, a.season,
      a.food ? `${a.food.raw} / ${a.food.cooked}` : '—', a.products.join(', '), a.danger ?? (a.defense ?? '—')]));

  L.push('## Patch variation', '');
  L.push('Each archetype has a few traits that vary from patch to patch, driven by shared site factors (moisture, fertility, exposure) and by the local population. Statistics come from sampling many patches across the places the archetype occurs. Players never see these numbers; they experience them by sampling patches.', '');
  for (const [title, list] of [['Minerals', w.stones], ['Plants', w.plants], ['Animals', w.animals]]) {
    L.push(`### ${title}`, '');
    for (const x of list) variationBlock(L, x);
  }
  return L.join('\n');
}
