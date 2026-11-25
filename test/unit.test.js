'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TtlCache } = require('../src/cache');
const { parseCoordinates, parsePlaceQuery, parsePoints } = require('../src/validate');
const { describe, owmToWmo } = require('../src/conditions');
const { buildInsights, exerciseScore, aqiCategory } = require('../src/insights');
const { localIso } = require('../src/providers/openWeatherMap');
const { sampleForecast } = require('./fixtures');

test('validate: accepts valid coordinates and rejects bad ones', () => {
  assert.deepEqual(parseCoordinates('-1.95', '30.06'), { lat: -1.95, lon: 30.06 });
  assert.throws(() => parseCoordinates('91', '0'), /between -90 and 90/);
  assert.throws(() => parseCoordinates('0', '-181'), /between -180 and 180/);
  assert.throws(() => parseCoordinates('abc', '0'), /decimal number/);
  assert.throws(() => parseCoordinates('1e5', '0'), /decimal number/);
  assert.throws(() => parseCoordinates(undefined, '0'), /decimal number/);
  assert.throws(() => parseCoordinates(['1', '2'], '0'), /decimal number/);
});

test('validate: place queries allow international names but block markup', () => {
  assert.equal(parsePlaceQuery('  São   Paulo '), 'São Paulo');
  assert.equal(parsePlaceQuery("Côte d'Ivoire"), "Côte d'Ivoire");
  assert.equal(parsePlaceQuery('東京'), '東京');
  assert.throws(() => parsePlaceQuery('a'), /at least 2/);
  assert.throws(() => parsePlaceQuery('<script>alert(1)</script>'), /unsupported characters/);
  assert.throws(() => parsePlaceQuery("x'; DROP TABLE users;--"), /unsupported characters/);
  assert.throws(() => parsePlaceQuery('a'.repeat(81)), /80 characters/);
});

test('validate: compare points', () => {
  assert.deepEqual(parsePoints('1,2|3.5,-4'), [{ lat: 1, lon: 2 }, { lat: 3.5, lon: -4 }]);
  assert.throws(() => parsePoints(''), /required/);
  assert.throws(() => parsePoints('1,2,3'), /lat,lon/);
  assert.throws(() => parsePoints(Array(11).fill('1,2').join('|')), /at most 10/);
});

test('cache: hit, expiry, stale copy and LRU eviction', () => {
  let now = 0;
  const cache = new TtlCache({ maxEntries: 2, now: () => now });
  cache.set('a', 1, 100);
  assert.equal(cache.get('a'), 1);
  now = 150;
  assert.equal(cache.get('a'), undefined, 'expired');
  assert.equal(cache.getStale('a').value, 1, 'stale copy kept');
  cache.set('b', 2, 100);
  cache.set('c', 3, 100);
  assert.equal(cache.getStale('a'), undefined, 'oldest evicted');
  assert.equal(cache.stats().entries, 2);
});

test('cache: concurrent wrap calls share one loader call', async () => {
  const cache = new TtlCache();
  let calls = 0;
  const loader = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return 'v'; };
  const results = await Promise.all([cache.wrap('k', 1000, loader), cache.wrap('k', 1000, loader), cache.wrap('k', 1000, loader)]);
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.value === 'v'));
  const again = await cache.wrap('k', 1000, loader);
  assert.equal(again.cached, true);
});

test('conditions: WMO and OpenWeatherMap mapping', () => {
  assert.equal(describe(0, true).icon, 'clear-day');
  assert.equal(describe(0, false).icon, 'clear-night');
  assert.equal(describe(63).group, 'rain');
  assert.equal(describe(95).group, 'storm');
  assert.equal(describe(12345).label, 'Unknown');
  assert.equal(owmToWmo(800), 0);
  assert.equal(owmToWmo(211), 95);
  assert.equal(owmToWmo(501), 63);
  assert.equal(owmToWmo(601), 73);
  assert.equal(owmToWmo(741), 45);
  assert.equal(owmToWmo(804), 3);
});

test('openweathermap: local time conversion', () => {
  // 2024-01-01T00:00Z with +2h offset -> 02:00 local
  assert.equal(localIso(1704067200, 7200), '2024-01-01T02:00');
});

test('insights: rain ahead produces umbrella warning and summary mention', () => {
  const data = sampleForecast({ rainAt: 3 });
  const ins = buildInsights(data);
  const umbrella = ins.activities.find((a) => a.id === 'umbrella');
  assert.equal(umbrella.status, 'bad');
  assert.match(umbrella.detail, /80% chance/);
  assert.match(ins.summary, /rain likely/);
});

test('insights: dry, mild day is good for exercise and laundry', () => {
  const ins = buildInsights(sampleForecast());
  assert.equal(ins.activities.find((a) => a.id === 'umbrella').status, 'good');
  assert.equal(ins.activities.find((a) => a.id === 'exercise').status, 'good');
  assert.equal(ins.activities.find((a) => a.id === 'laundry').status, 'good');
});

test('insights: no UV data means no sunscreen card', () => {
  const data = sampleForecast();
  data.hourly.forEach((h) => { h.uvIndex = null; });
  const ins = buildInsights(data);
  assert.equal(ins.activities.find((a) => a.id === 'sunscreen'), undefined);
});

test('insights: exercise score penalises storms, heat and night', () => {
  const base = { feelsLike: 16, precipProb: 0, windSpeed: 5, uvIndex: 2, isDay: true, condition: { group: 'clear' } };
  assert.equal(exerciseScore(base), 100);
  assert.ok(exerciseScore({ ...base, condition: { group: 'storm' } }) < 50);
  assert.ok(exerciseScore({ ...base, feelsLike: 35 }) < 50);
  assert.ok(exerciseScore({ ...base, isDay: false }) < 80);
});

test('insights: AQI categories', () => {
  assert.equal(aqiCategory(20).level, 'good');
  assert.equal(aqiCategory(120).level, 'sensitive');
  assert.equal(aqiCategory(400).level, 'hazardous');
  assert.equal(aqiCategory(null), null);
});

test('openweathermap: normalizes free-tier payloads into the common shape', () => {
  const { normalize } = require('../src/providers/openWeatherMap');
  const base = 1764064800; // 2025-11-25T10:00Z
  const item = (i, id, pop) => ({
    dt: base + i * 10800,
    main: { temp: 20 + i, feels_like: 19 + i, humidity: 60, temp_max: 21 + i, temp_min: 19 + i },
    weather: [{ id }],
    wind: { speed: 5 },
    pop,
  });
  const cur = { dt: base, main: { temp: 20, feels_like: 19, humidity: 60, pressure: 1012 }, weather: [{ id: 800 }], wind: { speed: 5, deg: 90 }, clouds: { all: 0 }, visibility: 10000, sys: { sunrise: base - 4 * 3600, sunset: base + 8 * 3600 } };
  const fc = { city: { name: 'Kigali', timezone: 7200 }, list: Array.from({ length: 16 }, (_, i) => item(i, i === 2 ? 501 : 800, i === 2 ? 0.7 : 0)) };
  const air = { list: [{ main: { aqi: 2 }, components: { pm2_5: 9, pm10: 12, o3: 30, no2: 4 } }] };
  const d = normalize(cur, fc, air);
  assert.equal(d.provider, 'OpenWeatherMap');
  assert.equal(d.current.time, '2025-11-25T12:00');
  assert.equal(d.current.windSpeed, 18);
  assert.equal(d.current.condition.group, 'clear');
  assert.equal(d.hourly[2].precipProb, 70);
  assert.equal(d.hourly[2].condition.label, 'Rain');
  assert.equal(d.current.uvIndex, null);
  assert.equal(d.airQuality.usAqi, 75);
  assert.ok(d.daily.length >= 2);
  const ins = buildInsights(d);
  assert.equal(ins.activities.find((a) => a.id === 'sunscreen'), undefined);
  assert.equal(ins.activities.find((a) => a.id === 'umbrella').status, 'bad');
});
