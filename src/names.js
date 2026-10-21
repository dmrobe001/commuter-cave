// names.js — resemblance naming.
//
// The character names unfamiliar species after familiar ones, the way colonists
// called a red-breasted thrush a "robin." Names are keyed to visible traits so
// they carry mild, imperfect information. Within a world, names are drawn
// without replacement; when a name would collide, it gets a word for how this
// one looks ("red peach", "tall grass", "big ant").

const TABLE = {
  // fruits and nuts
  drupe: ['plum', 'damson'],
  drupeRed: ['cherry', 'sloe'],
  drupeWarm: ['peach', 'apricot'],
  berryAggregate: ['raspberry', 'bramble'],
  berryDark: ['bilberry', 'blackcurrant'],
  berryRed: ['currant', 'cranberry'],
  berryPale: ['snowberry'],
  berryOrange: ['cloudberry'],
  acorn: ['oak'],
  nut: ['hazel', 'walnut', 'chestnut', 'beech'],
  podTree: ['locust', 'carob'],
  podHerb: ['bean', 'pea', 'vetch'],
  // distinctive trees and shrubs
  paperbark: ['birch'],
  resinTree: ['pine', 'fir', 'spruce', 'larch'],
  resinNut: ['pine', 'stone pine'], // a resinous tree with nuts in its cones looks like a pine (spruce seeds are tiny)
  resinShrub: ['juniper'],
  willowish: ['willow'],
  thornShrub: ['hawthorn', 'blackthorn'],
  pithShrub: ['elder'],
  treeWet: ['alder', 'poplar'],
  treeGeneric: ['ash', 'elm', 'maple', 'linden'],
  shrubLeathery: ['laurel', 'box', 'holly'],
  shrubGeneric: ['privet', 'dogwood', 'hazel'],
  // herbs
  umbel: ['wild carrot', 'cow parsley', 'fennel'],
  allium: ['wild onion', 'wild garlic'],
  mint: ['mint'],
  nettle: ['nettle'],
  milky: ['milkweed', 'spurge'],
  fluffHerb: ['fireweed', 'thistle'],
  stalkHerb: ['mullein', 'goldenrod'],
  tuber: ['wild potato', 'groundnut'],
  taproot: ['wild parsnip', 'wild turnip'],
  corm: ['pignut'],
  herbGeneric: ['dock', 'plantain', 'sorrel', 'chickweed'],
  // grasses
  fluffReed: ['cattail'],
  reed: ['reed', 'rush', 'sedge'],
  sawGrass: ['sawgrass'],
  rhizomeGrass: ['couch grass'],
  grain: ['wild wheat', 'wild barley', 'wild rye', 'millet'],
  grassGeneric: ['meadow grass', 'fescue'],
  // fungi, mosses, lichens
  gilledPale: ['field mushroom', 'parasol'],
  gilledBrown: ['brown mushroom', 'inkcap'],
  gilledBright: ['toadstool', 'chanterelle'],
  bracket: ['bracket fungus', 'hoof fungus'],
  puffball: ['puffball'],
  moss: ['moss'],
  bogMoss: ['bog moss'],
  beardLichen: ['beard lichen'],
  leafyLichen: ['reindeer moss', 'crust lichen'],
  // animals (keyed by template). One familiar name each: a second species gets an appearance word.
  bee: ['bee'],
  wasp: ['wasp', 'hornet'],
  mosquito: ['mosquito'],
  gnat: ['gnat', 'midge'],
  fly: ['fly', 'bluebottle'],
  stinker: ['skunk', 'polecat'],
  grub: ['grub'],
  ant: ['ant'],
  termite: ['termite'],
  worm: ['earthworm'],
  woodlouse: ['woodlouse'],
  cricket: ['cricket'],
  grasshopper: ['grasshopper'],
  caterpillar: ['caterpillar'],
  woolly: ['woolly bear'],
  beetle: ['beetle'],
  snail: ['snail'],
  crayfish: ['crayfish'],
  mussel: ['mussel'],
  rodent: ['vole', 'mouse'],
  hare: ['hare', 'rabbit'],
  lizard: ['lizard', 'skink'],
  frog: ['frog', 'toad'],
  groundbird: ['grouse', 'quail', 'partridge'],
  fish: ['trout', 'minnow', 'perch'],
  songbird: ['finch', 'warbler', 'thrush', 'sparrow', 'wren'],
  soarer: ['buzzard', 'kite', 'eagle'],
  browser: ['deer', 'elk', 'antelope'],
  rooter: ['boar'],
  predatorDog: ['wolf', 'wild dog'],
  predatorCat: ['lynx', 'big cat'],
  // stones (resemblance to familiar rocks, not necessarily the true type)
  flint: ['flint'],
  chert: ['flint', 'chert'],
  obsidian: ['obsidian'],
  basalt: ['basalt'],
  pumice: ['pumice'],
  granite: ['granite'],
  'vein quartz': ['quartz'],
  quartzite: ['quartzite'],
  sandstone: ['sandstone'],
  limestone: ['limestone'],
  shale: ['shale'],
  ironstone: ['ironstone'],
  slate: ['slate'],
};

// Words for how a plant looks, most telling first: what tells this one apart from a namesake.
const BARK_WORD = { 'grey-bark': 'grey', furrowbark: 'rough-barked', redbark: 'red-barked', streakbark: 'streaky' };
function plantLooks(t) {
  const w = [];
  if (['berry', 'drupe'].includes(t.fruit) && t.fruitColor) w.push(t.fruitColor);
  if (t.barkWord && BARK_WORD[t.barkWord]) w.push(BARK_WORD[t.barkWord]);
  if (t.form === 'grass' || t.form === 'herb') w.push(t.spindleStalk || t.fluff ? 'tall' : 'short');
  w.push(t.pace > 0.3 ? 'soft-leaved' : t.pace < -0.3 ? 'leathery' : 'broad-leaved', 'little', 'big');
  return w;
}
function plantKeys(t, home) {
  const s = [];
  const fruitKeys = () => {
    if (t.fruit === 'drupe') s.push(t.fruitColor === 'red' ? 'drupeRed' : ['orange', 'yellow'].includes(t.fruitColor) ? 'drupeWarm' : 'drupe');
    if (t.fruit === 'berry') s.push(t.fruitAggregate ? 'berryAggregate' : ['white', 'yellow'].includes(t.fruitColor) ? 'berryPale' : t.fruitColor === 'red' ? 'berryRed' : t.fruitColor === 'orange' ? 'berryOrange' : 'berryDark');
  };
  if (t.defense === 'sulfur') s.push('allium');
  if (t.umbel) s.push('umbel');
  if (t.squareStem) s.push('mint');
  if (t.defense === 'stinging') s.push('nettle');
  let generic;
  if (t.form === 'tree') {
    if (t.paperBark) s.push('paperbark');
    if (t.resin > 0.5) s.push(t.fruit === 'nut' ? 'resinNut' : 'resinTree');
    if (t.fruit === 'nut') s.push(t.defense === 'tannin' ? 'acorn' : 'nut');
    fruitKeys();
    if (t.fruit === 'pod') s.push('podTree');
    if (t.medicinal?.part === 'inner bark') s.push('willowish');
    generic = ['streambank', 'pond'].includes(home) ? 'treeWet' : 'treeGeneric';
  } else if (t.form === 'shrub') {
    if (t.resin > 0.5) s.push('resinShrub');
    if (t.defense === 'thorns') s.push('thornShrub');
    fruitKeys();
    if (t.spindleStalk) s.push('pithShrub');
    generic = t.pace < -0.3 ? 'shrubLeathery' : 'shrubGeneric';
  } else if (t.form === 'herb') {
    if (t.fruit === 'pod') s.push('podHerb');
    fruitKeys();
    if (t.storage && t.defense !== 'sulfur') s.push(t.storageKind);
    if (t.latex) s.push('milky');
    if (t.fluff) s.push('fluffHerb');
    if (t.spindleStalk) s.push('stalkHerb');
    generic = 'herbGeneric';
  } else {
    if (t.fluff && t.habitat.moisture > 0.8) s.push('fluffReed');
    if (t.defense === 'silica') s.push('sawGrass');
    if (t.habitat.moisture > 0.8) s.push('reed');
    if (t.storage) s.push('rhizomeGrass');
    s.push('grain');
    generic = 'grassGeneric';
  }
  return { specific: s, generic, modifiers: plantLooks(t) };
}

// Names that describe rather than resemble: the character coins these ("I'll call it ironstone"),
// rather than being reminded of something familiar.
const COINED = new Set(['ironstone', 'sandstone', 'woolly bear', 'bog moss', 'beard lichen', 'crust lichen', 'brown mushroom', 'hoof fungus', 'bracket fungus', 'sawgrass', 'meadow grass', 'couch grass']);

export function makeNamer(rng) {
  const used = new Set();
  const info = {}; // name → { base, coined }: the familiar part, and whether the name was made up
  const order = {};
  const listFor = key => (order[key] ??= rng.fork(`names/${key}`).shuffle([...(TABLE[key] ?? [key])]));
  const claim = (n, base = n, coined = COINED.has(n)) => { used.add(n); info[n] = { base, coined }; return n; };
  const tryList = keys => {
    for (const k of keys) for (const n of listFor(k)) if (!used.has(n)) return claim(n);
    return null;
  };
  const tryMods = (keys, mods) => {
    for (const k of keys) for (const n of listFor(k)) for (const m of mods) if (!used.has(`${m} ${n}`)) return claim(`${m} ${n}`, n, true);
    return null;
  };
  const take = ({ specific, generic, modifiers }) => {
    const gen = generic ? [generic] : [];
    const found = tryList(specific) ?? tryMods(specific.slice(0, 1), modifiers) ?? tryList(gen) ?? tryMods(gen, modifiers);
    if (found) return found;
    const base = listFor((specific[0] ?? generic))[0];
    for (const o of ['other', 'third', 'fourth', 'fifth']) if (!used.has(`${o} ${base}`)) return claim(`${o} ${base}`, base, true);
    let k = 6;
    while (used.has(`${base} ${k}`)) k++;
    return claim(`${base} ${k}`, base, true);
  };

  return {
    plant: (t, home) => take(plantKeys(t, home)),
    animal(t, home) {
      const key = t.key === 'predator' ? (t.pack ? 'predatorDog' : 'predatorCat') : t.hairy ? 'woolly' : t.key;
      const mods = [t.color, t.sizeWord ?? 'big', t.sizeWord === 'little' ? 'big' : 'little', 'dark', 'pale'];
      const n = take({ specific: [key], generic: null, modifiers: mods });
      if (!t.aposematic || n.startsWith(t.color)) return n;
      return claim(`${t.color} ${n}`, info[n].base, true);
    },
    stone: (type, color) => take({ specific: [type], generic: null, modifiers: [color, 'coarse', 'fine'] }),
    fungus: t => take({ specific: [t.nameKey], generic: null, modifiers: [t.color, 'little', 'big', 'dark', 'pale'] }),
    reserve: n => claim(n),
    info,
  };
}
