// population.js — what lives at a place, and how much of it: one draw, shared by the survey, the field
// notes and anything else that asks.
//
// Each species' count at a site is its usual abundance in that microhabitat, raised by the site's
// fertility, times lognormal luck: count = base × exp(0.35 fertility + 0.5 z). It's there at all with
// chance 1 − exp(−count/2). The luck z is the place's (dice.place, keyed by species and site: the same
// site always holds the same).
//
// Guilds: things that go together. Flowers and the insects that work them; fruit and the animals that
// eat it; grazing and browsing animals and what hunts them; rotting wood, the fungi in it and the grubs
// under its bark; still water, its biting insects and the frogs that eat them. Each guild has a luck of
// its own at each site (z_g, standard normal), and a member's luck there is partly the guild's:
//   z = Σ_g ρ_g z_g + √(1 − Σ_g ρ_g²) · own
// so z stays standard normal (each species' own rate of turning up is unchanged), while two members of
// a guild share ρ_a ρ_b of their luck: where the flowers are thick, the bees are too. Vertebrates
// aren't counted per site, but their density near a site (for sightings, sign, bones) takes the same
// kind of luck: perKm² × exp(0.5 z − 0.125), whose average is perKm².
//
// The ρ are judgement, to be tuned: 0.6 for a dependence that is close (a pollinator on its flowers,
// a hunter on its prey), 0.45 for a looser one.

export const GUILDS = [
  { id: 'bloom', label: 'flowers and pollinators', member: e => (e.kind === 'plant' && (e.traits?.umbel || e.parts?.some(p => p.part === 'flowers') || ['berry', 'drupe'].includes(e.traits?.fruit)) ? 0.45 : ['bee', 'wasp'].includes(e.traits?.key) ? 0.6 : e.traits?.key === 'fly' || e.traits?.key === 'caterpillar' ? 0.45 : 0) },
  { id: 'fruit', label: 'fruit and the animals that eat it', member: e => (e.kind === 'plant' && ['berry', 'drupe', 'nut'].includes(e.traits?.fruit) ? 0.45 : ['songbird', 'groundbird', 'rooter', 'rodent'].includes(e.traits?.key) ? 0.45 : 0) },
  { id: 'prey', label: 'game and the hunters that follow it', member: e => (['browser', 'hare', 'rodent', 'groundbird'].includes(e.traits?.key) ? 0.45 : ['predator', 'soarer'].includes(e.traits?.key) ? 0.6 : 0) },
  { id: 'rot', label: 'rotting wood, its fungi and grubs', member: e => (e.form === 'mushroom' || ['grub', 'beetle', 'woodlouse', 'termite'].includes(e.traits?.key) ? 0.45 : 0) },
  { id: 'still', label: 'still water, biting insects and frogs', member: e => (['mosquito', 'gnat'].includes(e.traits?.key) ? 0.6 : e.traits?.key === 'frog' ? 0.45 : 0) },
];
const memo = new WeakMap();
// The guilds a thing belongs to, with its ρ in each; the total ρ² kept under 0.8, so its own luck still counts.
export function guildsOf(e) {
  if (memo.has(e)) return memo.get(e);
  let gs = GUILDS.map(g => ({ id: g.id, rho: g.member(e) })).filter(g => g.rho > 0);
  const r2 = gs.reduce((a, g) => a + g.rho ** 2, 0);
  if (r2 > 0.8) gs = gs.map(g => ({ ...g, rho: g.rho * Math.sqrt(0.8 / r2) }));
  memo.set(e, gs);
  return gs;
}
// A thing's luck at a site (standard normal), part its own (rng: its own draw, already made) and part
// its guilds' there. place(key) → rng: the place's dice.
export function siteLuck(e, own, siteKey, place) {
  const gs = guildsOf(e);
  if (!gs.length) return own;
  let z = 0, r2 = 0;
  for (const g of gs) { z += g.rho * place(`guild/${g.id}/${siteKey}`).normal(); r2 += g.rho ** 2; }
  return z + Math.sqrt(1 - r2) * own;
}

// How many of each thing live at a site: for each stone, plant and invertebrate whose habitat includes
// this microhabitat, as { e, n }. note(kind, id, fields): a draw for the range of outcomes (spread.js).
export function populationAt(world, micro, siteKey, factors, place, note = null) {
  const out = [];
  for (const e of [...world.stones, ...world.plants, ...world.animals]) {
    const h = e.habitats.find(x => x.micro === micro);
    if (!h || (e.kind === 'animal' && e.cls !== 'invertebrate')) continue;
    const ar = place(`abund/${e.id}/${siteKey}`);
    const z = siteLuck(e, ar.normal(), siteKey, place);
    const count = (h.perInstance ?? h.pieces) * Math.exp((e.kind === 'stone' ? 0 : 0.35 * factors.fertility) + 0.5 * z);
    const p = 1 - Math.exp(-count / 2), here = ar.chance(p);
    note?.('lives here', e.id, { name: e.name, count, luck: z, p, observed: here });
    if (!here) continue;
    out.push({ e, n: count });
  }
  return out;
}
// A vertebrate's density near a site (per km²): its usual density, with the site's luck. Its average over
// sites is the usual density.
export function densityAt(a, siteKey, place) {
  const z = siteLuck(a, place(`dens/${a.id}/${siteKey}`).normal(), siteKey, place);
  return (a.perKm2 ?? 0) * Math.exp(0.5 * z - 0.125);
}
