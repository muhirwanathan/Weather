// Thin client for our own backend. The browser never talks to third-party
// weather APIs directly, so no API key can leak to the client.

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const listeners = new Set();
/** Subscribe to the X-Served-By header (shows which backend answered). */
export function onServedBy(fn) { listeners.add(fn); }

export async function apiGet(path, params = {}, { timeoutMs = 15000, signal } = {}) {
  const url = `${path}?${new URLSearchParams(params)}`;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal && AbortSignal.any ? AbortSignal.any([signal, timeout]) : (signal || timeout);

  if (!navigator.onLine) {
    throw new ApiError('You appear to be offline. Check your internet connection.', { code: 'OFFLINE' });
  }

  let res;
  try {
    res = await fetch(url, { signal: combined, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError' && signal && signal.aborted) throw err; // superseded request
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new ApiError('The server took too long to respond. Please try again.', { code: 'TIMEOUT' });
    }
    throw new ApiError('Could not reach the WeatherGlass server. Check your connection and try again.');
  }

  const servedBy = res.headers.get('X-Served-By');
  if (servedBy) listeners.forEach((fn) => fn(servedBy));

  let body = null;
  try {
    body = await res.json();
  } catch {
    // fall through: handled below
  }

  if (!res.ok) {
    const fallback = {
      429: 'Too many requests. Please wait a minute and try again.',
      503: 'Weather data is temporarily unavailable. Please try again shortly.',
    }[res.status] || `Unexpected server error (HTTP ${res.status}).`;
    throw new ApiError(body && body.error ? body.error.message : fallback, {
      status: res.status,
      code: body && body.error ? body.error.code : 'HTTP_ERROR',
    });
  }
  if (!body) throw new ApiError('The server sent an unreadable response.', { status: res.status, code: 'BAD_RESPONSE' });
  return body;
}
