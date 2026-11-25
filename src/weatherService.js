'use strict';
/**
 * Weather service: the single place that talks to providers.
 *
 * Reliability features:
 *  1. Cache: responses are cached (10 min weather, 24 h geocoding).
 *     Coordinates are rounded to ~1 km so nearby lookups share entries.
 *  2. Request coalescing: 50 users asking for the same city at once trigger
 *     one upstream call.
 *  3. Provider failover: if the primary provider fails, the next one is tried.
 *  4. Stale-if-error: if every provider fails, the last good copy is served
 *     and flagged `stale: true` so the UI can tell the user.
 */
const { TtlCache } = require('./cache');
const { buildInsights } = require('./insights');
const { ServiceUnavailableError } = require('./errors');

function createWeatherService({ providers, cache = new TtlCache(), weatherTtlMs = 600000, geocodeTtlMs = 86400000, logger = console }) {
  if (!providers || providers.length === 0) throw new Error('At least one provider is required');

  async function withFailover(method, args) {
    const failures = [];
    for (const provider of providers) {
      try {
        const value = await provider[method](...args);
        return { value, provider: provider.name, fallback: provider !== providers[0] };
      } catch (err) {
        failures.push(`${provider.name}: ${err.message}`);
        logger.warn(`[weather] ${method} failed on ${provider.name}: ${err.message}`);
      }
    }
    throw new ServiceUnavailableError('Weather data is temporarily unavailable. Please try again in a moment.', failures);
  }

  async function cachedWithStale(key, ttlMs, loader) {
    try {
      const { value, cached } = await cache.wrap(key, ttlMs, loader);
      return { ...value, cached, stale: false };
    } catch (err) {
      const stale = cache.getStale(key);
      if (stale) {
        logger.warn(`[weather] serving stale data for ${key}`);
        return { ...stale.value, cached: true, stale: true };
      }
      throw err;
    }
  }

  async function geocode(query) {
    const key = `geo:${query.toLowerCase()}`;
    const result = await cachedWithStale(key, geocodeTtlMs, async () => {
      const { value, provider } = await withFailover('geocode', [query]);
      return { results: value, provider };
    });
    return result;
  }

  async function getWeather(lat, lon) {
    const rLat = Math.round(lat * 100) / 100;
    const rLon = Math.round(lon * 100) / 100;
    const key = `wx:${rLat},${rLon}`;
    return cachedWithStale(key, weatherTtlMs, async () => {
      const { value, fallback } = await withFailover('forecast', [rLat, rLon]);
      const data = { ...value, location: { lat: rLat, lon: rLon }, fallback, fetchedAt: new Date().toISOString() };
      data.insights = buildInsights(data);
      return data;
    });
  }

  /** Slim summaries for the comparison table. One failing city does not fail the batch. */
  async function compare(points) {
    const settled = await Promise.allSettled(points.map((p) => getWeather(p.lat, p.lon)));
    return settled.map((s, i) => {
      if (s.status === 'rejected') return { ...points[i], ok: false, error: s.reason.message };
      const d = s.value;
      const today = d.daily[0] || {};
      return {
        ...points[i],
        ok: true,
        stale: d.stale,
        time: d.current.time,
        temp: d.current.temp,
        feelsLike: d.current.feelsLike,
        humidity: d.current.humidity,
        windSpeed: d.current.windSpeed,
        condition: d.current.condition,
        max: today.max,
        min: today.min,
        precipProbMax: today.precipProbMax,
        usAqi: d.airQuality ? d.airQuality.usAqi : null,
      };
    });
  }

  return { geocode, getWeather, compare, cacheStats: () => cache.stats(), providerNames: providers.map((p) => p.name) };
}

module.exports = { createWeatherService };
