// process.js — draft process network for the early game.
//
// Processes consume items and raw materials and require tools (catalysts that wear).
// Raw materials are requested by *property*, never by species:
//     { material: 'dead-wood', role: 'hearth board', where: { density: [0.2, 0.45], resin: [0, 0.5] } }
// so the network is world-independent and gets matched against each world's parts.
//
// Units: durations in hours (lognormal: median, spread); attention 0–1 (share of focus);
// load per hour on body systems (arbitrary units, roughly 0 easy … 3 hard); kcal per hour.
// All numbers are first-draft placeholders informed loosely by experimental archaeology
// and primitive-skills practice.

// ------------------------------------------------------------ raw material classes

export const MATERIALS = {
  'dead-wood':  { name: 'dead wood', props: ['density', 'resin'] },
  'live-wood':  { name: 'green wood', props: ['density', 'straight', 'springy'] },
  'dead-stalk': { name: 'dead stalks', props: ['straight', 'pithy'] },
  'inner-bark': { name: 'inner bark', props: ['fiber', 'retting'] },
  'outer-bark': { name: 'outer bark', props: ['papery', 'tannin'] },
  'bast-stem':  { name: 'fibrous stems', props: ['fiber', 'retting'] },
  'leaf-fiber': { name: 'fibrous blades', props: ['fiber'] },
  'dry-grass':  { name: 'dry grass', props: [] },
  'fluff':      { name: 'seed fluff', props: [] },
  'fungus-tinder': { name: 'tinder fungus', props: [] },
  'lichen-tinder': { name: 'beard lichen', props: [] },
  'moss':       { name: 'moss', props: [] },
  'leaves':     { name: 'leaves', props: [] },
  'resin':      { name: 'resin', props: [] },
  'plant-food': { name: 'plant food', props: ['cookedSafe', 'leachedSafe', 'starchy', 'stores'] },
  'stone':      { name: 'stone', props: ['fracture', 'hardness', 'flaws', 'heatTreatable', 'spallSafe', 'abrasive', 'slab'] },
  'clay':       { name: 'clay', props: ['plasticity'] },
  'water':      { name: 'water', props: ['flowing'] },
  'small-game': { name: 'small game', props: [] },
  'shell':      { name: 'shells', props: [] },
  'natural-edge': { name: 'naturally sharp stone', props: ['sharpness', 'hardness', 'rate'] },
  'bone':       { name: 'bone', props: ['hardness'] },
};

// How the character describes a property requirement when thinking aloud.
const PROP_WORDS = {
  density: ([lo, hi]) => (hi <= 0.5 ? 'light and soft' : lo >= 0.55 ? 'dense and hard' : lo < 0.3 && hi <= 0.6 ? 'light and soft, the softer the better' : 'medium-weight'),
  resin: ([, hi]) => (hi <= 0.5 ? 'not resinous' : 'resinous'),
  straight: () => 'straight', springy: () => 'springy', pithy: () => 'pithy', papery: () => 'papery',
  fiber: ([lo]) => (lo >= 0.65 ? 'very strong-fibred' : 'strong-fibred'),
  retting: () => 'clean-retting', fracture: ([lo]) => (lo >= 0.7 ? 'very clean-breaking' : 'clean-breaking'),
  hardness: () => 'hard', flaws: () => 'free of hidden cracks', heatTreatable: () => 'good for heat-treating',
  spallSafe: () => 'safe in a fire', abrasive: () => 'gritty', slab: () => 'flat',
  cookedSafe: () => 'safe cooked', leachedSafe: () => 'safe leached', starchy: () => 'starchy', stores: () => 'keeps well',
  plasticity: () => 'plastic', flowing: () => 'running', tannin: () => 'tannin-rich',
};

// What the character knows about *how to look* for a material with a given property.
// These are the bridge to the action grammar: each hint names a search and a test.
const LOOK_HINTS = {
  'dead-wood:density-low': 'fallen wood that feels light for its size and dents under a thumbnail',
  'shell': 'empty shells along the banks',
  'natural-edge:sharpness': 'freshly broken rock on scree or outcrops; glassy stone breaks sharpest',
  'bone': 'old bones where something died; circling birds can point the way',
  'clay:plasticity': 'sticky clay that rolls into a coil without cracking',
  'dead-wood:density-high': 'heavy, hard dead wood that won\'t dent',
  'dead-wood': 'fallen branches, dry enough to snap crisply',
  'dead-stalk': 'tall plants that died back and left straight stalks standing',
  'live-wood:springy': 'a green shoot that bends far and springs back',
  'live-wood:straight': 'straight green shoots, trimmed and left to dry',
  'live-wood:density-high': 'dense green wood that\'s hard to dent',
  'inner-bark': 'strip inner bark and twist it: good fibre folds without snapping',
  'bast-stem': 'long stringy stems that bend without breaking; twist-test them',
  'leaf-fiber': 'long tough blades; twist-test them',
  'outer-bark:papery': 'bark that peels off in thin papery sheets',
  'stone:fracture': 'glassy or waxy stone; test-break it and look for smooth, curved surfaces and sharp edges',
  'stone:hardness': 'a dense, fist-sized cobble that rings when struck',
  'stone:slab': 'a flat, heavy slab',
  'stone:spallSafe': 'dense stones, not porous ones or ones from the stream bed',
  'stone:abrasive': 'gritty stone that scratches easily',
  'dry-grass': 'standing dead grass, bone dry',
  'fluff': 'seed heads that break into fluff',
  'fungus-tinder': 'hard, hoof-shaped brackets on dead wood, brown and suede-like inside',
  'lichen-tinder': 'dry, beard-like lichen hanging from branches',
  'water:flowing': 'a stream or spring',
};


// ------------------------------------------------------------ items

export const ITEMS = {
  hammerstone:          { name: 'a hammerstone', kind: 'tool' },
  anvil:                { name: 'an anvil stone', kind: 'tool' },
  flake:                { name: 'a sharp flake', kind: 'tool' },
  'heat-treated-stone': { name: 'heat-treated stone', kind: 'material' },
  chopper:              { name: 'a chopper', kind: 'tool' },
  scraper:              { name: 'a scraper', kind: 'tool' },
  handaxe:              { name: 'a hand axe', kind: 'tool' },
  'digging-stick':      { name: 'a digging stick', kind: 'tool' },
  spear:                { name: 'a wooden spear', kind: 'tool' },
  'tinder-bundle':      { name: 'a tinder bundle', kind: 'material' },
  kindling:             { name: 'kindling', kind: 'material' },
  firewood:             { name: 'firewood', kind: 'material' },
  'hearth-board':       { name: 'a hearth board', kind: 'part' },
  spindle:              { name: 'a spindle', kind: 'part' },
  'hand-drill':         { name: 'a hand drill', kind: 'tool' },
  bow:                  { name: 'a drill bow', kind: 'part' },
  'bearing-block':      { name: 'a bearing block', kind: 'part' },
  'bow-drill':          { name: 'a bow drill', kind: 'tool' },
  ember:                { name: 'an ember', kind: 'transient' },
  fire:                 { name: 'a fire', kind: 'station' },
  charcoal:             { name: 'charcoal', kind: 'material' },
  'retted-fiber':       { name: 'retted fibre', kind: 'material' },
  cordage:              { name: 'cordage', kind: 'material' },
  'grass-mat':          { name: 'a woven grass mat', kind: 'item' },
  'bark-container':     { name: 'a watertight container', kind: 'tool' },
  'cooking-stones':     { name: 'cooking stones', kind: 'tool' },
  'safe-water':         { name: 'boiled water', kind: 'consumable' },
  'cooked-food':        { name: 'cooked food', kind: 'consumable' },
  'leached-food':       { name: 'leached food', kind: 'consumable' },
  'grinding-slab':      { name: 'a grinding slab', kind: 'tool' },
  meal:                 { name: 'ground meal', kind: 'consumable' },
  bedding:              { name: 'bedding', kind: 'item' },
  'debris-hut':         { name: 'a debris hut', kind: 'station' },
  'lean-to':            { name: 'a thatched lean-to', kind: 'station' },
  snare:                { name: 'a snare', kind: 'tool' },
  'deadfall-trap':      { name: 'a deadfall trap', kind: 'tool' },
  meat:                 { name: 'meat', kind: 'consumable' },
  hide:                 { name: 'a hide', kind: 'material' },
  sinew:                { name: 'sinew', kind: 'material' },
  'drying-rack':        { name: 'a drying rack', kind: 'station' },
  'dried-meat':         { name: 'dried meat', kind: 'consumable' },
  tar:                  { name: 'birch tar', kind: 'material' },
  'resin-glue':         { name: 'resin glue', kind: 'material' },
  'hafted-knife':       { name: 'a hafted knife', kind: 'tool' },
  'hafted-spear':       { name: 'a stone-tipped spear', kind: 'tool' },
};

// ------------------------------------------------------------ processes

const M = (material, role, where = {}, qty = 1) => ({ material, role, where, qty });
const I = (item, qty = 1) => ({ item, qty });
const TOOL = (item, wear = 0.02) => ({ item, wear });

export const PROCESSES = [
  // --- stone
  { id: 'pick-hammerstone', name: 'Pick out a hammerstone', makes: [I('hammerstone')], uses: [M('stone', 'hammerstone', { hardness: [5.5, 10] })], tools: [],
    hours: [0.1, 0.3], attention: 0.4, load: { eyes: 0.5 }, kcal: 150, skill: null, success: 0.95 },
  { id: 'pick-anvil', name: 'Find an anvil stone', makes: [I('anvil')], uses: [M('stone', 'anvil', { slab: [1, 1] })], tools: [],
    hours: [0.1, 0.3], attention: 0.3, load: { back: 0.5 }, kcal: 180, skill: null, success: 0.95 },
  { id: 'bipolar-flaking', name: 'Smash pebbles on an anvil (bipolar flaking)', makes: [I('flake', 3)], uses: [M('stone', 'pebbles', { fracture: [0.3, 1] }, 3)], tools: [TOOL('hammerstone', 0.01), TOOL('anvil', 0.005)],
    hours: [0.25, 0.3], attention: 0.7, load: { hands: 1.5, eyes: 1 }, kcal: 200, skill: 'knapping', success: 0.6,
    notes: 'Little skill needed; small, irregular flakes. Flying chips: eye-injury risk.' },
  { id: 'freehand-knapping', name: 'Knap flakes freehand', makes: [I('flake', 4)], uses: [M('stone', 'core', { fracture: [0.5, 1], flaws: [0, 0.3] })], tools: [TOOL('hammerstone', 0.01)],
    hours: [0.5, 0.3], attention: 0.9, load: { hands: 2, forearms: 1.5, eyes: 1 }, kcal: 220, skill: 'knapping', success: 0.35,
    notes: 'Better flakes than bipolar; success climbs steeply with skill. Cuts and bruised fingers.' },
  { id: 'pick-natural-edge', name: 'Search for naturally sharp stone', makes: [I('flake')], uses: [M('natural-edge', 'sharp piece', { sharpness: [0.35, 1] })], tools: [],
    hours: [0.5, 0.4], attention: 0.7, load: { eyes: 1 }, kcal: 180, skill: null, success: 0.6,
    notes: 'Frost-shattered scree and freshly broken outcrops are best; stream cobbles are rounded. Edges are irregular.' },
  { id: 'splinter-bone', name: 'Smash a long bone into sharp splinters', makes: [I('flake', 2)], uses: [M('bone', 'long bone')], tools: [TOOL('hammerstone', 0.005)],
    hours: [0.2, 0.3], attention: 0.6, load: { hands: 0.5 }, kcal: 160, skill: null, success: 0.7,
    notes: 'Bone (hardness ~3) cuts wood but dulls several times faster than flint.' },
  { id: 'shell-edge', name: 'Break a shell to a sharp edge', makes: [I('flake')], uses: [M('shell', 'shell')], tools: [],
    hours: [0.1, 0.3], attention: 0.5, load: { hands: 0.5 }, kcal: 130, skill: null, success: 0.8,
    notes: 'Freshwater shell edges cut and scrape, but dull quickly.' },
  { id: 'heat-treat', name: 'Heat-treat stone in a sand bed under the fire', makes: [I('heat-treated-stone')], uses: [M('stone', 'stone to treat', { heatTreatable: [1, 1] })], tools: [TOOL('fire', 0)],
    hours: [0.5, 0.3], wait: [12, 0.3], attention: 0.2, load: {}, kcal: 120, skill: 'knapping', success: 0.7,
    notes: 'Too hot and the stone crazes. Waiting time runs in the background.' },
  { id: 'make-scraper', name: 'Retouch a flake into a scraper', makes: [I('scraper')], uses: [I('flake')], tools: [TOOL('hammerstone', 0.005)],
    hours: [0.2, 0.3], attention: 0.8, load: { hands: 1 }, kcal: 160, skill: 'knapping', success: 0.6 },
  { id: 'make-chopper', name: 'Flake an edge onto a cobble (chopper)', makes: [I('chopper')], uses: [M('stone', 'cobble', { fracture: [0.4, 1], hardness: [5.5, 10] })], tools: [TOOL('hammerstone', 0.01)],
    hours: [0.3, 0.3], attention: 0.8, load: { hands: 1.5, forearms: 1.5 }, kcal: 220, skill: 'knapping', success: 0.55 },
  { id: 'make-handaxe', name: 'Shape a hand axe', makes: [I('handaxe')], uses: [M('stone', 'large core', { fracture: [0.6, 1], flaws: [0, 0.25] })], tools: [TOOL('hammerstone', 0.02)],
    hours: [2, 0.4], attention: 1, load: { hands: 2.5, forearms: 2, eyes: 1.5 }, kcal: 230, skill: 'knapping', success: 0.15,
    notes: 'Demanding: most early attempts snap or end up as cores.' },

  // --- wood
  { id: 'make-digging-stick', name: 'Shape a digging stick', makes: [I('digging-stick')], uses: [M('live-wood', 'stick', { density: [0.55, 1] })], tools: [TOOL('flake', 0.1)],
    hours: [0.5, 0.3], attention: 0.6, load: { hands: 1 }, kcal: 170, skill: 'woodwork', success: 0.9 },
  { id: 'make-spear', name: 'Shape and fire-harden a wooden spear', makes: [I('spear')], uses: [M('live-wood', 'shaft', { density: [0.5, 1], straight: [1, 1] })], tools: [TOOL('flake', 0.15), TOOL('fire', 0)],
    hours: [1.5, 0.3], attention: 0.7, load: { hands: 1.5, forearms: 1 }, kcal: 180, skill: 'woodwork', success: 0.8 },

  // --- fire
  { id: 'make-tinder', name: 'Make a tinder bundle', makes: [I('tinder-bundle')],
    uses: [{ any: [M('dry-grass', 'tinder'), M('fluff', 'tinder'), M('fungus-tinder', 'tinder'), M('lichen-tinder', 'tinder'), M('outer-bark', 'tinder', { papery: [1, 1] }), M('inner-bark', 'tinder', { fiber: [0.4, 1] })] }], tools: [],
    hours: [0.2, 0.3], attention: 0.5, load: { hands: 0.5 }, kcal: 140, skill: 'firecraft', success: 0.95, notes: 'Must be bone dry.' },
  { id: 'gather-kindling', name: 'Gather kindling', makes: [I('kindling')], uses: [M('dead-wood', 'kindling')], tools: [],
    hours: [0.25, 0.3], attention: 0.3, load: { back: 0.5 }, kcal: 200, skill: null, success: 1 },
  { id: 'gather-firewood', name: 'Gather firewood', makes: [I('firewood')], uses: [M('dead-wood', 'fuel', {}, 4)], tools: [],
    hours: [1, 0.3], attention: 0.3, load: { back: 1.5, legs: 1 }, kcal: 300, skill: null, success: 1, notes: 'Denser wood burns longer.' },
  { id: 'make-hearth-board', name: 'Split and notch a hearth board', makes: [I('hearth-board')], uses: [M('dead-wood', 'hearth board', { density: [0.15, 0.55], resin: [0, 0.5] })], tools: [TOOL('flake', 0.05)],
    hours: [0.4, 0.3], attention: 0.6, load: { hands: 1 }, kcal: 160, skill: 'woodwork', success: 0.85,
    notes: 'Softer is easier: ember success should fall off above density ~0.4.' },
  { id: 'make-spindle-stalk', name: 'Trim a spindle from a dead stalk', makes: [I('spindle')], uses: [M('dead-stalk', 'spindle', { straight: [1, 1] })], tools: [],
    hours: [0.15, 0.3], attention: 0.4, load: {}, kcal: 130, skill: 'woodwork', success: 0.9 },
  { id: 'make-spindle-wood', name: 'Carve a spindle from a straight shoot', makes: [I('spindle')], uses: [M('live-wood', 'spindle', { density: [0.3, 0.55], straight: [1, 1] })], tools: [TOOL('flake', 0.05)],
    hours: [0.5, 0.3], wait: [48, 0.3], attention: 0.6, load: { hands: 1 }, kcal: 160, skill: 'woodwork', success: 0.85, notes: 'Must dry for a couple of days.' },
  { id: 'assemble-hand-drill', name: 'Pair a spindle with a hearth board', makes: [I('hand-drill')], uses: [I('spindle'), I('hearth-board')], tools: [],
    hours: [0.1, 0.2], attention: 0.3, load: {}, kcal: 120, skill: null, success: 1 },
  { id: 'make-bow', name: 'Cut and string a drill bow', makes: [I('bow')], uses: [M('live-wood', 'bow', { springy: [1, 1] }), I('cordage')], tools: [TOOL('flake', 0.05)],
    hours: [0.4, 0.3], attention: 0.5, load: { hands: 0.5 }, kcal: 150, skill: 'woodwork', success: 0.9 },
  { id: 'make-bearing-block', name: 'Find or shape a bearing block', makes: [I('bearing-block')],
    uses: [{ any: [M('stone', 'bearing block', { hardness: [5.5, 10] }), M('dead-wood', 'bearing block', { density: [0.6, 1] })] }], tools: [],
    hours: [0.2, 0.3], attention: 0.4, load: {}, kcal: 130, skill: null, success: 0.95 },
  { id: 'assemble-bow-drill', name: 'Assemble a bow drill', makes: [I('bow-drill')], uses: [I('spindle'), I('hearth-board'), I('bow'), I('bearing-block')], tools: [],
    hours: [0.2, 0.2], attention: 0.4, load: {}, kcal: 120, skill: null, success: 1 },
  { id: 'hand-drill-ember', name: 'Spin an ember with the hand drill', makes: [I('ember')], uses: [], tools: [TOOL('hand-drill', 0.1)],
    hours: [0.25, 0.4], attention: 1, load: { hands: 3, shoulders: 2 }, kcal: 400, skill: 'firecraft', success: 0.08,
    notes: 'Per attempt. Blisters fast; novices often fail for days. Success depends on hearth and spindle quality.' },
  { id: 'bow-drill-ember', name: 'Saw an ember with the bow drill', makes: [I('ember')], uses: [], tools: [TOOL('bow-drill', 0.05)],
    hours: [0.15, 0.4], attention: 1, load: { hands: 1, shoulders: 2, back: 1 }, kcal: 380, skill: 'firecraft', success: 0.3,
    notes: 'Per attempt. Far easier on the hands than a hand drill; needs cordage.' },
  { id: 'build-fire', name: 'Blow an ember into flame and build a fire', makes: [I('fire')], uses: [I('ember'), I('tinder-bundle'), I('kindling'), I('firewood')], tools: [],
    hours: [0.15, 0.3], attention: 0.9, load: { lungs: 1 }, kcal: 180, skill: 'firecraft', success: 0.7 },
  { id: 'make-charcoal', name: 'Rake out charcoal', makes: [I('charcoal')], uses: [], tools: [TOOL('fire', 0)],
    hours: [0.1, 0.2], attention: 0.2, load: {}, kcal: 120, skill: null, success: 1 },

  // --- fibre and cordage
  { id: 'ret-fiber', name: 'Ret fibrous stems or bark in water', makes: [I('retted-fiber')],
    uses: [{ any: [M('bast-stem', 'fibre', { fiber: [0.5, 1], retting: [0.4, 1] }), M('inner-bark', 'fibre', { fiber: [0.5, 1], retting: [0.4, 1] })] }, M('water', 'retting water')], tools: [],
    hours: [0.5, 0.3], wait: [240, 0.4], attention: 0.3, load: { hands: 0.5 }, kcal: 150, skill: 'fibrecraft', success: 0.75,
    notes: 'One to three weeks in water, checked now and then. Too long and it rots.' },
  { id: 'twist-cordage', name: 'Twist cordage', makes: [I('cordage')],
    uses: [{ any: [I('retted-fiber'), M('inner-bark', 'fibre', { fiber: [0.55, 1] }), M('leaf-fiber', 'fibre', { fiber: [0.5, 1] })] }], tools: [],
    hours: [0.5, 0.3], attention: 0.4, load: { hands: 1, eyes: 0.5 }, kcal: 130, skill: 'fibrecraft', success: 0.9,
    notes: 'A few metres per hour. Low attention: can be done while tending a fire or keeping watch.' },
  { id: 'weave-mat', name: 'Weave a grass mat', makes: [I('grass-mat')], uses: [{ any: [M('leaf-fiber', 'weaving'), M('dry-grass', 'weaving')] }], tools: [],
    hours: [2, 0.3], attention: 0.4, load: { hands: 1 }, kcal: 130, skill: 'fibrecraft', success: 0.85 },

  // --- containers, water, cooking
  { id: 'make-bark-container', name: 'Fold and stitch a bark container', makes: [I('bark-container')], uses: [M('outer-bark', 'container', { papery: [1, 1] }), I('cordage')], tools: [TOOL('flake', 0.05)],
    hours: [1, 0.3], attention: 0.6, load: { hands: 1 }, kcal: 150, skill: 'fibrecraft', success: 0.75, notes: 'Holds water; can be used for stone boiling.' },
  { id: 'make-hide-container', name: 'Hang a hide as a boiling bag', makes: [I('bark-container')], uses: [I('hide'), M('live-wood', 'frame poles', {}, 3)], tools: [],
    hours: [0.5, 0.3], attention: 0.4, load: { hands: 0.5 }, kcal: 140, skill: null, success: 0.85,
    notes: 'Stone boiling in a hide slung from poles; small hides hold little.' },
  { id: 'dig-clay-pit', name: 'Dig and clay-line a boiling pit', makes: [I('bark-container')], uses: [M('clay', 'lining', { plasticity: [0.35, 1] })], tools: [TOOL('digging-stick', 0.05)],
    hours: [1.5, 0.3], attention: 0.4, load: { back: 1.5, hands: 1 }, kcal: 300, skill: null, success: 0.8,
    notes: 'A fixed station, not portable.' },
  { id: 'pick-cooking-stones', name: 'Pick out cooking stones', makes: [I('cooking-stones')], uses: [M('stone', 'cooking stones', { spallSafe: [1, 1] }, 4)], tools: [],
    hours: [0.2, 0.3], attention: 0.4, load: { back: 0.5 }, kcal: 160, skill: null, success: 0.9, notes: 'Wet or porous stones can burst when heated.' },
  { id: 'boil-water', name: 'Boil water with hot stones', makes: [I('safe-water')], uses: [M('water', 'water')], tools: [TOOL('bark-container', 0.1), TOOL('cooking-stones', 0.02), TOOL('fire', 0)],
    hours: [0.75, 0.3], attention: 0.5, load: { hands: 0.5 }, kcal: 140, skill: null, success: 0.9 },
  { id: 'cook-food', name: 'Cook food on the coals', makes: [I('cooked-food')], uses: [M('plant-food', 'food', { cookedSafe: [1, 1] })], tools: [TOOL('fire', 0)],
    hours: [0.5, 0.3], attention: 0.4, load: {}, kcal: 120, skill: 'cooking', success: 0.95 },
  { id: 'leach-food', name: 'Crush and leach food in running water', makes: [I('leached-food')], uses: [M('plant-food', 'food', { leachedSafe: [1, 1] }), M('water', 'running water', { flowing: [1, 1] })], tools: [TOOL('hammerstone', 0.005)],
    hours: [0.5, 0.3], wait: [48, 0.4], attention: 0.3, load: { hands: 0.5 }, kcal: 150, skill: 'cooking', success: 0.85, notes: 'Acorn-style bitter foods. Days of soaking.' },
  { id: 'pick-grinding-slab', name: 'Find a grinding slab', makes: [I('grinding-slab')], uses: [M('stone', 'grinding slab', { abrasive: [1, 1] })], tools: [],
    hours: [0.3, 0.3], attention: 0.3, load: { back: 1 }, kcal: 200, skill: null, success: 0.9 },
  { id: 'grind-meal', name: 'Grind seeds into meal', makes: [I('meal')], uses: [M('plant-food', 'seeds', { starchy: [1, 1], cookedSafe: [1, 1] })], tools: [TOOL('grinding-slab', 0.005), TOOL('hammerstone', 0.005)],
    hours: [1, 0.3], attention: 0.3, load: { shoulders: 1.5, back: 1 }, kcal: 250, skill: 'cooking', success: 0.95, notes: 'Slow, tiring, but turns grass seed into real calories.' },

  // --- shelter
  { id: 'make-bedding', name: 'Gather bedding', makes: [I('bedding')], uses: [{ any: [M('dry-grass', 'bedding', {}, 3), M('leaves', 'bedding', {}, 3)] }], tools: [],
    hours: [0.5, 0.3], attention: 0.3, load: { back: 0.5 }, kcal: 200, skill: null, success: 1 },
  { id: 'build-debris-hut', name: 'Build a debris hut', makes: [I('debris-hut')], uses: [M('dead-wood', 'frame', {}, 12), { any: [M('leaves', 'insulation', {}, 10), M('dry-grass', 'insulation', {}, 10)] }], tools: [],
    hours: [3.5, 0.3], attention: 0.4, load: { back: 2, legs: 1.5, hands: 1 }, kcal: 320, skill: 'shelter', success: 0.9,
    notes: 'The most important early shelter: warm, quick, no tools. Leaks without thick cover.' },
  { id: 'build-lean-to', name: 'Build a thatched lean-to', makes: [I('lean-to')], uses: [M('live-wood', 'poles', { straight: [1, 1] }, 8), I('cordage'), { any: [M('leaf-fiber', 'thatch', {}, 10), M('dry-grass', 'thatch', {}, 10)] }], tools: [TOOL('flake', 0.2)],
    hours: [6, 0.3], attention: 0.5, load: { back: 2, hands: 1.5, shoulders: 1 }, kcal: 300, skill: 'shelter', success: 0.85,
    notes: 'Sheds rain well; best with a fire in front.' },

  // --- trapping and game
  { id: 'make-snare', name: 'Set a snare', makes: [I('snare')], uses: [I('cordage'), M('live-wood', 'trigger sticks')], tools: [TOOL('flake', 0.02)],
    hours: [0.3, 0.3], attention: 0.6, load: { hands: 0.5 }, kcal: 150, skill: 'trapping', success: 0.8, notes: 'Set on runs; check daily.' },
  { id: 'make-deadfall', name: 'Set a deadfall trap', makes: [I('deadfall-trap')], uses: [M('stone', 'slab', { slab: [1, 1] }), M('live-wood', 'trigger sticks')], tools: [TOOL('flake', 0.02)],
    hours: [0.5, 0.3], attention: 0.7, load: { hands: 0.5, back: 0.5 }, kcal: 170, skill: 'trapping', success: 0.6, notes: 'Fiddly trigger. Pinched fingers.' },
  { id: 'check-traps', name: 'Check traps', makes: [{ item: 'small-game-catch', qty: 1 }], uses: [], tools: [{ anyTool: ['snare', 'deadfall-trap'], wear: 0.1 }],
    hours: [1, 0.3], attention: 0.4, load: { legs: 1 }, kcal: 250, skill: 'trapping', success: 0.2, notes: 'Per trap per day; depends on the runs chosen.' },
  { id: 'butcher-small', name: 'Butcher small game', makes: [I('meat'), I('hide'), I('sinew')], uses: [M('small-game', 'carcass')], tools: [TOOL('flake', 0.05)],
    hours: [0.5, 0.3], attention: 0.6, load: { hands: 0.5 }, kcal: 140, skill: 'butchery', success: 0.95 },
  { id: 'build-drying-rack', name: 'Build a drying rack', makes: [I('drying-rack')], uses: [M('live-wood', 'poles', { straight: [1, 1] }, 4), I('cordage')], tools: [TOOL('flake', 0.05)],
    hours: [1, 0.3], attention: 0.4, load: { hands: 1 }, kcal: 180, skill: 'woodwork', success: 0.9 },
  { id: 'dry-meat', name: 'Smoke-dry meat over the fire', makes: [I('dried-meat')], uses: [I('meat')], tools: [TOOL('drying-rack', 0.02), TOOL('fire', 0)],
    hours: [0.5, 0.3], wait: [24, 0.3], attention: 0.2, load: {}, kcal: 120, skill: 'cooking', success: 0.85 },

  // --- adhesives and hafting
  { id: 'make-tar', name: 'Cook birch tar from bark', makes: [I('tar')], uses: [M('outer-bark', 'tar bark', { papery: [1, 1] }, 3)], tools: [TOOL('fire', 0)],
    hours: [2, 0.3], attention: 0.6, load: { eyes: 1 }, kcal: 140, skill: 'firecraft', success: 0.4,
    notes: 'Burn bark against a cool stone and scrape off the condensed tar. Low yield, smoky.' },
  { id: 'make-resin-glue', name: 'Melt resin with charcoal into glue', makes: [I('resin-glue')], uses: [M('resin', 'resin'), I('charcoal')], tools: [TOOL('fire', 0)],
    hours: [0.5, 0.3], attention: 0.6, load: {}, kcal: 130, skill: 'firecraft', success: 0.7 },
  { id: 'haft-knife', name: 'Haft a flake into a knife', makes: [I('hafted-knife')], uses: [I('flake'), M('live-wood', 'handle', { density: [0.5, 1] }), { any: [I('cordage'), I('sinew')] }, { any: [I('tar'), I('resin-glue')] }], tools: [],
    hours: [1, 0.3], attention: 0.7, load: { hands: 1 }, kcal: 150, skill: 'hafting', success: 0.6 },
  { id: 'haft-spear', name: 'Haft a stone point onto a spear', makes: [I('hafted-spear')], uses: [I('flake'), I('spear'), { any: [I('cordage'), I('sinew')] }, { any: [I('tar'), I('resin-glue')] }], tools: [],
    hours: [1, 0.3], attention: 0.7, load: { hands: 1 }, kcal: 150, skill: 'hafting', success: 0.6 },
];
ITEMS['small-game-catch'] = { name: 'a catch from the traps', kind: 'transient', yieldsMaterial: 'small-game' };

// Top-level goals offered to the player at the start.
export const STARTER_GOALS = ['fire', 'debris-hut', 'safe-water', 'flake', 'cordage', 'cooked-food', 'digging-stick'];

// ------------------------------------------------------------ world materials

// Turn a generated world's parts into material records with numeric properties.
export function materialsOf(world) {
  const out = [];
  const tool = s => (/cutting edge/.test(s) ? 'flake' : /digging stick/.test(s) ? 'digging-stick' : /chopper/.test(s) ? 'chopper' : null);
  const add = (material, src, part, props, collect) => out.push({ material, source: src.id, sourceName: src.gmName ?? src.name, part, props, collect });
  for (const p of world.plants) {
    const t = p.traits;
    for (const x of p.parts) {
      const c = tool(x.collect);
      if (x.part === 'dead wood') add('dead-wood', p, x.part, { density: t.woodDensity, resin: t.resin }, null);
      if (x.part === 'live branches' || x.part === 'stems and shoots') {
        const straight = t.form === 'shrub' ? (t.spindleStalk || (t.woodDensity >= 0.3 && t.woodDensity <= 0.55)) : true;
        add('live-wood', p, x.part, { density: t.woodDensity, straight: straight ? 1 : 0, springy: t.woodDensity >= 0.45 && t.woodDensity <= 0.8 ? 1 : 0 }, t.form === 'shrub' ? null : c);
      }
      if (x.part === 'dead stalks') add('dead-stalk', p, x.part, { straight: 1, pithy: 1 }, null);
      if (x.part === 'inner bark') add('inner-bark', p, x.part, { fiber: t.fiber, retting: t.retting }, c);
      if (x.part === 'outer bark') add('outer-bark', p, x.part, { papery: t.paperBark ? 1 : 0, tannin: t.defense === 'tannin' ? 1 : 0 }, c);
      if (x.part === 'resin') add('resin', p, x.part, {}, null);
      if (x.part === 'stems' && t.fiber > 0.4 && t.form !== 'grass') add('bast-stem', p, x.part, { fiber: t.fiber, retting: t.retting }, null);
      if (x.part === 'blades' && t.fiber > 0.4) add('leaf-fiber', p, x.part, { fiber: t.fiber }, null);
      if (x.part === 'dry grass') add('dry-grass', p, x.part, {}, null);
      if (x.part === 'seed fluff') add('fluff', p, x.part, {}, null);
      if (x.part === 'bracket' && t.tinderFungus) add('fungus-tinder', p, x.part, {}, null);
      if (x.part === 'lichen strands') add('lichen-tinder', p, x.part, {}, null);
      if (x.part === 'moss') add('moss', p, x.part, {}, null);
      if (x.part === 'leaves' && (t.form === 'tree' || t.form === 'shrub')) add('leaves', p, x.part, {}, null);
      if (x.food) {
        add('plant-food', p, x.part, {
          cookedSafe: x.food.cooked === 'safe' ? 1 : 0, leachedSafe: x.food.leached === 'safe' ? 1 : 0,
          starchy: /starch/.test(x.nutrition ?? '') ? 1 : 0, stores: /stores well/.test(x.nutrition ?? '') ? 1 : 0,
        }, tool(x.collect));
      }
    }
  }
  for (const s of world.stones) {
    const h = s.hidden;
    add('stone', s, h.type, {
      fracture: h.fracture, hardness: h.hardness, flaws: h.flawRate, heatTreatable: h.heatTreatable ? 1 : 0,
      spallSafe: h.spallRisk < 0.25 ? 1 : 0, spall: h.spallRisk, abrasive: s.uses.some(u => /abrasive/.test(u)) ? 1 : 0,
      slab: s.uses.some(u => /flat slabs/.test(u)) || ['granite', 'basalt', 'sandstone'].includes(h.type) ? 1 : 0,
    }, null);
  }
  for (const c of world.clay) add('clay', c, 'clay', { plasticity: c.hidden.plasticity }, null);
  for (const w of world.water) if (w.micro !== 'anywhere') add('water', w, w.name, { flowing: /stream|spring/.test(w.name) ? 1 : 0 }, null);
  for (const a of world.animals.filter(a => a.cls === 'small' && /snare|trap/.test(a.catch))) add('small-game', a, 'whole animal', {}, 'small-game-catch');
  for (const a of world.animals.filter(a => a.products.some(p => /shell/.test(p)))) add('shell', a, 'shell', {}, null);
  // Naturally sharp stone: share of pieces with a usable edge depends on how glassy the stone is
  // and where it lies (frost-shattered scree and outcrops high, rounded stream cobbles low).
  const EDGE_SITE = { scree: 1, outcrop: 0.6, glade: 0.2, streambed: 0.1 };
  for (const st of world.stones) {
    const site = Math.max(...st.habitats.map(h => EDGE_SITE[h.micro] ?? 0));
    const frost = world.environment.meanTempC < 8 ? 1.5 : 1;
    const rate = site * frost * (0.15 + 0.85 * st.hidden.fracture); // relative chance a search turns one up
    if (rate > 0.05) add('natural-edge', st, `${st.hidden.type} (natural edges)`, { sharpness: 0.25 + 0.5 * st.hidden.fracture, hardness: st.hidden.hardness, rate }, null);
  }
  // Bone: from remains of vertebrates big enough to have usable long bones.
  for (const a of world.animals.filter(a => a.cls !== 'invertebrate' && (a.traits.mass ?? 0) >= 2)) add('bone', a, 'bones from remains', { hardness: 3 }, null);
  return out;
}

export function matches(slot, mat) {
  if (mat.material !== slot.material) return false;
  return Object.entries(slot.where ?? {}).every(([k, [lo, hi]]) => mat.props[k] != null && mat.props[k] >= lo && mat.props[k] <= hi);
}
export const candidatesFor = (slot, mats) => mats.filter(m => matches(slot, m));

// ------------------------------------------------------------ reachability

// Forward closure: which items can this world produce at all, starting from bare hands?
// (Ignores skill and luck; it's a solvability check, not a simulation.)
export function reachable(world) {
  const mats = materialsOf(world);
  const have = new Set();
  const via = {};
  const ok = req => {
    if (req.any) return req.any.some(ok);
    if (req.anyTool) return req.anyTool.some(t => have.has(t));
    if (req.item) return have.has(req.item);
    return candidatesFor(req, mats).some(m => !m.collect || have.has(m.collect));
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of PROCESSES) {
      if (p.makes.every(mk => have.has(mk.item))) continue;
      if (p.uses.every(ok) && p.tools.every(ok)) {
        for (const mk of p.makes) if (!have.has(mk.item)) { have.add(mk.item); via[mk.item] = p.id; changed = true; }
      }
    }
  }
  return { have, via, unreachable: Object.keys(ITEMS).filter(k => !have.has(k)) };
}

// Network structure: how many processes consume each item, and minimum process depth from raw materials.
export function networkStats() {
  const consumers = {};
  const reqItems = req => (req.any ? req.any.flatMap(reqItems) : req.anyTool ? req.anyTool : req.item ? [req.item] : []);
  for (const p of PROCESSES) for (const it of new Set([...p.uses, ...p.tools].flatMap(reqItems))) (consumers[it] ??= []).push(p.id);
  const depth = {};
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of PROCESSES) {
      const d = req => (req.any ? Math.min(...req.any.map(d)) : req.anyTool ? Math.min(...req.anyTool.map(t => depth[t] ?? Infinity)) : req.item ? depth[req.item] ?? Infinity : 0);
      const pd = 1 + Math.max(0, ...[...p.uses, ...p.tools].map(d));
      for (const mk of p.makes) if (pd < (depth[mk.item] ?? Infinity)) { depth[mk.item] = pd; changed = true; }
    }
  }
  return { consumers, depth };
}

// ------------------------------------------------------------ goal trees and thoughts

// Expand a goal into an AND–OR tree. OR: the processes that make an item.
// AND: a process's inputs and tools. Leaves: raw-material slots (with this world's candidates).
export function expandGoal(item, world, maxDepth = 6) {
  const mats = world ? materialsOf(world) : [];
  function expandItem(id, path, depth) {
    const producers = PROCESSES.filter(p => p.makes.some(m => m.item === id));
    const node = { type: 'item', item: id, name: ITEMS[id]?.name ?? id, options: [] };
    if (path.has(id) || depth > maxDepth) { node.truncated = true; return node; }
    const next = new Set(path).add(id);
    for (const p of producers) node.options.push(expandProcess(p, next, depth + 1));
    return node;
  }
  function expandReq(req, path, depth) {
    if (req.any) return { type: 'any', options: req.any.map(r => expandReq(r, path, depth)) };
    if (req.anyTool) return { type: 'any', options: req.anyTool.map(t => expandItem(t, path, depth)) };
    if (req.item) return expandItem(req.item, path, depth);
    const cands = candidatesFor(req, mats);
    return { type: 'material', slot: req, candidates: cands, collectWith: [...new Set(cands.map(c => c.collect).filter(Boolean))] };
  }
  function expandProcess(p, path, depth) {
    return { type: 'process', id: p.id, name: p.name, needs: [...p.uses, ...p.tools].map(req => expandReq(req, path, depth)) };
  }
  return expandItem(item, new Set(), 0);
}

const describeSlot = slot => {
  const words = Object.entries(slot.where ?? {}).map(([k, range]) => PROP_WORDS[k]?.(range)).filter(Boolean);
  const mat = MATERIALS[slot.material].name;
  return words.length ? `${mat} (${words.join(', ')})` : mat;
};
export function lookHint(slot) {
  const keys = Object.entries(slot.where ?? {}).map(([k, [lo, hi]]) => (k === 'density' ? (hi <= 0.5 ? 'density-low' : 'density-high') : k));
  for (const k of keys) if (LOOK_HINTS[`${slot.material}:${k}`]) return LOOK_HINTS[`${slot.material}:${k}`];
  return LOOK_HINTS[slot.material] ?? null;
}
export const ITEM_TRAITS = {
  'hearth-board': 'soft, dry wood, not resinous, cleanly notched',
  'hand-drill': 'a straight, dry spindle and a soft, dry, cleanly notched hearth board', 'bow-drill': 'spindle, hearth board, a springy bow and a hard bearing block', spindle: 'straight, dry, light or pithy, as long as a forearm and more',
  'tinder-bundle': 'bone dry and finely shredded', kindling: 'dry twigs, pencil-thin to thumb-thick', firewood: 'dry; dense wood burns longer',
  flake: 'sharp and hard', hammerstone: 'hard, fist-sized, rings when struck', anvil: 'flat and heavy', cordage: 'strong, even fibre',
  'bark-container': 'watertight', 'cooking-stones': 'dense, dry stones that won’t burst in a fire', bow: 'springy green wood, strung tight',
  'bearing-block': 'hard, with a smooth socket', ember: 'glowing, nursed gently', 'retted-fiber': 'long, clean strands', 'digging-stick': 'dense, hard wood',
  spear: 'straight, dense wood', hide: 'scraped clean', charcoal: 'crushed fine',
};
const reqName = n => (n.type === 'item' ? (ITEM_TRAITS[n.item] ? `${n.name} (${ITEM_TRAITS[n.item]})` : n.name) : n.type === 'material' ? describeSlot(n.slot) : n.options.map(reqName).join(' or '));
const join = xs => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// One "thought" per expanded node: what the character would say when reasoning one step.
export function thought(node) {
  if (node.type === 'item') {
    const opts = node.options;
    if (!opts.length) return `${cap(node.name)}: nothing I can make directly.`;
    if (opts.length === 1) return `To get ${node.name}: ${opts[0].name.toLowerCase()}. For that I need ${join(opts[0].needs.map(reqName))}.`;
    return `To get ${node.name}, I could ${join(opts.map(o => o.name.charAt(0).toLowerCase() + o.name.slice(1))).replace(/ and ([^,]+)$/, ', or $1')}.`;
  }
  if (node.type === 'process') return `To ${node.name.charAt(0).toLowerCase() + node.name.slice(1)}, I need ${join(node.needs.map(reqName))}.`;
  if (node.type === 'material') {
    const hint = lookHint(node.slot);
    return hint ? `For the ${node.slot.role}: look for ${hint}.` : `For the ${node.slot.role}: ${describeSlot(node.slot)}.`;
  }
  return '';
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
