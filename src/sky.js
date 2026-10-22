// sky.js — the world's clock: calendar, sun, moon, light and weather.
//
// Everything here is a pure function of the world (its seed and climate) and the time, so the weather
// on day 5 at noon is the same however I spent days 1 to 4, and a replay sees the same sky.
//
//   Calendar: the world sits at a latitude implied by its climate (colder and more seasonal: further
//   from the equator) and the game starts on a day of the year drawn from the seed, between late March
//   and mid-August. Seasons follow the day of the year.
//   Sun: altitude from the standard declination formula (solar time, northern hemisphere); day length
//   and dawn follow from it. Moon: a 29.53-day cycle from a seeded phase; it runs about phase × 24 h
//   behind the sun, and its declination swings opposite the sun's at full moon (winter full moons ride
//   high). Light: illuminance in lux from sun, twilight, moon and stars, cut by cloud.
//   Weather: a three-hourly chain driven by a slowly wandering "front" (an AR(1) series with a memory of
//   about two days), so wet and dry spells come and go; how often it rains is set by the climate's
//   rainfall and the season (monsoon climates have a wet season). Rain becomes snow below freezing; fog
//   forms in the small hours after clear or damp nights in wet country and burns off by late morning.
//   Temperature: an annual cycle (coldest mid-January) plus a daily one (coldest before dawn, warmest
//   mid-afternoon) whose swing clouds and rain damp.
//
// Numbers are judgement anchored on familiar values (full moon about 0.25 lux, overcast noon a few
// thousand, civil twilight's end about 3), to be tuned, not measurements.
import { makeRng, clamp } from './rng.js';

const RAD = Math.PI / 180, STEP = 3; // hours per weather step
export const SYNODIC = 29.53;

// ------------------------------------------------------------ calendar
export function calendar(world) {
  if (world._calendar) return world._calendar;
  const e = world.environment, r = makeRng(`${world.seed}/calendar`);
  const lat = clamp(64 - 2.2 * e.meanTempC + 10 * (e.seasonality - 0.5), 3, 62);
  const monsoon = e.leanSeason === 'dry season';
  const cal = {
    lat, monsoon,
    doy0: Math.round(r.uniform(80, 230)), // day of the year the game starts on
    moon0: r.next(), // phase on day 1 (0 new, 0.5 full)
    tempAmp: 2 + 20 * e.seasonality * Math.pow(lat / 60, 1.2), // half the annual swing of the daily mean, °C
  };
  return (world._calendar = cal);
}
export const dayOfYear = (world, day, t = 12) => calendar(world).doy0 + (day - 1) + t / 24;
const wrapDoy = d => ((d % 365) + 365) % 365;

export function seasonOf(world, doy) {
  const cal = calendar(world), d = wrapDoy(doy);
  if (cal.monsoon) return rainFactor(world, doy) > 1 ? 'wet season' : 'dry season';
  return d < 60 || d >= 335 ? 'winter' : d < 152 ? 'spring' : d < 244 ? 'summer' : 'autumn';
}

// ------------------------------------------------------------ sun and moon
const declination = doy => -23.44 * Math.cos(2 * Math.PI * (doy + 10) / 365);
function altitude(lat, decl, hourAngleDeg) {
  const s = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(hourAngleDeg * RAD);
  return Math.asin(clamp(s, -1, 1)) / RAD;
}
export function sunAltitude(world, day, t) { return altitude(calendar(world).lat, declination(dayOfYear(world, day, t)), 15 * (t - 12)); }
// hours of the sun above the horizon (alt = 0) or above `alt` (−6 for civil twilight), and when it rises
export function dayLength(world, day, alt = 0) {
  const lat = calendar(world).lat * RAD, d = declination(dayOfYear(world, day)) * RAD;
  const c = (Math.sin(alt * RAD) - Math.sin(lat) * Math.sin(d)) / (Math.cos(lat) * Math.cos(d));
  if (c >= 1) return 0;
  if (c <= -1) return 24;
  return 2 * Math.acos(c) / RAD / 15;
}
export const dawnAt = (world, day) => 12 - dayLength(world, day, -6) / 2; // civil dawn, solar time
export const duskAt = (world, day) => 12 + dayLength(world, day, -6) / 2;
export function moonAt(world, day, t) {
  const cal = calendar(world), abs = day - 1 + t / 24;
  const phase = (((cal.moon0 + abs / SYNODIC) % 1) + 1) % 1;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const alt = altitude(cal.lat, declination(dayOfYear(world, day, t)) * Math.cos(2 * Math.PI * phase), 15 * (t - 12 - 24 * phase));
  return { phase, illum, alt };
}
export function moonWords(phase) {
  const p = phase * 8;
  return ['new moon', 'thin crescent moon', 'half moon', 'gibbous moon', 'full moon', 'gibbous moon', 'half moon', 'thin crescent moon'][Math.round(p) % 8];
}

// ------------------------------------------------------------ weather
// how much more (or less) it rains at this time of year than on average
function rainFactor(world, doy) {
  const cal = calendar(world), s = world.environment.seasonality;
  return cal.monsoon ? 1 + 0.9 * s * Math.cos(2 * Math.PI * (doy - 200) / 365) // the wet season peaks in high summer
    : 1 + 0.15 * Math.cos(2 * Math.PI * (doy - 15) / 365); // a little wetter in winter
}
function invNorm(p) { // the standard normal quantile (Acklam's rational approximation; plenty here)
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  if (q < 0.02425) { const u = Math.sqrt(-2 * Math.log(q)); return (((((c[0] * u + c[1]) * u + c[2]) * u + c[3]) * u + c[4]) * u + c[5]) / ((((d[0] * u + d[1]) * u + d[2]) * u + d[3]) * u + 1); }
  if (q > 1 - 0.02425) return -invNorm(1 - q);
  const u = q - 0.5, v = u * u;
  return (((((a[0] * v + a[1]) * v + a[2]) * v + a[3]) * v + a[4]) * v + a[5]) * u / (((((b[0] * v + b[1]) * v + b[2]) * v + b[3]) * v + b[4]) * v + 1);
}
export const WEATHER_WORDS = { clear: 'clear', cloudy: 'broken cloud', overcast: 'overcast', rain: 'rain', storm: 'a thunderstorm', fog: 'fog', snow: 'snow', blizzard: 'driving snow' };
// the weather in three-hour step k (k = 0 from midnight before day 1), worked out in order and kept
function weatherStep(world, k) {
  const cache = (world._weather ??= { front: [], states: [] });
  const persist = Math.exp(-STEP / 48);
  for (let i = cache.front.length; i <= k; i++) {
    const r = makeRng(`${world.seed}/weather/${i}`);
    const prev = i ? cache.front[i - 1] : makeRng(`${world.seed}/weather/start`).normal();
    const front = persist * prev + Math.sqrt(1 - persist * persist) * r.normal();
    cache.front.push(front);
    const day = Math.floor(i * STEP / 24) + 1, t = (i * STEP) % 24 + STEP / 2, doy = dayOfYear(world, day, t);
    const wetShare = clamp(world.environment.precipMm / 8000 * rainFactor(world, doy), 0.015, 0.4); // share of the time it's raining
    const a = invNorm(1 - wetShare), temp = temperature(world, day, t, 'cloudy');
    let st = front > a + 1.1 ? 'storm' : front > a ? 'rain' : front > a - 0.7 ? 'overcast' : front > a - 1.5 ? 'cloudy' : 'clear';
    if (st === 'rain' && temp > 18 && t >= 12 && t <= 20 && r.chance(0.35)) st = 'storm'; // summer afternoon thunder
    if (temp < 0.5 && (st === 'rain' || st === 'storm')) st = st === 'storm' ? 'blizzard' : 'snow';
    // fog: in the small hours and early morning, after a clear or damp spell, in wet country
    const prevSt = cache.states[i - 1];
    if ((st === 'clear' || st === 'cloudy') && t >= 1 && t <= 10) {
      const damp = clamp(world.environment.water, 0, 1.5) * (prevSt === 'rain' || prevSt === 'fog' ? 1.6 : 1);
      if (r.chance(clamp(0.18 * damp * (prevSt === 'fog' ? 2.5 : 1)))) st = 'fog';
    }
    cache.states.push(st);
  }
  return cache.states[k];
}
export const weatherAt = (world, day, t) => weatherStep(world, Math.max(0, Math.floor(((day - 1) * 24 + t) / STEP)));

// ------------------------------------------------------------ temperature
const DIURNAL = { clear: 12, cloudy: 9, overcast: 5, rain: 3, storm: 4, fog: 5, snow: 3, blizzard: 3 };
export function dailyMeanTemp(world, day) {
  const cal = calendar(world);
  return world.environment.meanTempC - cal.tempAmp * Math.cos(2 * Math.PI * (dayOfYear(world, day) - 15) / 365);
}
export function temperature(world, day, t, weather = null) {
  const w = weather ?? weatherAt(world, day, t);
  return dailyMeanTemp(world, day) + DIURNAL[w] / 2 * Math.sin(2 * Math.PI * (t - 9) / 24) - (w === 'rain' || w === 'storm' ? 1.5 : 0);
}

// ------------------------------------------------------------ light and seeing
// how much of the light from above gets through (by day, and the dimmer moon and stars by night)
const CLOUD = { clear: 1, cloudy: 0.6, overcast: 0.25, rain: 0.15, storm: 0.06, fog: 0.35, snow: 0.2, blizzard: 0.1 };
// how far one can see through the air itself, in metres
const VISIBILITY = { clear: 60000, cloudy: 45000, overcast: 25000, rain: 4000, storm: 1500, fog: 250, snow: 1500, blizzard: 300 };
// what the weather does to hearing: rain on leaves raises the threshold; fog carries sound a little
const NOISE = { clear: 1, cloudy: 1, overcast: 1, rain: 0.55, storm: 0.3, fog: 1.1, snow: 0.95, blizzard: 0.4 };
export function skyAt(world, day, t) {
  const sunAlt = sunAltitude(world, day, t), moon = moonAt(world, day, t), weather = weatherAt(world, day, t);
  const sun = sunAlt > 0 ? 400 + 1.2e5 * Math.sin(sunAlt * RAD) : Math.pow(10, 2.6 + 0.35 * Math.max(sunAlt, -18));
  const moonLux = moon.alt > 0 ? 0.25 * Math.pow(moon.illum, 3) * Math.sqrt(Math.sin(moon.alt * RAD)) : 0;
  const c = CLOUD[weather], night = moonLux + 0.002; // starlight and airglow
  const lux = sun * c + night * Math.pow(c, 1.5); // thin cloud hides the moon more than it dims the sun
  return {
    day, t, doy: dayOfYear(world, day, t), season: seasonOf(world, dayOfYear(world, day, t)),
    sunAlt, moon, weather, lux, tempC: temperature(world, day, t, weather), meanC: dailyMeanTemp(world, day),
    visibility: VISIBILITY[weather], hearing: NOISE[weather],
    wet: ['rain', 'storm', 'snow', 'blizzard'].includes(weather), dark: sunAlt < -6,
  };
}
// How well one can see by a given light: `far` for shapes against the sky and the lie of the land (a
// hill, a lake, a cliff: good down to moonlight), `near` for detail close by (a plant, a track, an
// animal in cover: needs daylight or deep twilight). Both 0..1, on a log scale of lux.
export const seeingFar = lux => clamp((Math.log10(Math.max(lux, 1e-5)) + 3.3) / 3);
export const seeingNear = lux => clamp((Math.log10(Math.max(lux, 1e-5)) + 1.5) / 3);
// a thing at distance d (m) seen through air with this visibility: the contrast that's left
export const throughAir = (d, visibility) => Math.exp(-3 * d / visibility); // Koschmieder: 2% contrast at the visibility
