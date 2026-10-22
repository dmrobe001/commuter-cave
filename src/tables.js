// tables.js — one tidy ("long") table as the source of truth, wide tables as views.
//
// Long rows: { category, entity, name, part, property, value }.
// The wide CSVs (one row per species, one column per part.property) are pivots of it.

const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toLong(world) {
  const rows = [];
  const add = (category, e, part, property, value) => {
    if (value === undefined || value === null || value === '') return;
    rows.push({ category, entity: e.id, name: e.gmName ?? e.name, part: part ?? '', property, value: Array.isArray(value) ? value.join('; ') : value });
  };
  const common = (cat, e) => {
    add(cat, e, null, 'at a glance', e.cues);
    for (const [k, v] of e.fieldTests ?? []) add(cat, e, null, `field: ${k}`, v);
    for (const [k, v] of e.deliberate ?? []) add(cat, e, null, `deliberate: ${k}`, v);
    for (const t of e.variation?.traits ?? []) {
      add(cat, e, null, `vary: ${t.label} (${t.kind}) mean`, `${t.mean}${t.unit ? ' ' + t.unit : ''}`);
      add(cat, e, null, `vary: ${t.label} (${t.kind}) sd`, t.sd);
    }
  };
  for (const s of world.stones) {
    add('mineral', s, null, 'type', s.hidden.type);
    add('mineral', s, null, 'origin', s.origin);
    add('mineral', s, null, 'where', s.habitats.map(h => `${h.micro} (~${h.pieces}/instance)`));
    common('mineral', s);
    add('mineral', s, null, 'uses', s.uses);
  }
  for (const p of world.plants) {
    add('plant', p, null, 'form', p.form);
    if (p.lookalike) add('plant', p, null, 'lookalike of', p.lookalike.mimics);
    add('plant', p, null, 'where', p.habitats.map(h => `${h.name} (~${h.perInstance} ${p.unit}/${h.unit})`));
    common('plant', p);
    for (const x of p.parts) {
      add('plant', p, x.part, 'collect', x.collect);
      add('plant', p, x.part, 'season', x.season);
      if (x.food) {
        add('plant', p, x.part, 'raw', x.food.raw);
        add('plant', p, x.part, 'cooked', x.food.cooked);
        add('plant', p, x.part, 'leached', x.food.leached);
        add('plant', p, x.part, 'nutrition', x.nutrition);
      }
      add('plant', p, x.part, 'uses', x.uses);
    }
  }
  for (const a of world.animals) {
    add('animal', a, null, 'class', a.cls);
    add('animal', a, null, 'where', a.perKm2 != null
      ? `${a.habitats.map(h => h.name).join(', ')}; ~${a.perKm2}/km²`
      : a.habitats.map(h => `${h.name} (~${h.perInstance} ${a.unit}/${h.unit})`));
    common('animal', a);
    add('animal', a, null, 'catching', a.catch);
    add('animal', a, null, 'season', a.season);
    add('animal', a, null, 'raw', a.food?.raw);
    add('animal', a, null, 'cooked', a.food?.cooked);
    add('animal', a, null, 'yields', a.products);
    add('animal', a, null, 'nutrition', a.nutrition);
    add('animal', a, null, 'danger', a.danger);
    if (a.eggs) {
      add('animal', a, 'eggs', 'find', a.eggs.nest);
      add('animal', a, 'eggs', 'raw', a.eggs.food.raw);
      add('animal', a, 'eggs', 'cooked', a.eggs.food.cooked);
      add('animal', a, 'eggs', 'nutrition', `about ${Math.round(a.eggs.chem.fat * 100)}% fat, ${Math.round(a.eggs.chem.protein * 100)}% protein; ${a.eggs.chem.gather} kg in a find`);
    }
  }
  return rows;
}

export function pivotWide(rows, category) {
  const cols = ['id', 'name'], seen = new Set(cols), byEntity = new Map();
  for (const r of rows.filter(r => r.category === category)) {
    const col = r.part ? `${r.part}: ${r.property}` : r.property;
    if (!seen.has(col)) { seen.add(col); cols.push(col); }
    if (!byEntity.has(r.entity)) byEntity.set(r.entity, { id: r.entity, name: r.name });
    byEntity.get(r.entity)[col] = r.value;
  }
  return { cols, rows: [...byEntity.values()] };
}

export function toCSV(cols, rows) {
  return [cols.map(csvCell).join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n');
}
