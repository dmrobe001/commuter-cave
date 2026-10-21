// variation.js — patch-level variation within an archetype.
//
// Each varying trait is a latent normal variable driven by shared site factors
// (moisture, fertility, exposure), a species-specific "lineage" factor for the
// local population, and independent noise:
//
//   z = Σ loading_f · factor_f  +  lineage · g  +  sqrt(1 − Σ loadings²) · ε
//   trait = transform(mu + sd · z)       (logistic for 0–1 traits, exp for positive ones)
//
// Because covariance comes from shared factors, it is always valid, and the
// same wet, fertile site pushes every species growing there in coherent ways.
//
// A patch's values are a pure function of (seed, site, entity): nothing needs
// to be stored, and the order in which the player notices traits never matters.

import { makeRng, clamp } from './rng.js';

export const FACTORS = ['moisture', 'fertility', 'exposure'];
const MICRO_FERTILITY = {
  streambank: 1, pond: 0.8, deadfall: 0.6, spring: 0.5, woodland: 0.5, edge: 0.3,
  claybank: 0.2, streambed: 0.2, glade: 0, outcrop: -1, scree: -1.3,
};
const SITE_SHARE = 0.6; // how much of a site factor is explained by its microhabitat

const logistic = x => 1 / (1 + Math.exp(-x));
const logit = p => Math.log(p / (1 - p));
export const toLatent = (scale, v) => (scale === '01' ? logit(clamp(v, 0.03, 0.97)) : Math.log(Math.max(v, 1e-6)));
export const fromLatent = (scale, y) => (scale === '01' ? logistic(y) : Math.exp(y));
export const sig = (x, n = 3) => (x === 0 ? 0 : Number(x.toPrecision(n)));

// Turn a catalog spec into a concrete varying trait for one archetype.
// Priors set the *usual* direction of a factor's effect; 20% of the time it flips,
// so players can't assume the textbook direction holds in every world.
// `integration` (0–1) is the share of each trait's variance that comes from shared
// causes (site factors + lineage). High integration means strongly coupled traits.
// `lineageShare` is the part of that shared variance carried by the local population's
// lineage factor, which acts on every trait of the archetype at once (so it creates correlation).
export function makeVarying(r, spec, subject, integration = 0.5, lineageShare = 0.5) {
  const loadings = {};
  for (const f of FACTORS) {
    const prior = spec.prior?.[f] ?? 0;
    loadings[f] = prior
      ? Math.sign(prior) * (r.chance(0.8) ? 1 : -1) * r.uniform(0.3, 1)
      : r.normal(0, 0.2);
  }
  const shared = Math.min(integration, 0.95);
  const lineage = (r.chance(0.5) ? 1 : -1) * Math.sqrt(shared * lineageShare);
  const siteSS = FACTORS.reduce((s, f) => s + loadings[f] ** 2, 0) || 1;
  const k = Math.sqrt(shared * (1 - lineageShare) / siteSS);
  for (const f of FACTORS) loadings[f] *= k;
  for (const f of FACTORS) loadings[f] = sig(loadings[f], 2);
  const val = x => (typeof x === 'function' ? x(subject) : x);
  return {
    id: spec.id, label: val(spec.label), kind: spec.kind, scale: spec.scale, unit: val(spec.unit) ?? '',
    mu: sig(toLatent(spec.scale, spec.median(subject)), 4), sd: spec.sd,
    loadings, lineage: sig(lineage, 2), integration,
  };
}

// Site factors are shared by everything at a site (a map node), so a wet site is wet for all species.
export function siteFactors(seed, siteKey, micro) {
  const r = makeRng(`${seed}/site/${siteKey}`);
  const v = micro?.vector ?? { moisture: 0.55, light: 0.6 };
  const env = {
    moisture: (v.moisture - 0.55) / 0.25,
    fertility: MICRO_FERTILITY[micro?.id] ?? 0,
    exposure: (v.light - 0.6) / 0.25,
  };
  const out = {};
  for (const f of FACTORS) out[f] = SITE_SHARE * clamp(env[f], -2, 2) + Math.sqrt(1 - SITE_SHARE ** 2) * r.normal();
  return out;
}

export function sampleVarying(seed, entityId, siteKey, varying, factors) {
  const r = makeRng(`${seed}/patch/${entityId}/${siteKey}`);
  const g = r.normal(); // this local population's lineage value
  const out = {};
  for (const t of varying) {
    const ss = FACTORS.reduce((s, f) => s + t.loadings[f] ** 2, 0) + t.lineage ** 2;
    const z = FACTORS.reduce((s, f) => s + t.loadings[f] * factors[f], 0)
      + t.lineage * g + Math.sqrt(Math.max(0, 1 - ss)) * r.normal();
    out[t.id] = fromLatent(t.scale, t.mu + t.sd * z);
  }
  return out;
}

// Monte Carlo summary over the sites where this entity actually occurs:
// what a player would experience sampling many patches.
export function summarize(seed, entityId, varying, sites, env, n = 1000) {
  if (!varying.length || !sites.length) return null;
  const total = sites.reduce((s, x) => s + x.weight, 0);
  const r = makeRng(`${seed}/mc/${entityId}`);
  const samples = [], byMicro = {};
  for (let i = 0; i < n; i++) {
    let u = r.next() * total, site = sites[0];
    for (const s of sites) { u -= s.weight; if (u <= 0) { site = s; break; } }
    const micro = env.microhabitats.find(m => m.id === site.micro);
    const f = siteFactors(`${seed}/mc`, `${entityId}-${i}`, micro);
    const v = sampleVarying(`${seed}/mc`, entityId, `${i}`, varying, f);
    samples.push(v);
    (byMicro[site.micro] ??= []).push(v);
  }
  const ids = varying.map(t => t.id);
  const mean = {}, sd = {}, q = {};
  for (const id of ids) {
    const xs = samples.map(s => s[id]).sort((a, b) => a - b);
    mean[id] = xs.reduce((a, b) => a + b, 0) / n;
    sd[id] = Math.sqrt(xs.reduce((a, b) => a + (b - mean[id]) ** 2, 0) / (n - 1));
    q[id] = [xs[Math.floor(0.16 * n)], xs[Math.floor(0.84 * n)]];
  }
  const corr = ids.map(a => ids.map(b => {
    if (a === b) return 1;
    const c = samples.reduce((s, v) => s + (v[a] - mean[a]) * (v[b] - mean[b]), 0) / (n - 1);
    return sig(c / (sd[a] * sd[b]), 2);
  }));
  const microMeans = {};
  for (const [m, arr] of Object.entries(byMicro)) {
    if (arr.length < 30) continue;
    microMeans[m] = Object.fromEntries(ids.map(id => [id, sig(arr.reduce((s, v) => s + v[id], 0) / arr.length, 3)]));
  }
  return {
    traits: varying.map(t => ({
      id: t.id, label: t.label, kind: t.kind, unit: t.unit,
      mean: sig(mean[t.id], 3), sd: sig(sd[t.id], 2), q16: sig(q[t.id][0], 3), q84: sig(q[t.id][1], 3),
    })),
    ids, corr, microMeans,
  };
}
