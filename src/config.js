'use strict';
/**
 * Central configuration. Every value can be overridden through environment
 * variables (see .env.example). Secrets are only ever read here, on the server,
 * and are never sent to the browser.
 */
require('dotenv').config({ quiet: true });
const os = require('os');

function int(name, fallback) {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = Object.freeze({
  port: int('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  // Name shown in the X-Served-By header / footer so load balancing is visible.
  serverName: process.env.SERVER_NAME || os.hostname(),
  // Number of reverse proxies in front of Node (nginx = 1, HAProxy + nginx = 2).
  trustProxy: int('TRUST_PROXY', 1),
  openWeatherApiKey: (process.env.OPENWEATHER_API_KEY || '').trim(),
  primaryProvider: (process.env.PRIMARY_PROVIDER || 'open-meteo').toLowerCase(),
  weatherTtlMs: int('WEATHER_CACHE_TTL_SECONDS', 600) * 1000,
  geocodeTtlMs: int('GEOCODE_CACHE_TTL_SECONDS', 86400) * 1000,
  cacheMaxEntries: int('CACHE_MAX_ENTRIES', 1000),
  upstreamTimeoutMs: int('UPSTREAM_TIMEOUT_MS', 6000),
  rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 120),
});
