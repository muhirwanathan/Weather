'use strict';
const { UpstreamError } = require('./errors');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Network errors / timeouts (status null), rate limiting and server errors are worth retrying. */
function isRetryable(status) {
  return status === null || status === 429 || status >= 500;
}

/**
 * GET a JSON document with a hard timeout and a small retry budget.
 * Always rejects with an UpstreamError so callers only handle one error type.
 */
async function fetchJson(url, { provider = 'upstream', timeoutMs = 6000, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'User-Agent': 'WeatherGlass/2.0' },
      });
    } catch (err) {
      const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
      lastError = new UpstreamError(timedOut ? `${provider} timed out` : `${provider} is unreachable`, { provider });
    }

    if (res) {
      if (res.ok) {
        try {
          return await res.json();
        } catch {
          // A malformed body will not fix itself on retry.
          throw new UpstreamError(`${provider} returned an invalid response`, { status: res.status, provider });
        }
      }
      lastError = new UpstreamError(`${provider} responded with HTTP ${res.status}`, { status: res.status, provider });
      if (!isRetryable(res.status)) throw lastError;
    }

    if (attempt < retries) await sleep(250 * (attempt + 1));
  }
  throw lastError;
}

module.exports = { fetchJson };
