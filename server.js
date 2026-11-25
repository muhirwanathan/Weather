'use strict';
/**
 * Entry point. Wires configuration, providers, cache and the HTTP app together
 * and handles graceful shutdown (needed for zero-downtime rolling deploys).
 */
const config = require('./src/config');
const { createApp } = require('./src/app');
const { TtlCache } = require('./src/cache');
const { createWeatherService } = require('./src/weatherService');
const { createOpenMeteoProvider } = require('./src/providers/openMeteo');
const { createOpenWeatherMapProvider } = require('./src/providers/openWeatherMap');

function buildProviders() {
  const openMeteo = createOpenMeteoProvider({ timeoutMs: config.upstreamTimeoutMs });
  const providers = [openMeteo];
  if (config.openWeatherApiKey) {
    const owm = createOpenWeatherMapProvider({ apiKey: config.openWeatherApiKey, timeoutMs: config.upstreamTimeoutMs });
    if (config.primaryProvider === 'openweathermap') providers.unshift(owm);
    else providers.push(owm);
  } else {
    console.warn('[startup] OPENWEATHER_API_KEY not set: running without a failover provider.');
  }
  return providers;
}

const service = createWeatherService({
  providers: buildProviders(),
  cache: new TtlCache({ maxEntries: config.cacheMaxEntries }),
  weatherTtlMs: config.weatherTtlMs,
  geocodeTtlMs: config.geocodeTtlMs,
});

const app = createApp({
  service,
  serverName: config.serverName,
  trustProxy: config.trustProxy,
  rateLimitPerMinute: config.rateLimitPerMinute,
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[startup] WeatherGlass on http://${config.host}:${config.port} as "${config.serverName}" ` +
    `(providers: ${service.providerNames.join(' -> ')})`);
});

function shutdown(signal) {
  console.log(`[shutdown] ${signal} received, finishing in-flight requests...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
