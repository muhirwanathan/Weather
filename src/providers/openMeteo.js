'use strict';
/**
 * Open-Meteo provider (https://open-meteo.com/en/docs). Free, no API key.
 * Uses three APIs: Geocoding, Forecast and Air Quality.
 */
const { fetchJson } = require('../http');
const { describe } = require('../conditions');
const { UpstreamError } = require('../errors');

const NAME = 'Open-Meteo';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const CURRENT_VARS = [
  'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day', 'precipitation',
  'weather_code', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
];
const HOURLY_VARS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation_probability',
  'precipitation', 'weather_code', 'wind_speed_10m', 'uv_index', 'visibility', 'is_day',
];
const DAILY_VARS = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset', 'uv_index_max',
  'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max',
];

function createOpenMeteoProvider({ timeoutMs = 6000 } = {}) {
  const opts = { provider: NAME, timeoutMs };

  async function geocode(query) {
    const url = `${GEO_URL}?${new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' })}`;
    const data = await fetchJson(url, opts);
    return (data.results || []).map((r) => ({
      name: r.name,
      region: r.admin1 || '',
      country: r.country || '',
      countryCode: r.country_code || '',
      lat: r.latitude,
      lon: r.longitude,
      timezone: r.timezone || '',
      population: r.population || null,
    }));
  }

  async function forecast(lat, lon) {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: CURRENT_VARS.join(','),
      hourly: HOURLY_VARS.join(','),
      daily: DAILY_VARS.join(','),
      timezone: 'auto',
      forecast_days: '7',
    });
    const airParams = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
      timezone: 'auto',
    });

    // Air quality is a nice-to-have: if it fails we still return the forecast.
    const [wx, air] = await Promise.allSettled([
      fetchJson(`${FORECAST_URL}?${params}`, opts),
      fetchJson(`${AIR_URL}?${airParams}`, { ...opts, retries: 0 }),
    ]);
    if (wx.status === 'rejected') throw wx.reason;
    return normalize(wx.value, air.status === 'fulfilled' ? air.value : null);
  }

  return { name: NAME, geocode, forecast };
}

function normalize(d, air) {
  if (!d || !d.current || !d.hourly || !d.daily || !Array.isArray(d.hourly.time)) {
    throw new UpstreamError(`${NAME} returned an incomplete forecast`, { provider: NAME });
  }
  const c = d.current;
  const h = d.hourly;
  const nowHour = `${String(c.time).slice(0, 13)}:00`;
  let start = h.time.indexOf(nowHour);
  if (start < 0) start = 0;

  const hourly = [];
  for (let i = start; i < Math.min(h.time.length, start + 48); i += 1) {
    const isDay = h.is_day[i] === 1;
    hourly.push({
      time: h.time[i],
      temp: h.temperature_2m[i],
      feelsLike: h.apparent_temperature[i],
      humidity: h.relative_humidity_2m[i],
      precipProb: h.precipitation_probability[i] ?? 0,
      precip: h.precipitation[i] ?? 0,
      windSpeed: h.wind_speed_10m[i],
      uvIndex: h.uv_index[i] ?? 0,
      isDay,
      condition: describe(h.weather_code[i], isDay),
    });
  }

  const dl = d.daily;
  const daily = dl.time.map((date, i) => ({
    date,
    max: dl.temperature_2m_max[i],
    min: dl.temperature_2m_min[i],
    sunrise: dl.sunrise[i],
    sunset: dl.sunset[i],
    uvMax: dl.uv_index_max[i] ?? 0,
    precipSum: dl.precipitation_sum[i] ?? 0,
    precipProbMax: dl.precipitation_probability_max[i] ?? 0,
    windMax: dl.wind_speed_10m_max[i],
    condition: describe(dl.weather_code[i], true),
  }));

  const isDay = c.is_day === 1;
  const visibilityM = h.visibility ? h.visibility[start] : null;
  return {
    provider: NAME,
    timezone: d.timezone,
    utcOffsetSeconds: d.utc_offset_seconds,
    current: {
      time: c.time,
      temp: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      precipitation: c.precipitation,
      cloudCover: c.cloud_cover,
      pressure: c.pressure_msl,
      windSpeed: c.wind_speed_10m,
      windDirection: c.wind_direction_10m,
      windGust: c.wind_gusts_10m,
      uvIndex: hourly[0] ? hourly[0].uvIndex : null,
      visibilityKm: visibilityM == null ? null : Math.round(visibilityM / 100) / 10,
      isDay,
      condition: describe(c.weather_code, isDay),
    },
    hourly,
    daily,
    airQuality: air && air.current
      ? {
        usAqi: air.current.us_aqi,
        europeanAqi: air.current.european_aqi,
        pm25: air.current.pm2_5,
        pm10: air.current.pm10,
        ozone: air.current.ozone,
        no2: air.current.nitrogen_dioxide,
      }
      : null,
  };
}

module.exports = { createOpenMeteoProvider, normalize };
