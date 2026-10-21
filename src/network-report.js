// network-report.js — renders the process network, a world's reachability, and goal trees.

import { PROCESSES, ITEMS, MATERIALS, STARTER_GOALS, reachable, networkStats, expandGoal, thought } from './process.js';

const cell = v => String(v ?? '—').replace(/\|/g, '/');
const reqText = req => (req.any ? req.any.map(reqText).join(' or ')
  : req.anyTool ? req.anyTool.map(t => ITEMS[t]?.name ?? t).join(' or ')
  : req.item ? `${req.qty > 1 ? req.qty + '× ' : ''}${ITEMS[req.item]?.name ?? req.item}`
  : `${req.qty > 1 ? req.qty + '× ' : ''}${MATERIALS[req.material].name}${Object.keys(req.where ?? {}).length ? ` [${Object.entries(req.where).map(([k, [lo, hi]]) => (lo === hi ? k : `${k} ${lo}–${hi}`)).join(', ')}]` : ''} (${req.role})`);
const loadText = l => Object.entries(l).map(([k, v]) => `${k} ${v}`).join(', ') || '—';

// Indented AND–OR tree for the game master, with this world's candidate materials.
export function treeLines(node, indent = '', seen = new Set()) {
  const L = [];
  if (node.type === 'item') {
    if (seen.has(node.item) || node.truncated) { L.push(`${indent}- **${node.name}** (see above)`); return L; }
    seen.add(node.item);
    L.push(`${indent}- **${node.name}**${node.options.length > 1 ? ' — one of:' : ''}`);
    for (const o of node.options) L.push(...treeLines(o, indent + '  ', seen));
  } else if (node.type === 'process') {
    L.push(`${indent}- *${node.name}*, needs all of:`);
    for (const n of node.needs) L.push(...treeLines(n, indent + '  ', seen));
  } else if (node.type === 'any') {
    L.push(`${indent}- any one of:`);
    for (const o of node.options) L.push(...treeLines(o, indent + '  ', seen));
  } else {
    const c = node.candidates;
    const names = [...new Set(c.map(m => `${m.sourceName} (${m.part})`))];
    const collect = node.collectWith.length ? `; collect with ${node.collectWith.map(t => ITEMS[t]?.name ?? t).join(' or ')}` : '';
    L.push(`${indent}- ${reqText(node.slot)} → ${c.length ? names.slice(0, 4).join('; ') + (names.length > 4 ? ` (+${names.length - 4})` : '') : '**none in this world**'}${collect}`);
  }
  return L;
}

// The character's step-by-step reasoning along one path (first option at each OR, for illustration).
export function thoughtWalk(node, out = [], seen = new Set()) {
  if (node.type === 'item') {
    if (node.truncated || seen.has(node.item) || !node.options.length) return out;
    seen.add(node.item);
    out.push(thought(node));
    if (node.options.length === 1) node.options[0].needs.forEach(n => thoughtWalk(n, out, seen));
    else thoughtWalk(node.options[0], out, seen);
  } else if (node.type === 'process') {
    out.push(thought(node));
    node.needs.forEach(n => thoughtWalk(n, out, seen));
  } else if (node.type === 'any') thoughtWalk(node.options[0], out, seen);
  else out.push(thought(node));
  return out;
}

export function networkMarkdown(world) {
  const L = [];
  const { consumers, depth } = networkStats();
  L.push('# Early-game process network (draft)', '');
  L.push(`${PROCESSES.length} processes, ${Object.keys(ITEMS).length} items, ${Object.keys(MATERIALS).length} raw material classes. Raw materials are requested by property, so the same network applies to every world. Hours are per attempt or batch (median); "wait" is background time; load is per hour (0 easy, 3 hard).`, '');

  L.push('## Processes', '');
  L.push('| ID | Process | Makes | Uses | Tools | Hours | Wait (h) | Attention | Load per hour | kcal/h | Skill | Base success | Notes |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of PROCESSES) {
    L.push(`| ${p.id} | ${p.name} | ${p.makes.map(reqText).join(', ')} | ${cell(p.uses.map(reqText).join('; ') || '—')} | ${cell(p.tools.map(reqText).join('; ') || '—')} | ${p.hours[0]} | ${p.wait ? p.wait[0] : '—'} | ${p.attention} | ${loadText(p.load)} | ${p.kcal} | ${p.skill ?? '—'} | ${p.success} | ${cell(p.notes ?? '')} |`);
  }
  L.push('');

  L.push('## Structure', '');
  L.push('Hubs are items that many processes need; depth is the fewest process steps from bare hands.', '');
  L.push('| Item | Needed by (processes) | Depth |', '|---|---|---|');
  for (const [id, it] of Object.entries(ITEMS).sort((a, b) => (consumers[b[0]]?.length ?? 0) - (consumers[a[0]]?.length ?? 0))) {
    L.push(`| ${it.name} | ${consumers[id]?.length ?? 0} | ${depth[id] ?? '∞'} |`);
  }
  L.push('');

  if (world) {
    const { have, via, unreachable } = reachable(world);
    L.push(`## Reachability in world "${world.seed}"`, '');
    L.push(`${have.size} of ${Object.keys(ITEMS).length} items can be produced from bare hands with this world's materials (ignoring skill and luck).`, '');
    if (unreachable.length) L.push(`**Unreachable:** ${unreachable.map(k => ITEMS[k].name).join(', ')}.`, '');
    L.push(`**Starter goals:** ${STARTER_GOALS.map(g => `${ITEMS[g].name} ${have.has(g) ? '✓' : '✗'}`).join('; ')}.`, '');
    for (const g of ['fire', 'cordage', 'safe-water']) {
      L.push(`### Goal tree: ${ITEMS[g].name}`, '');
      L.push(...treeLines(expandGoal(g, world)), '');
      L.push('**The character thinking it through** (one path, first option at each choice):', '');
      for (const t of thoughtWalk(expandGoal(g, world))) L.push(`> ${t}`, '>');
      L.pop();
      L.push('');
    }
  }
  return L.join('\n');
}
