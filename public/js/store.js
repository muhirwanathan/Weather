// Persists user preferences in localStorage. Every access is wrapped because
// storage can be disabled (private mode) or full.

const KEY = 'weatherglass:v1';
const MAX_SNAPSHOTS = 12;

const DEFAULT_CITIES = [
  { name: 'Kigali', region: 'Kigali', country: 'Rwanda', lat: -1.95, lon: 30.06 },
  { name: 'Nairobi', region: 'Nairobi County', country: 'Kenya', lat: -1.29, lon: 36.82 },
  { name: 'Lagos', region: 'Lagos', country: 'Nigeria', lat: 6.45, lon: 3.39 },
  { name: 'London', region: 'England', country: 'United Kingdom', lat: 51.51, lon: -0.13 },
  { name: 'New York', region: 'New York', country: 'United States', lat: 40.71, lon: -74.01 },
  { name: 'Tokyo', region: 'Tokyo', country: 'Japan', lat: 35.69, lon: 139.69 },
];

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: drop offline snapshots and try once more.
    state.snapshots = {};
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* give up silently */ }
  }
}

export const placeKey = (p) => `${Number(p.lat).toFixed(2)},${Number(p.lon).toFixed(2)}`;

export const store = {
  get units() { return state.units === 'imperial' ? 'imperial' : 'metric'; },
  set units(v) { state.units = v; save(); },

  get cities() { return Array.isArray(state.cities) ? state.cities : DEFAULT_CITIES.slice(); },
  isSaved(p) { return this.cities.some((c) => placeKey(c) === placeKey(p)); },
  addCity(p) {
    if (this.isSaved(p)) return;
    state.cities = [...this.cities, { name: p.name, region: p.region || '', country: p.country || '', lat: p.lat, lon: p.lon }].slice(0, 10);
    save();
  },
  removeCity(p) {
    state.cities = this.cities.filter((c) => placeKey(c) !== placeKey(p));
    save();
  },

  get lastPlace() { return state.lastPlace || this.cities[0] || DEFAULT_CITIES[0]; },
  set lastPlace(p) { state.lastPlace = p; save(); },

  get sort() { return state.sort || { key: 'name', dir: 'asc' }; },
  set sort(v) { state.sort = v; save(); },

  /** Offline fallback: keep the last good forecast for recently viewed places. */
  saveSnapshot(p, data) {
    const snaps = state.snapshots || {};
    snaps[placeKey(p)] = { data, savedAt: new Date().toISOString() };
    const keys = Object.keys(snaps);
    if (keys.length > MAX_SNAPSHOTS) {
      keys.sort((a, b) => snaps[a].savedAt.localeCompare(snaps[b].savedAt));
      keys.slice(0, keys.length - MAX_SNAPSHOTS).forEach((k) => delete snaps[k]);
    }
    state.snapshots = snaps;
    save();
  },
  getSnapshot(p) { return (state.snapshots || {})[placeKey(p)] || null; },
};
