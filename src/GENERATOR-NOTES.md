# Prehistoric world generator (v0.2.0)

Seeded, reproducible generator for environments, minerals, plants, and animals.
The core modules have no Node dependencies, so the same code runs in the browser game.

## Use

    node cli.js generate --seed pig-rock --preset temperate-woodland --out out
    node cli.js patch --seed pig-rock --preset temperate-woodland --entity P3 --n 6
    node cli.js stats --n 300 --preset temperate-woodland

`generate` writes `world.json` (everything), `report.md` (game-master view),
`long.csv` (tidy source table), and wide views `minerals.csv`, `plants.csv`, `animals.csv`.

In code:

    import { generateWorld, samplePatch } from './generator.js';
    const world = generateWorld('pig-rock', { preset: 'temperate-woodland' });
    const patch = samplePatch(world, 'P3', 'node-17', 'streambank'); // lazy, deterministic

## Files

- `rng.js`: seeded, forkable random streams (named substreams keep subsystems independent).
- `environment.js`: climate, bedrock, relief → microhabitats, stone, clay, water.
- `life.js`: plant and animal archetypes, parts, cues, tests, the lookalike, starter check.
- `variation.js`: patch-level latent factor model, lazy patch sampling, Monte Carlo summaries.
- `names.js`: resemblance-name tables keyed to visible traits, drawn without replacement.
- `tables.js`, `report.js`, `cli.js`: outputs.

## Patch variation model

Each archetype has 1–2 visible and 1–2 useful traits that vary by patch:

    z = Σ loading_f · site_factor_f + lineage · g + sqrt(1 − shared) · ε
    trait = logistic or exp of (mu + sd · z)

Site factors (moisture, fertility, exposure) belong to the site, so they are shared by
every species there; 60% of each comes from the microhabitat. `g` is the local
population's lineage value, common to all of one archetype's traits at that site.
Per archetype, `integration` sets the shared share of variance (0.25, 0.55, or 0.85) and
`lineageShare` how much of that comes from lineage, which is what produces correlation.
Factor priors give the usual biological direction (e.g. fertility → bigger fruit) but
flip 20% of the time. Covariance built this way is always valid.

A patch's traits are a pure function of (seed, site, entity), so nothing is stored and
the order of discovery never matters.

## What is grounded vs. invented

Structure and the signs of couplings follow published ideas (leaf economics spectrum,
growth–defense trade-off, apparency and optimal defense theories, Damuth-style density
scaling, bedrock-controlled stone types, shade leaves being larger). Every numeric
constant is a hand-tuned placeholder, not an empirical fit.

## Field notes (`notes.js`)

    import { newMemory, observeSite } from './notes.js';
    const memory = newMemory();                       // lives in the save file
    const { text, mode } = observeSite(world, memory, { site: 'node-7', micro: 'edge', skill: 0.5, time: 'dusk' });

    node cli.js walk --seed pig-rock --preset temperate-woodland [--skill 0.9] [--n 12]

Salience is judged against the character's memory (running statistics of their own noisy
observations), not the true distributions. Notes are usually the top three salient items
plus "more of the same"; when three or more unknown things turn up, the note runs longer
(up to six items, ordered trees → bushes → ground → stone → creatures → signs). Explicit
newness commentary is held back until the character has had two consecutive visits with
nothing new. Naming phrases ("reminds me of a...", "I dub thee...") are always available.

Vertebrates are observed through channels, each revealing only some traits:
sighting (visible traits), tracks (size class, group size), calls (identity only),
scat, damage, dens, and snagged hair (colour). Signs are attributed to a known maker,
left ambiguous between candidates, or held as unresolved signs until the character sees
the animal alongside its sign and links them. Soaring birds are seen at a distance with
a probability that rises with exposure. Calls come from a small grammar and are unique
per world. Animals move, so their absence is never remarked on.

## Process network (`process.js`, draft)

    node cli.js network --seed pig-rock --preset temperate-woodland --out out   # writes network.md
    node cli.js goal --seed pig-rock --preset temperate-woodland --goal fire    # goal tree + thoughts

About 50 processes covering stone tools, wood tools, fire, fibre and cordage, containers and
water, food processing, shelter, trapping, adhesives, and hafting. Each process lists what it
makes, the items and raw materials it uses, tools (catalysts with wear), duration (median and
lognormal spread, hours), background wait time, attention, load per hour on body systems,
kcal per hour, skill, and base success. Raw materials are requested by property
(`{ material: 'dead-wood', where: { density: [0.15, 0.55], resin: [0, 0.5] } }`), never by
species, and `materialsOf(world)` turns a world's parts into matching material records.

- `expandGoal(item, world)`: AND–OR goal tree (OR = processes that make an item; AND = a
  process's needs; leaves = material slots with this world's candidates).
- `thought(node)`: the character's one-step reasoning; leaves give a look-for hint that maps
  onto the search and test actions.
- `reachable(world)`: forward closure from bare hands, a solvability check that ignores skill.
- `networkStats()`: hubs (how many processes need each item) and depth from bare hands.

## Crafting prototype (`craft.js`): quality propagation on the fire chain

    node cli.js craft --seed pig-rock --preset temperate-woodland

- **Property registry** (`PROPERTIES`): each property's scale, how it can be observed
  (glance, inspection, a named test, or only through use), and whether it has dynamics.
- **Roles** (`ROLES`): suitability functions over properties (cutter, pounder, hearth,
  spindle, tinder...). 1 inside the ideal range, smooth fall-off outside; skill widens tolerance.
- **Generic attempt**: z = Σ w·log(suitability) + k·skill_eff + k_effort·log(time/median) + sd·ε,
  with sd = 1 − 0.7·skill. Success if z clears the threshold; workmanship from the margin.
  Effective skill falls with fatigue, hand damage (scaled by the process's hand load), and focus.
  Learning per attempt ∝ p(1 − p).
- **Mutation**: edges dull by Archard's wear law (∝ hours × (worked hardness / tool hardness)²);
  retouching restores sharpness but spends mass; hearth boards burn through (soft ones faster);
  spindles shorten; moisture relaxes toward ambient (about 0.11 in temperate woodland, over 0.2
  in rainforest).
- **Body**: fatigue, hand damage, and slowly growing calluses; overnight recovery.
- **Provenance**: every product records its source; outcomes are tallied by source.

Hand-drill ember calibration (per attempt, rested, good spindle): novice + ideal hearth 10%,
novice + marginal 1.5%, expert + marginal 48%, expert + ideal 84%.
