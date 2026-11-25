'use strict';
/**
 * Integration tests: the real Express app + weather service, with fake
 * providers instead of the internet. Covers validation, caching, failover,
 * stale-if-error and security headers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createWeatherService } = require('../src/weatherService');
const { TtlCache } = require('../src/cache');
const { UpstreamError } = require('../src/errors');
const { sampleForecast } = require('./fixtures');

const silent = { warn() {}, error() {}, log() {} };

function fakeProvider(name, { fail = false } = {}) {
  const p = {
    name,
    fail,
    calls: 0,
    async forecast() {
      p.calls += 1;
      if (p.fail) throw new UpstreamError(`${name} down`, { provider: name });
      return sampleForecast({ provider: name });
    },
    async geocode(q) {
      p.calls += 1;
      if (p.fail) throw new UpstreamError(`${name} down`, { provider: name });
      return q.toLowerCase() === 'nowhereville' ? [] : [{ name: 'Kigali', region: 'Kigali', country: 'Rwanda', countryCode: 'RW', lat: -1.95, lon: 30.06 }];
    },
  };
  return p;
}

async function startServer({ providers, now } = {}) {
  const primary = fakeProvider('Fake-Primary');
  const backup = fakeProvider('Fake-Backup');
  const list = providers || [primary, backup];
  let clock = 0;
  const cache = new TtlCache({ now: now || (() => clock) });
  const service = createWeatherService({ providers: list, cache, weatherTtlMs: 1000, logger: silent });
  const app = createApp({ service, serverName: 'test-01', rateLimitPerMinute: 1000, logger: silent });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    primary,
    backup,
    advance: (ms) => { clock += ms; },
    close: () => new Promise((r) => server.close(r)),
  };
}

test('GET /api/health reports server name and providers', async (t) => {
  const s = await startServer();
  t.after(s.close);
  const res = await fetch(`${s.base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-served-by'), 'test-01');
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.deepEqual(body.providers, ['Fake-Primary', 'Fake-Backup']);
});

test('GET /api/weather validates input', async (t) => {
  const s = await startServer();
  t.after(s.close);
  for (const qs of ['', '?lat=abc&lon=1', '?lat=100&lon=1', '?lat=1']) {
    const res = await fetch(`${s.base}/api/weather${qs}`);
    assert.equal(res.status, 400, qs);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_INPUT');
  }
});

test('GET /api/weather returns forecast with insights and caches it', async (t) => {
  const s = await startServer();
  t.after(s.close);
  const first = await (await fetch(`${s.base}/api/weather?lat=-1.9501&lon=30.0588`)).json();
  assert.equal(first.provider, 'Fake-Primary');
  assert.equal(first.cached, false);
  assert.equal(first.fallback, false);
  assert.ok(first.insights.activities.length >= 4);
  assert.deepEqual(first.location, { lat: -1.95, lon: 30.06 });

  // A nearby point rounds to the same cache key.
  const second = await (await fetch(`${s.base}/api/weather?lat=-1.9499&lon=30.0601`)).json();
  assert.equal(second.cached, true);
  assert.equal(s.primary.calls, 1);
});

test('failover: uses backup provider when primary fails', async (t) => {
  const s = await startServer();
  t.after(s.close);
  s.primary.fail = true;
  const body = await (await fetch(`${s.base}/api/weather?lat=10&lon=10`)).json();
  assert.equal(body.provider, 'Fake-Backup');
  assert.equal(body.fallback, true);
});

test('stale-if-error: serves expired copy when all providers fail', async (t) => {
  const s = await startServer();
  t.after(s.close);
  await fetch(`${s.base}/api/weather?lat=5&lon=5`);
  s.advance(5000); // past the 1 s TTL
  s.primary.fail = true;
  s.backup.fail = true;
  const res = await fetch(`${s.base}/api/weather?lat=5&lon=5`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.stale, true);
});

test('503 with friendly message when all providers fail and nothing is cached', async (t) => {
  const s = await startServer();
  t.after(s.close);
  s.primary.fail = true;
  s.backup.fail = true;
  const res = await fetch(`${s.base}/api/weather?lat=7&lon=7`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error.code, 'UPSTREAM_UNAVAILABLE');
  assert.match(body.error.message, /temporarily unavailable/);
  assert.doesNotMatch(JSON.stringify(body), /Fake-Primary down/, 'internal details are not leaked');
});

test('GET /api/geocode validates and returns results', async (t) => {
  const s = await startServer();
  t.after(s.close);
  assert.equal((await fetch(`${s.base}/api/geocode?q=%3Cscript%3E`)).status, 400);
  const ok = await (await fetch(`${s.base}/api/geocode?q=Kigali`)).json();
  assert.equal(ok.results[0].country, 'Rwanda');
  const none = await (await fetch(`${s.base}/api/geocode?q=Nowhereville`)).json();
  assert.deepEqual(none.results, []);
});

test('GET /api/compare returns one row per point, isolating failures', async (t) => {
  const s = await startServer();
  t.after(s.close);
  const body = await (await fetch(`${s.base}/api/compare?points=${encodeURIComponent('1,1|2,2')}`)).json();
  assert.equal(body.results.length, 2);
  assert.ok(body.results.every((r) => r.ok && typeof r.temp === 'number'));
  assert.equal((await fetch(`${s.base}/api/compare?points=bad`)).status, 400);
});

test('security headers and unknown API routes', async (t) => {
  const s = await startServer();
  t.after(s.close);
  const res = await fetch(`${s.base}/`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  const missing = await fetch(`${s.base}/api/does-not-exist`);
  assert.equal(missing.status, 404);
});
