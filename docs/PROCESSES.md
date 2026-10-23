# Processes: inputs, outputs and side effects

Every action in the game, and every tick of passing time, is a **process**. This document gives the mathematical relationship each one implements: what it reads, what it computes, what it changes, and where chance enters. It was written from the source (build hk-2026-10-27b). Each section names the file and function, so any formula here can be checked against the code. The constants are the code's; most are judgement, not measurement (see the README's *Known limitations*).

Contents

1. [Conventions](#1-conventions)
2. [Passing time](#2-passing-time)
3. [Sleep and rest](#3-sleep-and-rest)
4. [Water, washing and germs](#4-water-washing-and-germs)
5. [The craft attempt model](#5-the-craft-attempt-model)
6. [Stone, wood, bone and fire](#6-stone-wood-bone-and-fire)
7. [Shelter and the site](#7-shelter-and-the-site)
8. [Food: preparation and eating](#8-food-preparation-and-eating)
9. [What lives at a place](#9-what-lives-at-a-place)
10. [Looking close by: survey, poke, focused search, arrival notes](#10-looking-close-by)
11. [Collecting, testing and inspecting](#11-collecting-testing-and-inspecting)
12. [Perceiving at a distance: sight, hearing, smell, calls](#12-perceiving-at-a-distance)
13. [Travel: walking, crossing, injury](#13-travel)
14. [State layers the processes read](#14-state-layers-the-processes-read)
15. [Bookkeeping processes](#15-bookkeeping-processes)

---

## 1. Conventions

### The contract

A process is `{ id, reads, writes, hours, kcal, ready(v), run(v, dice) }` (act.js). `run` sees a **view** `v` of the state. Reading a path not listed in `reads`, or writing one not in `writes`, throws. Writes go into a copy-on-write transaction, so the run can be committed, discarded, undone or redone. `run` returns `{ make, use, say, report }`: items made, items used up, journal lines, and numbers for the record. The common machinery (`perform` in game.js) does the rest, in this order:

1. Ask `ready(v)`; anything but `true` is the refusal text.
2. Pass the process's `hours` of time at its `kcal` rate (§2). Both may be functions of `v`.
3. Run the process, then apply `use` (remove from inventory), `make` (add to inventory) and `say` (append to the journal).
4. Commit, and keep the transaction for the outcome panel.

### Chance

There are two dice:
- **`dice.act`**: this attempt's luck. It's the game's random number generator (RNG), so it advances with every draw.
- **`dice.place(key)`**: the place's luck. It's a fresh RNG seeded by `world seed / key`, so the same key always gives the same draws. "What lives here" never changes between visits.

Each chance draw is also recorded as a **draw** `{ kind, id, p, observed, … }` (`note`, `roll`, `tried`). The outcome panel (spread.js) re-runs the process with other dice and summarises these records.

### Notation

| Symbol | Meaning |
|---|---|
| `clamp(x)` | x limited to [0, 1] (other bounds are written out) |
| `N(μ, σ)` | a normal draw |
| `LN(m, s)` | a lognormal draw: median m, log-sd s |
| `U(a, b)` | a uniform draw |
| `Φ` | the standard normal cumulative distribution function |
| `W(m)` | workmanship: `1 / (1 + e^(−1.5 m))`, from an attempt's margin m (§5) |
| `bump(x; lo, hi, tol)` | 1 for lo ≤ x ≤ hi; `exp(−((lo − x)/tol)²)` below; `exp(−((x − hi)/tol)²)` above |
| `widen(tol, sk)` | `tol × (1 + 0.6 sk)`: skill widens every role's tolerance |

### Body state (`S.body`), all 0–1 unless stated

| Field | Meaning |
|---|---|
| `hyd` | water |
| `energy` | reserves; 1 ≈ 24 000 kcal, about ten days |
| `gut` | kg in the stomach (0–1.5) |
| `macro {p, f, c}` | kcal of protein, fat, carbohydrate over about the last day |
| `sick` | how ill I am |
| `pendingSick` | illnesses brewing: `{ at, severity, text }` |
| `chill` | core cold carried over |
| `clothes {clo, wet}` | clo: insulation in clo units (1 clo = 0.155 m²·K/W) |
| `limp` | ankle |
| `wound` | a cut |
| `germs` | dirt on my hands |
| `skills {knapping, woodwork, firecraft}` | — |
| `fatigue`, `hands`, `callus`, `focus` | wear |

---

## 2. Passing time

### `pass(hours, kcal)` (game.js)

Splits the time into `n = ⌈hours / 0.5⌉` ticks of `dt = hours / n`, and runs every process in `TICKS` (acts.js) each tick. The sky at the tick's start is `was`. After the ticks:

```
hyd, energy ← clamp
cap   = 1 − 0.6·max(0, 0.4 − hyd)/0.4 − 0.4·max(0, 0.3 − energy)/0.3 − 0.5·sick − 0.3·chill
focus ← min(focus, clamp(cap, 0.1, 1))
collapse if hyd ≤ 0.02 or energy ≤ 0.02 or sick ≥ 0.95
```

**Collapse** sets `hyd ≥ 0.35`, `energy ≥ 0.12` and `sick ≤ 0.6`, then sleeps to morning (§3).

### The ticks (acts.js `TICKS`), in order

| Tick | Reads | Changes | Relationship |
|---|---|---|---|
| `sky` | tick, was, sky, fire, hut | — | Journal lines when the weather or the dark changes (no state). |
| `moon` | sky, day | `mind.moonNoted` | Once a night while dark (sun < −6°): a line on the moon. |
| `metabolism` | dt, kcal, `sky.tempC`, sick | hyd, energy, gut, macro | `hyd −= dt·(0.032 + 0.02·max(0, kcal − 150)/250 + 0.02·sick + [T > 28 °C] 0.015)`; `energy −= dt·kcal/24000`; `gut −= 0.12·dt` (≥ 0); `macro[*] ×= e^(−dt/24)` |
| `healing` | dt | limp | `limp −= dt·0.1/24` (≥ 0): about 0.1 a day awake |
| `warming` | dt, fire, clothes.wet | chill | `chill −= dt·(0.15 + 0.3·[fire])·(wet > 0.5 ? 0.4 : 1)` |
| `clothes` | sky, shelter, wind, fire | clothes.wet | Raining: `wet += dt·0.3·pour·(1 − rainBlock)`, with pour 2 in a storm, 1.5 in a blizzard, else 1. Dry: `wet −= dt·(0.06 + 0.1·wind + 0.4·[fire] + 0.1·[clear, sun > 20°])` |
| `germs` | dt, tempC | inv | Everything carried mixes at rate `0.01·dt` (see `mix`, §4). Moist food (water > 0.5): `germs += dt·0.008·2^((T − 20)/10)·(1 − germs)` |
| `drying` | dt, wet, fire, ambient | inv (non-food moisture) | `m ← a + (m − a)·exp(−0.4·days)`, with `days = dt/24 × (fire ? 3 : 1) × (raining ? 4 : 1)` and `a = here.ambient` (§14) |
| `fire` | sky, fire, hut | site.fireUntil | In the open while wet: `fireUntil −= dt × {storm 3, blizzard 3, rain 1, snow 0.5}` |
| `illness` | now | sick, pendingSick, lore | Each brewing illness whose time `at` has come: `sick += severity`; credits the food lore if it came from eating |

Drying relaxes toward the air's dampness `a`; it never goes below it. A fire triples the rate, and rain quadruples it because the air is wetter. Only sleeping in a hut sets the target below the air, at `a − 0.03` (§3).

---

## 3. Sleep and rest

### `sleepNow` (game.js) and `SLEEP_HOUR` (acts.js, body.js `sleepHour`)

**Duration.** From now until a quarter-hour after civil dawn (sun at −6°), clamped to waking between 04:00 and 08:30.

**Banked fire.** If a fire is burning here and two pieces of wood are carried, they are used. The fire then adds `fireC = (hut ? 7 : 5)·max(0.2, 1 − h/H)` °C, fading over the night (H = hours asleep). It's still glowing at dawn: `fireUntil = now + 1.5`.

**Biters.** If mosquitoes or gnats live by water here or in this microhabitat, there's no banked fire, and it's 10 °C or warmer, they cost sleep.

**Each hour.** `SLEEP_HOUR` takes:
- the night: air temperature T, wind (m/s), precipitation, ground wetness `clamp(soak/(2·meanSoak))`, snow depth;
- shelter: the hut's, or the trees' and rocks';
- the bed, clothes, the fire's warmth and the body.

The heat balance, in clo:

```
wind      = windMs·(1 − windBlock)
air       = 0.7 / (1 + 0.25·wind)                                   still air round me
worn      = clothes.clo·(1 − 0.6·clothes.wet)
ground    = bed.clo·(1 − 0.5·bed.wet) + floor − 0.4 − 0.3·groundWet − 0.4·[snow > 2 cm]
have      = max(0.2, worn + air + shelter.clo + ground)
need      = max(0.1, (33 − (T + fireC)) / 8)
deficit   = clamp((need − have)/need)
```

Shelter values:
- **Hut:** windBlock 0.9, rainBlock 0.95, clo 1.5, floor 0.4.
- **Natural:** crown = veg·(0.4 + 0.6·leaf); windBlock = min(0.8, 0.6·crown + 0.3·[outcrop or scree]); rainBlock = 0.5·crown.

**Lost sleep.** Losses are named, and they add:

```
cold   = 1.2·max(0, deficit − 0.15)       hot    = 0.3·max(0, (T − 30)/8)
rain   = 0.3·exposed·pour                 wind   = 0.1·[wind > 8 m/s]
biters = 0.2                              hunger = 0.25·[energy < 0.2]
thirst = 0.2·[hyd < 0.3]                  pain   = 0.3·limp
quality = clamp(1 − Σ loss, 0.05, 1)
```

**Effects per hour.** `dt` is the share of the hour slept:

```
fatigue    −= 0.12·(0.35 + 0.65·quality)·dt
chill      += dt·(deficit > 0.35 ? 0.08·(deficit − 0.35) : −0.15)
energy     −= dt·(0.0045 + 150·max(0, deficit − 0.25)/24000)       ~100 kcal/h, plus shivering
hyd        −= 0.015·dt
sick       −= 0.03·quality·dt
limp       −= 0.008·quality·dt
clothes.wet += dt·(wetting − drying),  wetting = 0.25·exposed·pour,  drying = exposed ? 0 : 0.05 + 0.15·[fire]
bed.wet    += 0.6·wetting·dt
```

**After the night.** With mean quality q:

```
hands ×= 0.55^(0.4 + 0.6 q)      callus ×= 0.995      focus = clamp(0.4 + 0.7 q, 0.3, 1)
carried items' moisture: dry(item, H/24, hut ? ambient − 0.03 : ambient)
```

If `chill ≥ 0.6` and I'm not already ill, a chill illness may set in:
- chance `chill − 0.4`;
- it comes on 12 h later;
- severity `0.15 + 0.2·(chill − 0.6)`.

Brewing illnesses whose time has come then land.

### `REST` (acts.js)

For `h` hours (the time passes at 90 kcal/h):

```
fatigue ×= 0.15^(h/9)      hands ×= 0.55^(h/12)      focus = clamp(focus + 0.12 h)
```

---

## 4. Water, washing and germs

### `DRINK` (acts.js)

0.25 h at 120 kcal/h; ready only where there is water. The source's `pathogen` level depends on where I am:

| Where | pathogen |
|---|---|
| spring | about 0.06 |
| stream | about 0.25 |
| lake | about 0.5 |

```
hyd = 1
with chance 0.6·pathogen: illness in 24 + U(0, 18) h, severity 0.25 + 0.5·pathogen
```

### `WASH_HANDS`

0.1 h. `germs = 0.3·germs + 0.3·pathogen`. A cut less than 4 h old is cleaned: with chance 0.8 its brewing infection is removed, and the wound is cleared.

### Craft `wash` (wash a thing)

```
thing.germs = 0.3·thing.germs + 0.4·pathogen      hands = 0.5·hands + 0.3·pathogen
```

### `mix(items, body, k)` and `HANDLE`

Everything handled together moves toward the common mean germ load `m` (the items', plus the hands' when included):

```
item.germs += k·(m − item.germs)        hands += k·(m − hands)
```

`HANDLE` applies this at k = 0.4 to the items a job touched. With heat, every handled item is then multiplied by `kill`, the share of germs left.

**Starting germ load by kind:**

| Kind | germs |
|---|---|
| honey | 0.02 |
| fruit, nut | 0.05 |
| leaf | 0.12 |
| root, storage | 0.30 |
| invertebrates | 0.30 |
| shellfish | 0.45 |
| bone | 0.40 |
| wood | 0.04 |
| others | about 0.05 |

---

## 5. The craft attempt model

All skilled work goes through `attempt` (craft.js). For a process with spec `{ skill, kSkill, θ, kEffort, median, learn, handLoad, kcal }`, role terms `[(w_i, s_i)]` and time spent `h`:

```
se     = skill·(1 − 0.6·fatigue)·(1 − 0.7·hands·clamp(handLoad/3))·(0.5 + 0.5·focus)   effective skill
mean   = Σ w_i·ln(max(s_i, 0.001)) + kSkill·se + kEffort·ln(h/median)
sd     = 1 − 0.7·skill
z      = mean + sd·N(0, 1)
success = z > θ;   margin = z − θ;   p = 1 − Φ((θ − mean)/sd)
```

**Side effects of every attempt:**

```
skill   += learn·p(1 − p)·(1 − skill)                       learning peaks when success is uncertain
fatigue += h·kcal/2000
hands   += h·handLoad·0.09·(1 − 0.75·callus)
callus  += h·handLoad·0.006
focus   −= 0.06·h
```

**Roles.** These are suitabilities, 0–1, of an item for a job, at skill `sk`:

| Role | Formula |
|---|---|
| cutter | `bump(sharpness; 0.6, 1, widen(0.2)) × bump(hardness; 5.5, 10, widen(1.5))` |
| pounder | `bump(hardness; 5.5, 10, 1.5) × bump(mass g; 300, 1500, 250)` |
| anvil | `bump(mass; 2000, 10⁵, 800)` |
| knapStone | `bump(fracture; 0.75, 1, widen(0.25)) × bump(flaws; 0, 0.12, widen(0.25))` |
| hearth | `bump(density; 0.22, 0.40, widen(0.25)) × bump(moisture; 0, 0.13, widen(0.08)) × bump(resin; 0, 0.3, widen(0.25))` |
| spindle | `bump(straightness; 0.85, 1, widen(0.15)) × bump(moisture; 0, 0.13, widen(0.08)) × bump(length cm; 45, 90, widen(12))` |
| tinder | `bump(moisture; 0, 0.1, widen(0.07)) × bump(fineness; 0.6, 1, widen(0.25))` |

**Edge wear** (Archard's law):

```
sharpness −= 1.2·h·(worked hardness / tool hardness)²       wood hardness = 1 + 3·density
```

---

## 6. Stone, wood, bone and fire

Each row: the attempt spec, then what it makes. All of these are refused in the dark.

### `KNAP` (bipolar flaking)

0.25 h, 200 kcal/h.

Spec: knapping, kSkill 3, θ −0.5, kEffort 0.5, median 0.25 h, learn 0.08, handLoad 1.5.

Terms:
- 1·knapStone(core);
- 0.5·pounder(hammer);
- 0.3·anvil, where anvil mass is 6000 g on a slab, else 1500 g, so the anvil factor is 1 or 0.68.

```
flakes n = success ? min(4, 1 + ⌊2·margin⌋) : (margin > −1.2 ? 1 : 0)
each flake: sharpness = clamp(0.55 + 0.3·fracture + 0.08·margin + N(0, 0.05)),
            hardness = the stone's, mass = U(5, 20) g
core used up with chance 0.25
```

### Search for a naturally sharp stone (`searchNaturalEdge`, in focused search)

0.5 h, handLoad 0.2. The source stone gives a natural-edge rate and sharpness:
- `rate = site·frost·(0.15 + 0.85·fracture)`, where site is scree 1, outcrop 0.6, glade 0.2, streambed 0.1, and frost is 1.5 when the mean temperature is under 8 °C;
- `sharpness₀ = 0.25 + 0.5·fracture`.

```
found with chance clamp(0.25 + 0.6·rate)·(0.7 + 0.3·focus)
edge: sharpness = clamp(sharpness₀ + N(0, 0.12)), fracture 0.2, mass U(10, 40) g
```

### `notch` (a hearth board from dead wood)

0.4 h quick or 1.0 h careful, 160 kcal/h.

Spec: woodwork, kSkill 2.5, θ −0.4, kEffort 0.6, median 0.4 h. One term: cutter(edge).

```
notch = 0.15 + 0.85·W(margin + 0.5)        board: density, resin, moisture from the wood; life 1, socket 0
edge dulls by 1.2·h·((1 + 3·density)/edge hardness)²
```

With any edge of sharpness 0.6 or more, cutter = 1, so the notch depends on skill and time only. For a fresh novice (woodwork 0.1) the expected notch is about 0.87 quick and 0.94 careful.

### `refine` (touch up a notch)

0.6 h, same spec.

```
margin < −1.5: notch = max(0.15, notch − 0.05)
else          notch += (1 − notch)·0.5·W(margin)
```

### `carve` (a spindle from a shoot)

0.5 h, same spec with median 0.5 h.

```
spindle: straightness = clamp(shoot.straightness·(0.93 + 0.07·W(margin))), length 70 cm, density and moisture from the shoot
```

### `trim` (a spindle from a dead stalk)

0.15 h, no attempt. The spindle keeps the stalk's properties, with length 70 cm.

### Spindle and board sources (from Collect, §11)

| Source | straightness | moisture when gathered |
|---|---|---|
| dead stalk | 0.95 | air |
| green shoot (straight shrubs) | 0.90 | 0.55 |
| dead shoot | 0.72 | air + 0.02 |
| dead wood (board stock) | — | air + 0.06 |

Density is the patch's, by `samplePatch` (§14).

### `digstick` (a digging stick)

0.5 h with an edge, 1 h ground on stone.

```
finish   = clamp((cut ? 0.6 + 0.4·sharpness : 0.5)·(0.8 + 0.4·focus) + N(0, 0.08))
hardness = clamp(density·(0.75 + 0.25·finish) − 0.08·[moisture > 0.3], 0.1, 0.95)
cutting edge loses 0.04 sharpness
```

### `harden` (fire-harden the digging stick)

0.3 h quick or 0.75 h careful; needs a fire.

```
charred (quick only) with chance 0.35
hardness += (1 − hardness)·(careful ? 0.30 : 0.18)·(hardened before ? 0.4 : 1) − 0.08·[charred]
moisture = min(moisture, air + 0.02)
```

### `tinder` (a tinder bundle)

0.2 h. Spec: firecraft, kSkill 2, θ −0.8, kEffort 0.5, median 0.2 h, learn 0.04, handLoad 0.5, no role terms.

```
fineness = clamp(0.45 + 0.4·W(margin)); moisture from the material
```

### `bone` (smash a bone for splinters)

0.2 h. Spec: knapping, kSkill 1.5, θ −0.8, kEffort 0.3, median 0.2 h. Term: 0.5·pounder(hammer).

```
splinters = success ? 1 + [margin > 0.5] : 0;  each sharpness clamp(0.6 + N(0, 0.12)), hardness 3
```

### `DRILL_ATTEMPT` (hand drill, one go)

0.25 h at 400 kcal/h.

Refused when:
- hands > 0.85;
- fatigue > 0.88;
- it's dark.

Spec: firecraft, kSkill 1.89, θ 1.2, kEffort 0.5, median 0.25 h, learn 0.08, handLoad 3.

Terms:
- 1·hearth(board);
- 1·spindle;
- 0.6·notch;
- 0.4·(0.4 + 0.6·socket).

Calibrated, fresh and rested with a good spindle:

| | ideal hearth | marginal hearth |
|---|---|---|
| novice | about 10% | about 1% |
| expert | about 85% | about 40% |

```
socket += (1 − socket)·0.3
life   −= 0.05 + 0.1·(0.45 − density)          soft boards burn through faster
length −= 1.5 cm
ember on success: vigor = W(margin)
board used up at life ≤ 0.05; spindle at length < 40 cm
```

**For a fresh novice:**

```
p = 1 − Φ((1.105 − Δ)/0.965)      Δ = ln hearth + ln spindle + 0.6 ln notch + 0.4 ln(0.4 + 0.6 socket)
```

With hand wear, a fresh day allows about 14 attempts and later days about 6. So moisture dominates. It enters through both the board and the spindle, quadratically in the exponent: `ln bump = −((m − 0.13)/0.083)²`.

| Air dampness m | Δ from moisture alone |
|---|---|
| 0.15 | about −0.1 |
| 0.17 | about −0.5 |
| 0.20 | about −1.4 |
| 0.25 | about −4.2 |

That's the cliff seen in the start-screen fire estimate.

### `EMBER` (light a fire from an ember)

0.15 h if tinder and wood are both carried. Without tinder, or without wood, the ember fades and nothing is used.

Spec: firecraft, kSkill 1.5, θ −0.6, kEffort 0.3, median 0.15 h. Terms: 1·tinder(bundle), 0.8·vigor.

```
tinder used either way; on success wood used, fireUntil = now + 3 h, milestones ember and fire
```

### `FEED_FIRE`

```
fireUntil = max(fireUntil, now) + 3 h; one piece of wood used
```

---

## 7. Shelter and the site

| Process | Time | Relationship |
|---|---|---|
| `MAKE_BED` | 0.15 h | Using the bound stuff: `add = Σ loft` (default 0.3 each), `wet = mean moisture` (default 0.2). `bed.clo = min(1.5, clo + add)`; `bed.wet` = the clo-weighted mean of old and new. |
| `BUILD_HUT` | 3.5 h, 320 kcal/h | `site.hut = true`. Shelter becomes the hut's (§3). Rain no longer eats the fire; items dry to air − 0.03 overnight. |
| `basin` | 1.5 h at a clay bank, else 0.5 h | Clay bank: always a clay-lined pit. Elsewhere: a rock hollow with chance 0.6. |
| `scorch` | 0.1 h, needs fire | No state change (journal only). |

---

## 8. Food: preparation and eating

### The make-up of a food (food.js)

A food state holds:
- mass fractions: water, starch, sugar, fat, protein, fibre;
- `access`: the share of starch, fat and protein absorbable;
- `surface`: 0–1, how broken up it is;
- `compounds`: doses.

Each species' parts are sampled once at world generation from the part class's ranges.

### `expose(state, exposure, quality q, cond)`

Every preparation goes through this. Let `q' = 0.6 + 0.4·q`.

**Breaking up** (cut, crush, grind), with `amount` and `rupture`:

| Exposure | amount | rupture |
|---|---|---|
| cut | `0.25 + 0.25·sharpness` | 0.2 |
| crush | `0.5·crushPower` | 1 |
| grind | `0.9·(0.4 + 0.6·rough)` | 1 |

```
gain = min(1, surface + amount·q') − surface;  surface += gain
access.fat     += (1 − access.fat)·0.6·gain·rupture
access.protein += (1 − access.protein)·0.3·gain·rupture
access.starch  += (1 − access.starch)·0.15·gain·rupture
compound ×= 1 − crushFactor·gain·rupture             (stinging hairs: crushFactor 0.8)
```

**Water** (soak in still water, leach in running water), for H hours at T °C:

```
rate = (running ? 0.25 : 0.1)·2^((T − 10)/10)·(0.25 + 0.75·surface)     per hour
f    = 1 − e^(−rate·H)
compound ×= 1 − waterFactor·f;  sugar ×= 1 − 0.5 f;  water += (0.9 − water)·0.3 f
```

**Heat** (roast or boil) for M minutes × heatPower:

```
t = 1 − e^(−M/15)
compound ×= (1 − kill)·(1 − leach)
    kill  = heatFactor·(wet-acting compound and roasting ? 0.25 : 1)·(fast-acting ? 1 − e^(−M/3) : t)
    leach = boiling ? 0.3·waterFactor·t : 0
access.starch += (1 − access.starch)·(boil ? 0.85 : 0.7)·t·q'
access.protein += (1 − access.protein)·0.3·t
roasting: water ×= 1 − 0.15·t
```

**Drying** for D hours:

```
water ×= 1 − 0.8·(1 − e^(−D/12))
```

**Volatiles.** Crushed and then soaked, heated or dried (surface > 0.3): `compound ×= 1 − volatileFactor·surface·0.8`. Doses under 0.005 are dropped.

**Compound factors** (water, heat, crush, volatile, potency):

| Compound | water | heat | crush | volatile | potency | effect |
|---|---|---|---|---|---|---|
| tannin | 0.9 | 0.15 | — | 0 | 0.35 | binder |
| cyanogen | 0.5 | 0.4 | — | 0.9 | 1.0 | systemic |
| lectin | 0.1 | 0.97 (needs wet heat) | — | 0 | 0.5 | gut |
| oxalate | 0.3 | 0.7 (needs wet heat) | — | 0 | 0.6 | irritant |
| alkaloid | 0.35 | 0.05 | — | 0 | 1.3 | systemic |
| latex | 0.4 | 0.4 | — | 0 | 0.8 | gut |
| saponin | 0.8 | 0.2 | — | 0 | 0.5 | gut |
| stinging | 0.5 | 1.0 | 0.8 | 0 | 0.5 | irritant |
| resin | 0.05 | 0.3 | — | 0.3 | 0.35 | gut |
| aromatic | 0.3 | 0.5 | — | 0.6 | 0.12 | gut |
| sulfur | 0.3 | 0.6 | — | 0.6 | 0.05 | gut |
| lichen acid | 0.85 | 0.2 | — | 0 | 0.4 | gut |
| fungal | 0.2 | 0.3 | — | 0 | 1.0 | gut |
| amatoxin | 0 | 0 | — | 0 | 3.0 | delayed |
| biotoxin | 0 | 0.05 | — | 0 | 1.5 | systemic |
| parasites | 0 | 1.0 (fast) | — | 0 | 0.6 | parasite |

**Harm**:

```
harm = Σ dose·potency          over compounds other than parasites
bands: < 0.12 safe, < 0.3 mild upset, < 0.55 moderate, < 0.8 severe, else potentially lethal
```

### `PREPARE(id)` (pound, grind, chop, roast, leach, soak, dryfood, stoneboil)

Work quality `q = clamp(0.5 + 0.4·focus + N(0, 0.1))`. Then:

| id | Time | Exposure and conditions |
|---|---|---|
| pound | 0.25 h | crush 0.5; `crushPower = clamp(hardness/7, 0.3, 1)·clamp(√(mass/800), 0.6, 1.2)` |
| grind | 0.75 h | grind 0.9; `rough` = the grittiest stone's (0.35 smooth, 0.85 abrasive) |
| chop | 0.2 h | cut `0.25 + 0.25·sharpness`; the edge loses 0.01 |
| roast | 0.25 / 0.5 h | heat roast 10 / 25 min; quick has a 0.3 chance to char (mass ×0.85) |
| leach / soak | the chosen hours | water running / still at the stream's or pool's temperature |
| dryfood | 4 h in the sun / 2 h by a fire | dry 8 / 12 h equivalent |
| stoneboil | 0.75 h | boil 20 min; `heatPower = min(1.2, 0.3·stones + 0.1)`; each stone bursts with chance `0.4·spall` |

After any preparation:

```
mass ← mass·(1 − water_before)/max(0.05, 1 − water_after)       water in or out changes the weight
notes cleared (what I tasted no longer holds)
```

### `nutrients(state, kg)`

```
binder  = min(0.7, 0.6·tannin)
carb    = 1000 kg·(4·starch·access.starch·(1 − 0.2 binder) + 4·sugar)
fat     = 1000 kg·9·fat·access.fat
protein = 1000 kg·4·protein·access.protein·(1 − binder)
cost    = 0.25·protein + 0.07·carb + 0.02·fat + 0.6·1000 kg·fibre
net     = carb + fat + protein − cost
```

### `EAT`

0.5 h with a fire here, 0.2 h without. Ready while `gut < 1.45`.

1. With a fire here, the food is roasted first: `expose(roast 15 min, q = 0.5 + 0.5·focus)`.
2. **Amount:** `m = min(mass, 1.5 − gut)`; `gut += m`.
3. **Rabbit starvation:**
   ```
   tot = macro total + this meal;  excess = max(0, macro.p + protein − 0.35·tot)
   wasted = tot > 500 ? min(protein, excess) : 0;  net' = net − wasted
   ```
   If `wasted > 50`: `sick += min(0.15, wasted/1500)`.
4. **Outcome band:** `band(harm·√min(1.5, m/0.2))`. A mouthful is less than a meal.
5. **Energy:** `energy += net'/24000`. If severe or lethal and not delayed, it's `min(0, net')/24000` instead: vomited.
6. **Germs:** `g = germs·(cooked ? 0.05 : 1)`.
   - Illness with chance `min(0.7, (g + 0.25·hands)·min(1, m/0.2))`.
   - It comes on in 20 h, severity `min(0.5, 0.15 + 0.4 g)`.
7. **Parasites** (dose > 0.02):
   - Illness with chance `min(0.8, 1.5·dose)`.
   - It comes on in 30 h, severity `min(0.5, 0.2 + dose)`.
8. **Amatoxin** at a poisonous band: no sign now. It comes on in 30 h at severity 0.95 (lethal band) or 0.6, and the lore is credited then.
9. **Otherwise**, by band: mild `sick += 0.15`, moderate 0.4, severe 0.75, lethal 1.0. The lore (food → ok / sick counts) is updated now.
10. Hands and food mix at k = 0.3.

---

## 9. What lives at a place

### `populationAt` (population.js)

For every stone, plant and invertebrate whose habitats include this microhabitat. `perInstance` is its usual abundance there; `fertility` is the site factor (§14).

```
own  = place(abund/<id>/<site>).normal()
z    = Σ_g ρ_g·z_g + √(1 − Σ_g ρ_g²)·own          z_g = place(guild/<g>/<site>).normal()
count = perInstance·exp(0.35·fertility·[not stone] + 0.5·z)
present with chance 1 − e^(−count/2)              (same RNG as own)
```

**Guilds and ρ:**

| Guild | Members |
|---|---|
| bloom | flowering plants and fleshy-fruited plants 0.45; bees and wasps 0.6; flies and caterpillars 0.45 |
| fruit | berry, drupe and nut plants 0.45; songbirds, ground birds, rooters, rodents 0.45 |
| prey | browsers, hares, rodents, ground birds 0.45; predators and soaring birds 0.6 |
| rot | mushrooms, grubs, beetles, woodlice, termites 0.45 |
| still | mosquitoes and gnats 0.6; frogs 0.45 |

If Σρ² > 0.8, all of a species' ρ are scaled down to make it 0.8.

So z is standard normal for every species: its own rate of turning up is unchanged. Two members correlate with `Σ_g ρ_a ρ_b`. Measured over 3000 sites (tests/sim/guilds.mjs): about 0.3 for bees against flowering plants and for predators against prey.

### `densityAt` (vertebrates near a site)

```
dens = perKm2·exp(0.5·z − 0.125)        z as above, own = place(dens/<id>/<site>)
```

Its mean over sites is perKm2. It's used for sightings, sign, bones and startling.

### `findBones`

For each vertebrate in this microhabitat:

```
μ = effort·vis·dens·mass/600          vis: glade, outcrop, scree 1.3; streambed 1.2; … woodland, deadfall 0.6
finds ~ Poisson(μ);  fine-boned (birds, fish, frogs, lizards, < 3 kg) vs big
site.bones.fine ≤ 4, site.bones.big ≤ 3
```

Effort: survey 0.35; a focused search for bones 1 (0.5 in passing).

---

## 10. Looking close by

### `SURVEY` (acts.js)

0.75 h, 160 kcal/h. Ground cover hides low things:

```
cover = (1 − min(1, snowCm/20))·(1 − 0.5·litter)
```

**Things counted.** For each present, non-cryptic thing:
- An animal must be about this season (`animalNow.here`, §14).
- Base visibility: plants 0.97, herbs 0.85, grass 0.9, mushrooms 0.6, mosses 0.9, lichens 0.8; animals `0.6·now.seen`.
- `p = base × light × (low ? cover : 1) × (plant ? min(1.2, plantNow.notice) : 1)`.
- A thing noticed goes into the site's known things and the field notes.

**Animal sign.** For each vertebrate here that's about:

```
p = (1 − e^(−0.3·dens))·light·(snow > 2 cm ? 1.5 : 1 − 0.6·litter)
```

**Bones:** `findBones` with effort 0.35.

**Smells** (`smellsHere`). Each only from something present and active now:

| Smell | Condition |
|---|---|
| resin | always |
| onion, mint | in leaf |
| ripe fruit | `fruitShows` (§14) |
| mushrooms | showing |
| bees | active |
| flies | active, and chance 0.4 |
| predator scent mark | active, and chance 0.3 |
| marsh | at a marshy pond |

### Arrival notes (`observeSite`, notes.js, on every arrival)

The same population draw as the survey, on the place's own dice, with:

```
skillF = 0.6 + 0.8·skill
lowCover = (1 − min(1, snow/20))·(1 − 0.5·litter)
```

**Sessile things and invertebrates:**

```
p = NOTICE[form]·skillF·light·now.seen·plantNow.notice·(low ? lowCover : 1)
NOTICE: tree 0.95, shrub 0.85, herb 0.55, grass 0.5, mushroom 0.4, moss 0.55, lichen 0.45, stone 0.7, invertebrate 0.35
```

**Vertebrates.** Only if about this season; with `dens = densityAt`:
- **Here now:** chance `1 − e^(−0.08·dens)`.
- **Seen:** chance `NOTICE[cls]·skillF·(active ? 1.3 : 0.5)·(1 − 0.5·wariness)·light·now.seen`. NOTICE is 0.45 for small animals, 0.5 for large.
- **Bolting unseen:** if wary (wariness > 0.5) and fast (speed > 0.6), chance 0.3.
- **Call:** if active, chance `0.6·now.calls·hearing`.
- **Passed through recently:** chance `1 − e^(−0.3·dens)`. If so:
  - tracks with chance `(snow > 2 ? (fresh 1.2 : 0.8) : TRACK_GROUND[micro]·(1 − 0.6·litter))·(0.4 + 0.6·skill)·light·(wet ? 0.3 : 1)`;
  - scat `0.3·(0.4 + 0.6·skill)·light`;
  - damage `0.25·(…)·light`;
  - den `0.12·light`;
  - hair `0.06·light`.

**Descriptions** use only the features that show now (`cuesNow`, §14). Visible patch traits are sized up only when their part shows: fruit size and colour need fruit; leaf size and hairiness need leaves.

### `poke` (poke around)

0.5 h, 230 kcal/h. Hands gain dirt: `germs += 0.25·(0.45 − germs)`. With a digging stick, `reach = 1 + 1.5·hardness`, else 1.

```
each present invertebrate or cryptic thing found with chance 1 − exp(−reach·n / (animal ? 25 : 10))
a hive (bees here, in woodland, deadfall or edge) with chance 0.25
digging stick: hardness −= 0.03·(1 − hardness), at least 0.15
```

### `look` (focused search) and `lookAlong`

Starting a search costs focus −0.03. It searches here, then every 6 cells of each walk while the search lasts. Walking while looking takes 1.25× as long and costs focus −0.05.

| Focus | Rule |
|---|---|
| a named thing | if present: cryptic `1 − exp(−reach·n/(animal ? 15 : 6))`, else 0.92; bees → a hive with chance 0.5 |
| distant water or high ground | `perceive` with boost 1.6 (1.2 in passing), associated as in §12 |
| game sign | per animal `1 − e^(−dens·(passing ? 0.25 : 0.45))`, then each sign kind with chance 0.6 |
| sharp stone | `searchNaturalEdge` (§6) on a natural-edge source here |
| bones | `findBones` |
| food, tinder, fibre, spindle, hearth wood, stone | each present thing whose relevant part shows now is listed; out of season it isn't |

When nothing fits, the nearest cell of a suitable microhabitat within 12 cells becomes a "patch" suspect.

### `breakthroughs` (on arrival while focused on something else)

**Ripe fruit.** For each fleshy-fruited plant present with fruit showing, not yet remarked on: noticed in passing with chance 0.6.

**A big animal startled.** For each large animal here: chance `1 − e^(−0.06·dens)`.

---

## 11. Collecting, testing and inspecting

### `gather` (Collect)

The option's own time and kcal. An option is blocked when:
- its part is out of season (`partNow < 0.15`);
- it's buried under more than 15 cm of snow;
- it needs a cutting edge or digging stick that isn't carried (soft ground excepted).

The item made has the source's properties, as in §6's table, plus:

| Item | Properties |
|---|---|
| stone | fracture, flaws, hardness from the stone; `mass = U(450, 1100)` g; `rough` 0.85 if abrasive else 0.35; spall |
| slab | mass 6000 g |
| tinder materials | `moisture = air·0.6` (fungus 0.9, papery bark 0.7, inner bark air + 0.1) |
| moss | air + 0.2 |
| food | its make-up, `mass = gather·clamp(partNow, 0.3, 1)`: less early and late in the season |

Gathering mixes the item with my hands at k = 0.5.

### `test`

0.1 h. A test reports a property in words, with a reading noise of `N(0, 0.04)` on the true value: density, moisture, hardness, sharpness, notch, tinder dryness. Field tests on stones and plants report fixed descriptions from world generation.

### `inspect`

0.25 h, plus 0.15 h when focus ≥ 0.25. It describes the thing by the features showing now, and lists the parts that are in season now (`partNow ≥ 0.3`). It assesses uses from those features, and adds what I've learned (test notes, eating lore).

---

## 12. Perceiving at a distance

### Sight (`perceive`, geo.js)

For each visible landmark f at distance d, up to 4 km (7 km from a lookout):

```
eye = lookout ? max(3, 18·veg + 2) : 1.7 m
angular = size/d  (ignored below 0.004)
s = sightline(eye, f) × clamp(angular/0.012) × e^(−d/(lookout ? 12000 : 7000)) × far(lux) × e^(−3d/visibility)
seen if s > 0.12/boost
```

Lakes and river traces need height, except within 600 m in open country. `far(lux) = clamp((log₁₀ lux + 3.3)/3)`.

### Hearing (`hear`)

Each water source has a range R (m):

| Source | R |
|---|---|
| falls | 2000 |
| cascade | 700 |
| rapids | 900 |
| river | 400 |
| stream | 200 |
| brook | 70 |
| waterbirds | 700 |

```
R' = R·quiet·boost·hearing·(1 − 0.35·veg_here)·dyn
      quiet = 1.3 at night;  waterbirds ×0.45 by day, none at night
      dyn (water) = 0 dry, 0.3 iced, √min(4, flow);  dyn (birds) = 0 on an iced lake, 0.3 out of the growing season
I = (R'/d)²   into 10° bearing bins, per class (water noise, bird calls)
blur each source's bins by a Gaussian of 1.5 bins (15°); sum
percept at each peak with I ≥ 1 (≥ 4 if water lies within 120 m, except that water itself)
level = 10 log₁₀ I dB;  strength = clamp(1 − 1/√I)
```

### Turning a cue into a guess (`suspicionFrom`)

```
bearing = true + N(0, sight 6° | sound 25°)
dist    = true·exp(N(0, sight 0.2 | sound 0.45))
within 1.5 cells: exact
```

### Combining guesses (`associate`)

A cue is the same thing as a suspect if:
- it has the same true key; or
- it's the same kind and the guess lies within `max(700 m, 0.35·dist)` of the suspect.

Otherwise it's a new suspect. Combining is inverse-variance weighting, like a Kalman update:

```
e = max(0.5, {sight 0.2, sound 0.45, smell 0.6}·dist/CELL) cells
w = old²/(old² + e²);  est ← (1 − w)·est + w·new;  err ← √(old²·e²/(old² + e²))
```

A suspect I'd lost track of takes the new fix outright.

### `scan` and `lookout`

| | scan | lookout |
|---|---|---|
| Time | 0.5 h, 120 kcal/h | 0.5 h, 200 kcal/h |
| Effects | focus −0.04; boost 1.6; every cue registers; smells too | eye as above, sight to 7 km; marks the land in view (50 cells) |
| From the ground | only water plus the three strongest other cues register | — |

**Calls**, on a scan only. Each calling vertebrate that's about:

```
p = clamp(perKm2/15·now.calls·hearing)·(day ? 0.5 : 1)
```

At most three of those heard are reported, at a bearing drawn uniformly at random (animals have no positions yet).

### Smell (`smellAt`, smell.js; `associateSmell`)

**Sources:**
- marshy lakes: half of all lakes, range 1200 m;
- a sulfur spring on volcanic ground;
- musk dens;
- carcasses: Poisson with mean `perKm2·100·4/(8·365) + 0.4` per large animal per 4-day epoch, range 2000 m.

```
off   = angle between the source's bearing and the wind's direction
up    = max(0, cos off)
reach = range·(0.5 + wind strength)·(0.12 + 0.88·up²)
smelled if d ≤ reach, with chance 0.75 (patchy plumes);  strength 1 − d/reach
guess: bearing = wind.from + N(0, 25°), dist = true·exp(N(0, 0.6)), err as smell above
```

---

## 13. Travel

### Step time (`stepHours`, geo.js)

Tobler's hiking function, with vegetation, snow and crossings:

```
slope = Δelev/d
kmh   = 6·e^(−3.5|slope + 0.05|)·(1 − 0.5·veg)        at least 0.6
hours = d/1000/kmh × snowSlow + crossing hours
snowSlow = 1 + snowCm/40 when snow > 2 cm
```

### Crossing water (`crossingNow`, ground.js)

The water at a channel cell, at flow F:

```
depth = DEPTH[size]·F^0.4          DEPTH = brook 0.15, stream 0.4, river 0.9 m
speed = clamp(0.3 + 3.5·slope, 0.2, 2.2)·SPEED[size]·F^0.25     SPEED = 0.6, 0.9, 1.1
dry when F < 0.4 (brook), 0.15 (stream), never (river); frozen streams in a hard week
```

| Situation | Hours | Swept (cells) |
|---|---|---|
| dry | 0.01 | 0 |
| ice | 0.02 | 0 |
| log or boulders above the water | 0.015 | 0 |
| wade (a ford takes 40% of the depth) | `0.02 + 0.094·d·(1 + speed) + 0.25·[swept]` | if `d·speed > 0.6` or `d > 1.3`: `round(clamp(2 + 6·(d·speed − 0.6), 2, 10))` |

### `WALK_STEP` (one step of a walk)

```
drift += N(0, driftSd)   (driftSd 1.5° to a known place, 2.5° otherwise);  ×0.3 when the target was just sensed again
each passable neighbour (no lake):
  score = −0.5·along + 0.5·gain + 0.15·U(0, 1) + 0.9·times trodden this walk
  along: alignment with heading + drift;  gain: change in walking distance to the aim per unit step (goal field, below)
lowest score is taken; hours += stepHours
swept: carried `swept` cells down the flow line (0.02 h each)
```

**Goal field.** Dijkstra distance to the aim:
- cliff cells (slope > 0.35) cost 8×;
- lakes are impassable;
- an aim on a lake is reached at its shore, weighted 0.2 when the lake is the goal and 3 when it's in the way.

### `walk` (the whole hike)

The step repeated until one of these:
- I'm at the believed spot, with nothing sensed further on;
- `maxHours` is reached: 2× the predicted time, between 0.25 and 3 h;
- the target is reached;
- the first wet water, when I'm thirsty (hyd < 0.55);
- 400 steps.

While homing on a target, it's sensed again every 3 steps, which gives a fresh guess.

### Injury on the way (`onTheMove`, injury.js)

The rate on each cell, per hour:

```
rate = (1/150)/2 × steep × underfoot × dark × weather × snow × litter × tired × hungry × sick × limp × unfamiliar
  steep      = 1 + 12·max(0, slope − 0.08)
  underfoot  = scree 3, outcrop 2, deadfall 1.8, streambed 1.8, clay 1.6, pond 1.5, … glade 1 (×1.5 on a river)
  dark       = 1 + 9·(1 − near(lux·(1 − 0.75 veg)))^1.5,   near(lux) = clamp((log₁₀ lux + 1.5)/3)
  weather    = rain 1.6, storm 2, snow 2, blizzard 3, fog 1.2  (×1.4 on rock or clay in rain)
  snow = 1 + min(1, cm/30);  litter = 1 + 0.15·litter
  tired = 1 + 1.5·fatigue²;  hungry = 1 + 2·max(0, 0.3 − energy)/0.3;  sick = 1 + 1.5·sick;  limp = 1 + limp
  unfamiliar = 2 off cells walked before, else 1
```

**Expected injuries** `Λ = Σ rate·stepHours`. At most one per walk, with chance `1 − e^(−Λ)`, on a cell picked in proportion to its share of Λ. Then:

- **Severity:** `clamp(LN(0.25, 0.6), 0.05, 0.9)`.
- **Kind**, by where it happened:
  - in water: slip 0.6, else ankle;
  - steep ground: ankle 0.6, else fall;
  - thick woods or deadfall: cut 0.5, else ankle;
  - elsewhere: ankle 0.7, else fall.

| Kind | Effects | Extra hours |
|---|---|---|
| ankle | `limp = max(limp, sev)` | `0.1 + 0.3·sev` |
| fall | `hands += 0.05 + 0.25·sev`; `fatigue += 0.1 + 0.2·sev`; `focus −= 0.1` | 0.15 |
| cut | `germs += 0.2`; a wound; infection with chance `0.25 + 0.5·sev` → in 30 h, severity `0.15 + 0.35·sev` (washing within 4 h removes it, chance 0.8) | 0.1 |
| slip | soaked (clothes ≥ 0.8; carried items' moisture `+0.24`, at most 0.6); `fatigue += 0.05`; if sev > 0.5, `limp ≥ 0.4·sev` | 0.1 |

**Every walk** takes `1 + 1.5·limp` times as long, then passes at 300 kcal/h.

**Swept by the current:** soaked (moisture +0.3, at most 0.6); `fatigue += 0.15`. Hurt with chance 0.4: a fall or an ankle, at severity `clamp(LN(0.3, 0.5))`.

### `followStage` and `shoreStage`

**Following a stream.** Down the flow line, or up the biggest feeder, for about 0.25 h. Stops at a fork, a waterfall, a spring, a lake, an outlet, the source, or the edge of the land. Bank-walking time is `1.15 × stepHours` without the crossing time.

**Walking a shore.** Shore cells (dry, sharing an edge with this lake), keeping the water on the chosen side:

```
score = lean + 0.15·wet neighbours − 0.05·[diagonal] − 3·times walked
```

It stops after about 0.25 h, or at a mouth, an outlet, all the way round, or the edge. Both pass at 240 kcal/h, with injury as above.

---

## 14. State layers the processes read

These aren't processes: they're pure functions of the world and the time. Every process sees them through the `here`, `sky` and `ground` namespaces.

### Sky (sky.js)

Weather is three-hourly from a slowly wandering front, and temperature follows an annual and a daily cycle. From the lux, `far` and `near` as above. Visibility is 60 km clear, 4 km in rain, 250 m in fog. Hearing is reduced by rain.

### Air dampness (`here.ambient`)

```
a = clamp(base + {rain 0.15, storm 0.25, fog 0.12, snow 0.08, blizzard 0.12, clear afternoon −0.03}, 0.03, 0.6)
base = clamp(0.05 + 0.07·precipMm/(400 + 50·meanTempC), 0.05, 0.35)
```

### Ground (ground.js `stepDay`), integrated day by day

```
melt  = min(snow + snowfall, 3·max(0, meanC) + 0.1·rain·[snow lying])
soak  = 0.85·soak + rain + melt
week  = (6/7)·week + meanC/7;   frozen = week < −4
flow  = clamp((0.35·base(doy) + 0.65·soak/meanSoak)·(frozen ? 0.4 : 1), 0, 8)
leaf  += growing and phase < 0.9 ? 1/21 : −1/28   (clamped)
litter = 0.995·litter + max(0, leaf drop)
```

Snow lying on a cell is scaled by height and canopy.

### Plant seasons (phenology.js)

`partNow(part)` reads the part's season words against the growing season's phase x, shifted per species by U(−0.1, 0.1):

| Season words | Level |
|---|---|
| year-round | 1 |
| early growing season | window over x ∈ [0.03, 0.35] |
| growing season | window over x ∈ [0.04, 0.97] |
| late growing season | window over x ∈ [0.6, 0.6 + U(0.2, 0.4)] |
| late growing season and the winter | 1 out of season, window [0.65, 1.2] in it |
| after rain | `0.15` (1 when the soil is soaked) × `(0.5 + 0.5·clamp(x/0.6))` |

Windows ramp over 0.05 at each end. Outside the growing season everything is 0 except "year-round" and "and the winter".

`plantNow`:

```
leaf    = woody ? (deciduous ? ground.leaf : 1) : max(leaves part level, 0.15)
notice  = (herb or grass ? 0.3 + 0.7·leaf : 1) × (flowering 1.3) × (fruiting 1.15) × (mushroom ? level : 1)
```

`cueShows(cue)` decides whether a feature is visible now:
- fruit and seed features need that part at ≥ 0.3;
- flowers need flowers at ≥ 0.3;
- dead stalks need dead stalks at ≥ 0.3;
- leaf, blade and stem features need leaf ≥ 0.3;
- everything else shows all year.

`fruitShows` needs berries, fruits or nuts at ≥ 0.5.

### Animals' seasons (life.js `animalNow`)

```
away    = migrant and meanC < 8 °C;   dormant = meanC < its dormancy temperature
breeding = day of year inside its breeding window
calls   ×= 2.5 breeding (with a breeding call); in rain: shy ×0.15 (seen ×0.5), rain-callers ×2 breeding / ×1.3
seen    ×= 0.3 for baskers under cloud; invertebrates ×0.5 in rain
here = !(away or dormant)
```

### Patch traits (variation.js `samplePatch`)

A varying trait at a site (wood density, height, fruit size, …):

```
z = Σ_f loading_f·factor_f + lineage·g + √(1 − Σ loading² − lineage²)·ε
value = logistic(μ + sd·z)  (0–1 traits)  or  exp(μ + sd·z)  (positive traits)
site factors f = 0.6·clamp(microhabitat's typical value, −2, 2) + 0.8·N(0, 1)
```

The site factors are moisture, fertility and exposure.

---

## 15. Bookkeeping processes

These change state, but by rule rather than by number:

| Process | Effect |
|---|---|
| `think` (0.1 h; refused when focus < 0.25) | focus −0.06; reveals one node of the plan tree |
| `rename` | sets a place's name |
| `drop` | removes an item |
| `stop-looking` | clears the search |
| `hike`, `sleep` | game-side wrappers that run §13 and §3 inside one transaction, so a whole walk or night is undoable and its draws recorded |

The start-screen outlook (outlook.js) and the closed-form fire estimate (craft.js `estimateFire`) are estimators over these rules, not processes. They are described in the README.
