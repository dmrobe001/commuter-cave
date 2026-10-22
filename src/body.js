// body.js — sleep as a process: an hour at a time, the night, what I'm sheltered by, lying on and
// wearing, and my body give how well I sleep and what it does to me.
//
// A heat balance in the units outdoor clothing uses. A resting person's skin is at about 33 °C and they
// make about 40 W per m² of skin; one clo of insulation (0.155 m²·K/W: a business suit) holds back a
// 6.2 °C difference at that rate, so staying warm takes (33 − T) / 6.2 clo all told (Gagge; ISO 9920,
// roughly). Curled up, and allowing for sleeping a little cool, I take (33 − T) / 8. What there is:
//   clothes: their clo, losing up to 60% of it when soaked;
//   the still air around me: 0.7 clo, blown away by the wind;
//   shelter: a hut's walls and roof add insulation and keep the wind and rain off; trees and rocks do
//     a little of both;
//   the ground: bare earth draws heat out (about −0.4 clo, worse wet, worse with snow on it), a bed of
//     leaves, moss or grass in between puts some back;
//   fire: a banked fire warms the air round me by several degrees, fading as it burns down.
// The shortfall (deficit, 0 snug .. 1 freezing) costs sleep, burns energy shivering and, past a point,
// builds a chill that lingers into the morning and can make me ill. Rain on me, wind noise, biting
// insects, hunger, thirst and pain cost sleep too. Each loss is kept by name, so the morning's words can
// say what kept me awake. Numbers are judgement, tuned so a mild summer night in the open is fair, a
// cold one is wretched, and a debris hut with a bed of leaves sleeps warm down to about freezing.

export const SHELTERS = {
  open: { windBlock: 0, rainBlock: 0, clo: 0 },
  hut: { windBlock: 0.9, rainBlock: 0.95, clo: 1.5, floor: 0.4 }, // a debris hut: a thick leaf-and-branch shell round me, and leaves under me
};
// shelter from what's around me: trees break the wind and some rain (less when bare), rocks some wind
export function naturalShelter(veg, leaf, micro) {
  const crown = veg * (0.4 + 0.6 * leaf);
  return { windBlock: Math.min(0.8, 0.6 * crown + (['outcrop', 'scree'].includes(micro) ? 0.3 : 0)), rainBlock: 0.5 * crown, clo: 0 };
}

// One hour. env: { tempC, windMs, precip ('rain' | 'storm' | 'snow' | 'blizzard' | null), groundWet 0..1,
// snowCm, biters }; shelter: { windBlock, rainBlock, clo }; bed: { clo, wet } or null; clothes: { clo,
// wet }; fireC: degrees a fire adds; body: { energy, hyd, limp }.
export function sleepHour({ env, shelter, bed, clothes, fireC = 0, body }) {
  const wind = env.windMs * (1 - shelter.windBlock);
  const exposed = env.precip ? 1 - shelter.rainBlock : 0, pour = { storm: 2, blizzard: 1.5 }[env.precip] ?? 1;
  const air = 0.7 / (1 + 0.25 * wind); // still air held round me, thinned by the wind
  const worn = clothes.clo * (1 - 0.6 * clothes.wet);
  const ground = (bed ? bed.clo * (1 - 0.5 * bed.wet) : 0) + (shelter.floor ?? 0) - 0.4 - 0.3 * env.groundWet - (env.snowCm > 2 ? 0.4 : 0);
  const have = Math.max(0.2, worn + air + shelter.clo + ground);
  const T = env.tempC + fireC, need = Math.max(0.1, (33 - T) / 8);
  const deficit = Math.min(1, Math.max(0, (need - have) / need));
  const hot = T > 30 ? (T - 30) / 8 : 0;
  // what the cold is mostly down to, for the morning's words: the ground, the wind, wet clothes, or the night itself
  const cause = [['ground', -ground], ['wind', 0.7 - air], ['wet', clothes.clo * 0.6 * clothes.wet], ['air', need - 1.6]].sort((a, b) => b[1] - a[1])[0][0];
  const loss = {
    cold: 1.2 * Math.max(0, deficit - 0.15), hot: 0.3 * hot, rain: 0.3 * exposed * pour, wind: wind > 8 ? 0.1 : 0,
    biters: env.biters ? 0.2 : 0, hunger: body.energy < 0.2 ? 0.25 : 0, thirst: body.hyd < 0.3 ? 0.2 : 0, pain: 0.3 * (body.limp ?? 0),
  };
  const quality = Math.max(0.05, Math.min(1, 1 - Object.values(loss).reduce((a, b) => a + b, 0)));
  return {
    quality, deficit, loss, coldCause: cause,
    chill: deficit > 0.35 ? 0.08 * (deficit - 0.35) : -0.15, // core heat lost, or made back
    kcal: 150 * Math.max(0, deficit - 0.25), // shivering
    wetting: exposed * 0.25 * pour, // rain soaking my clothes (and the bed)
    drying: exposed ? 0 : 0.05 + (fireC > 0 ? 0.15 : 0), // body heat and the fire drying them
  };
}
