'use strict';

/**
 * Small in-memory TTL cache with LRU eviction and request coalescing.
 *
 * - Expired entries are not deleted straight away: they stay as a "stale"
 *   copy that can be served if every upstream provider is down.
 * - Concurrent requests for the same key share one upstream call.
 */
class TtlCache {
  constructor({ maxEntries = 1000, now = () => Date.now() } = {}) {
    this.maxEntries = maxEntries;
    this.now = now;
    this.store = new Map();
    this.inflight = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      this.misses += 1;
      return undefined;
    }
    // Move to the end so it is evicted last (LRU).
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  /** Returns the last stored value even if it has expired. */
  getStale(key) {
    const entry = this.store.get(key);
    return entry ? { value: entry.value, storedAt: entry.storedAt } : undefined;
  }

  set(key, value, ttlMs) {
    const now = this.now();
    this.store.delete(key);
    this.store.set(key, { value, storedAt: now, expiresAt: now + ttlMs });
    while (this.store.size > this.maxEntries) {
      this.store.delete(this.store.keys().next().value);
    }
  }

  /** Get from cache, or run `loader` once (even under concurrency) and cache the result. */
  async wrap(key, ttlMs, loader) {
    const hit = this.get(key);
    if (hit !== undefined) return { value: hit, cached: true };
    if (this.inflight.has(key)) return { value: await this.inflight.get(key), cached: false };

    const promise = (async () => {
      try {
        const value = await loader();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return { value: await promise, cached: false };
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? Math.round((this.hits / total) * 100) / 100 : 0,
    };
  }
}

module.exports = { TtlCache };
