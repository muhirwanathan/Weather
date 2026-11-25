'use strict';
/**
 * OpenWeatherMap provider (https://openweathermap.org/api). Needs an API key
 * (OPENWEATHER_API_KEY in .env). Used as an automatic failover when the
 * primary provider is down. Only free-tier endpoints are used:
 *   - Geocoding API      /geo/1.0/direct
 *   - Current weather    /data/2.5/weather
 *   - 5 day / 3 hour     /data/2.5/forecast
 *   - Air pollution      /data/2.5/air_pollution
 *
 * The key is added to the URL on the server only. It never reaches the browser.
 */
const { fetchJson } = require('../http');
const { describe, owmToWmo } = require('../conditions');
const { UpstreamError } = require('../errors');

const NAME = 'OpenWeatherMap';
const BASE = 'https://api.openweathermap.org';

/** Unix seconds + offset -> local "YYYY-MM-DDTHH:mm" (same format Open-Meteo uses). */
function localIso(unixSeconds, offsetSeconds) {
  return new Date((unixSeconds + offsetSeconds) * 1000).toISOString().slice(0, 16);
}

/** OWM's 1-5 air quality index converted to an approximate US AQI value. */
const OWM_AQI_TO_US = { 1: 25, 2: 75, 3: 125, 4: 175, 5: 250 };

function createOpenWeatherMapProvider({ apiKey, timeoutMs = 6000 }) {
  if (!apiKey) throw new Error('OpenWeatherMap provider requires an API key');
  const opts = { provider: NAME, timeoutMs };
  const url = (path, params) => `${BASE}${path}?${new URLSearchParams({ ...params, appid: apiKey })}`;

  async function geocode(query) {
    const data = await fetchJson(url('/geo/1.0/direct', { q: query, limit: '8' }), opts);
    return (Array.isArray(data) ? data : []).map((r) => ({
      name: r.name,
      region: r.state || '',
      country: r.country || '',
      countryCode: r.country || '',
      lat: r.lat,
      lon: r.lon,
      timezone: '',
      population: null,
    }));
  }

  async function forecast(lat, lon) {
    const p = { lat: String(lat), lon: String(lon), units: 'metric' };
    const [cur, fc, air] = await Promise.allSettled([
      fetchJson(url('/data/2.5/weather', p), opts),
      fetchJson(url('/data/2.5/forecast', p), opts),
      fetchJson(url('/data/2.5/air_pollution', { lat: String(lat), lon: String(lon) }), { ...opts, retries: 0 }),
    ]);
    if (cur.status === 'rejected') throw cur.reason;
    if (fc.status === 'rejected') throw fc.reason;
    return normalize(cur.value, fc.value, air.status === 'fulfilled' ? air.value : null);
  }

  return { name: NAME, geocode, forecast };
}

function normalize(cur, fc, air) {
  if (!cur || !cur.main || !fc || !Array.isArray(fc.list) || !fc.city) {
    throw new UpstreamError(`${NAME} returned an incomplete forecast`, { provider: NAME });
  }
  const offset = fc.city.timezone || 0;
  const sunrise = cur.sys.sunrise;
  const sunset = cur.sys.sunset;
  const isDayAt = (t) => {
    // Shift today's sunrise/sunset by whole days to approximate for later dates.
    const secondsOfDay = (t + offset) % 86400;
    return secondsOfDay >= (sunrise + offset) % 86400 && secondsOfDay < (sunset + offset) % 86400;
  };
  const kmh = (ms) => Math.round(ms * 3.6 * 10) / 10;

  const hourly = fc.list.slice(0, 16).map((it) => {
    const isDay = isDayAt(it.dt);
    return {
      time: localIso(it.dt, offset),
      temp: it.main.temp,
      feelsLike: it.main.feels_like,
      humidity: it.main.humidity,
      precipProb: Math.round((it.pop || 0) * 100),
      precip: (it.rain && it.rain['3h']) || (it.snow && it.snow['3h']) || 0,
      windSpeed: kmh(it.wind.speed),
      uvIndex: null, // not available on the free tier
      isDay,
      condition: describe(owmToWmo(it.weather[0].id), isDay),
    };
  });

  // Group 3-hourly steps into calendar days (local time).
  const byDay = new Map();
  for (const it of fc.list) {
    const date = localIso(it.dt, offset).slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(it);
  }
  const daily = [...byDay.entries()].slice(0, 6).map(([date, items]) => {
    const middle = items[Math.floor(items.length / 2)];
    return {
      date,
      max: Math.max(...items.map((i) => i.main.temp_max)),
      min: Math.min(...items.map((i) => i.main.temp_min)),
      sunrise: localIso(sunrise, offset).replace(/^.{10}/, date),
      sunset: localIso(sunset, offset).replace(/^.{10}/, date),
      uvMax: null,
      precipSum: Math.round(items.reduce((s, i) => s + ((i.rain && i.rain['3h']) || 0), 0) * 10) / 10,
      precipProbMax: Math.round(Math.max(...items.map((i) => i.pop || 0)) * 100),
      windMax: kmh(Math.max(...items.map((i) => i.wind.speed))),
      condition: describe(owmToWmo(middle.weather[0].id), true),
    };
  });

  const isDay = cur.dt >= sunrise && cur.dt < sunset;
  const a = air && air.list && air.list[0];
  return {
    provider: NAME,
    timezone: fc.city.name || '',
    utcOffsetSeconds: offset,
    current: {
      time: localIso(cur.dt, offset),
      temp: cur.main.temp,
      feelsLike: cur.main.feels_like,
      humidity: cur.main.humidity,
      precipitation: (cur.rain && cur.rain['1h']) || 0,
      cloudCover: cur.clouds ? cur.clouds.all : null,
      pressure: cur.main.sea_level || cur.main.pressure,
      windSpeed: kmh(cur.wind.speed),
      windDirection: cur.wind.deg,
      windGust: cur.wind.gust ? kmh(cur.wind.gust) : null,
      uvIndex: null,
      visibilityKm: cur.visibility != null ? cur.visibility / 1000 : null,
      isDay,
      condition: describe(owmToWmo(cur.weather[0].id), isDay),
    },
    hourly,
    daily,
    airQuality: a
      ? {
        usAqi: OWM_AQI_TO_US[a.main.aqi] ?? null,
        europeanAqi: null,
        pm25: a.components.pm2_5,
        pm10: a.components.pm10,
        ozone: a.components.o3,
        no2: a.components.no2,
      }
      : null,
  };
}

module.exports = { createOpenWeatherMapProvider, normalize, localIso };
