// WeatherGlass frontend controller.
// All dynamic text is inserted with textContent (never innerHTML) to rule out XSS.
import { apiGet, ApiError, onServedBy } from './api.js';
import { store, placeKey } from './store.js';
import { renderChart } from './chart.js';
import * as fmt from './format.js';

const $ = (sel) => document.querySelector(sel);

const ui = {
  main: $('#main'),
  searchForm: $('#search-form'),
  searchInput: $('#search-input'),
  searchResults: $('#search-results'),
  searchHint: $('#search-hint'),
  locateBtn: $('#locate-btn'),
  unitBtns: document.querySelectorAll('[data-units]'),
  banner: $('#banner'),
  bannerText: $('#banner-text'),
  bannerRetry: $('#banner-retry'),
  bannerClose: $('#banner-close'),
  placeName: $('#place-name'),
  placeMeta: $('#place-meta'),
  saveBtn: $('#save-btn'),
  heroIcon: $('#hero-icon'),
  heroTemp: $('#hero-temp'),
  heroCond: $('#hero-cond'),
  heroRange: $('#hero-range'),
  heroSummary: $('#hero-summary'),
  heroBadges: $('#hero-badges'),
  plannerList: $('#planner-list'),
  tabs: document.querySelectorAll('[data-metric]'),
  chart: $('#chart'),
  hourlyStrip: $('#hourly-strip'),
  dailyList: $('#daily-list'),
  detailsGrid: $('#details-grid'),
  compareFilter: $('#compare-filter'),
  compareCondition: $('#compare-condition'),
  compareRefresh: $('#compare-refresh'),
  compareBody: $('#compare-body'),
  compareEmpty: $('#compare-empty'),
  sortHeaders: document.querySelectorAll('[data-sort]'),
  servedBy: $('#served-by'),
  owmCredit: $('#owm-credit'),
  tooltip: $('#tooltip'),
};

const state = {
  place: store.lastPlace,
  weather: null,
  metric: 'temp',
  compareRows: [],
  searchResults: [],
  activeResult: -1,
  weatherController: null,
  searchController: null,
  retry: null,
};

// ---------- small DOM helpers ----------
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'title' || k === 'type') node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

function setIcon(svg, name, label) {
  svg.querySelector('use').setAttribute('href', `#i-${name}`);
  if (label) svg.setAttribute('aria-label', label);
}

// ---------- banner / errors ----------
function showBanner(message, { retry = null, info = false } = {}) {
  ui.bannerText.textContent = message;
  ui.banner.classList.toggle('info', info);
  ui.bannerRetry.hidden = !retry;
  state.retry = retry;
  ui.banner.hidden = false;
}
function hideBanner() { ui.banner.hidden = true; state.retry = null; }

ui.bannerRetry.addEventListener('click', () => { const fn = state.retry; hideBanner(); if (fn) fn(); });
ui.bannerClose.addEventListener('click', hideBanner);

onServedBy((name) => { ui.servedBy.textContent = name; });

// ---------- current weather ----------
async function loadWeather(place) {
  state.place = place;
  store.lastPlace = place;
  if (state.weatherController) state.weatherController.abort();
  const controller = new AbortController();
  state.weatherController = controller;
  ui.main.setAttribute('aria-busy', 'true');
  renderPlaceHeader();

  try {
    const data = await apiGet('/api/weather', { lat: place.lat, lon: place.lon }, { signal: controller.signal });
    if (controller.signal.aborted) return;
    state.weather = data;
    store.saveSnapshot(place, data);
    hideBanner();
    renderWeather();
    if (data.stale) {
      showBanner('Live weather sources are not responding. Showing the most recent saved forecast.', { info: true, retry: () => loadWeather(place) });
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    const snap = store.getSnapshot(place);
    if (snap) {
      state.weather = { ...snap.data, offlineCopy: snap.savedAt };
      renderWeather();
      showBanner(`${err.message} Showing your saved copy from ${fmt.timeAgo(snap.savedAt)}.`, { info: true, retry: () => loadWeather(place) });
    } else {
      showBanner(err.message, { retry: () => loadWeather(place) });
      renderWeatherError(err);
    }
  } finally {
    if (state.weatherController === controller) ui.main.setAttribute('aria-busy', 'false');
  }
}

function renderPlaceHeader() {
  const p = state.place;
  ui.placeName.textContent = p.name;
  ui.placeMeta.textContent = fmt.placeLabel(p) || `${Number(p.lat).toFixed(2)}, ${Number(p.lon).toFixed(2)}`;
  const saved = store.isSaved(p);
  ui.saveBtn.setAttribute('aria-pressed', String(saved));
  const label = saved ? 'Remove from my cities' : 'Save to my cities';
  ui.saveBtn.title = label;
  ui.saveBtn.setAttribute('aria-label', label);
}

function renderWeatherError(err) {
  ui.heroTemp.textContent = '--';
  ui.heroCond.textContent = err instanceof ApiError && err.code === 'OFFLINE' ? 'Offline' : 'Unavailable';
  ui.heroRange.textContent = '';
  ui.heroSummary.textContent = 'We could not load the forecast for this place.';
  ui.heroBadges.textContent = '';
  ui.plannerList.textContent = '';
  ui.hourlyStrip.textContent = '';
  ui.dailyList.textContent = '';
  ui.detailsGrid.textContent = '';
  ui.chart.textContent = '';
}

function renderWeather() {
  const d = state.weather;
  if (!d) return;
  const units = store.units;
  const c = d.current;
  const today = d.daily[0] || {};

  document.body.className = `sky-${c.condition.group}-${c.isDay ? 'day' : 'night'}`;
  renderPlaceHeader();
  ui.placeMeta.textContent = `${ui.placeMeta.textContent} · ${fmt.longDate(c.time)}, ${fmt.hhmm(c.time)} local`;

  setIcon(ui.heroIcon, c.condition.icon, c.condition.label);
  ui.heroTemp.textContent = fmt.temp(c.temp, units);
  ui.heroCond.textContent = c.condition.label;
  ui.heroRange.textContent = `H ${fmt.temp(today.max, units)}  L ${fmt.temp(today.min, units)}  ·  Feels like ${fmt.temp(c.feelsLike, units)}`;
  ui.heroSummary.textContent = d.insights ? d.insights.summary : '';

  ui.heroBadges.textContent = '';
  const badges = [[`Source: ${d.provider}`, false]];
  if (d.fallback) badges.push(['Backup provider in use', true]);
  if (d.offlineCopy) badges.push([`Offline copy · ${fmt.timeAgo(d.offlineCopy)}`, true]);
  else if (d.stale) badges.push(['Stale data', true]);
  else badges.push([`Updated ${fmt.timeAgo(d.fetchedAt)}${d.cached ? ' · cached' : ''}`, false]);
  for (const [text, warn] of badges) ui.heroBadges.append(h('span', { class: `badge${warn ? ' warn' : ''}`, text }));
  ui.owmCredit.hidden = d.provider !== 'OpenWeatherMap';

  renderPlanner(d.insights);
  renderHourly();
  renderDaily();
  renderDetails();
  highlightCompareRow();
}

function renderPlanner(insights) {
  ui.plannerList.textContent = '';
  if (!insights) return;
  for (const a of insights.activities) {
    ui.plannerList.append(
      h('li', { class: `plan ${a.status}` },
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        h('div', {},
          h('div', { class: 'title', text: a.title }),
          h('div', { class: 'headline', text: a.headline }),
          h('div', { class: 'plan-detail', text: a.detail }),
          h('span', { class: 'visually-hidden', text: `Status: ${a.status}` }))),
    );
  }
}

function renderHourly() {
  const units = store.units;
  const hours = state.weather.hourly.slice(0, 24);
  const hasUv = hours.some((hr) => hr.uvIndex != null);
  ui.tabs.forEach((t) => {
    if (t.dataset.metric === 'uvIndex') t.hidden = !hasUv;
    t.setAttribute('aria-selected', String(t.dataset.metric === state.metric));
  });
  if (state.metric === 'uvIndex' && !hasUv) state.metric = 'temp';
  renderChart(ui.chart, hours, state.metric, units, ui.tooltip);

  ui.hourlyStrip.textContent = '';
  hours.forEach((hr, i) => {
    ui.hourlyStrip.append(
      h('li', { class: `hour${i === 0 ? ' now' : ''}` },
        h('div', { class: 'h', text: i === 0 ? 'Now' : fmt.hhmm(hr.time) }),
        icon(hr.condition.icon),
        h('div', { class: 't', text: fmt.temp(hr.temp, units) }),
        h('div', { class: 'p', text: hr.precipProb >= 10 ? `${hr.precipProb}%` : '' })),
    );
  });
}

function renderDaily() {
  const units = store.units;
  const days = state.weather.daily;
  const lo = Math.min(...days.map((d) => d.min));
  const hi = Math.max(...days.map((d) => d.max));
  const span = hi - lo || 1;
  ui.dailyList.textContent = '';

  days.forEach((day, i) => {
    const bar = h('span');
    bar.style.left = `${((day.min - lo) / span) * 100}%`;
    bar.style.right = `${100 - ((day.max - lo) / span) * 100}%`;
    const detailId = `day-detail-${i}`;
    const row = h('button', { class: 'day-row', type: 'button', 'aria-expanded': 'false', 'aria-controls': detailId },
      h('span', { text: fmt.dayName(day.date, i) }),
      icon(day.condition.icon),
      h('span', { class: 'rain', text: day.precipProbMax >= 10 ? `${day.precipProbMax}%` : '' }),
      h('span', { class: 'lo', text: fmt.temp(day.min, units) }),
      h('span', { class: 'range', 'aria-hidden': 'true' }, bar),
      h('span', { class: 'hi', text: fmt.temp(day.max, units) }));
    row.setAttribute('aria-label', `${fmt.dayName(day.date, i)}: ${day.condition.label}, low ${fmt.temp(day.min, units)}, high ${fmt.temp(day.max, units)}, ${day.precipProbMax}% chance of rain`);

    const detail = h('div', { class: 'day-detail', id: detailId, hidden: true });
    const items = [
      ['Conditions', day.condition.label],
      ['Rain', `${fmt.precip(day.precipSum, units)} · ${day.precipProbMax}%`],
      ['Max wind', fmt.wind(day.windMax, units)],
      ['Sunrise', fmt.hhmm(day.sunrise)],
      ['Sunset', fmt.hhmm(day.sunset)],
    ];
    if (day.uvMax != null) items.push(['UV max', day.uvMax.toFixed(1)]);
    for (const [label, value] of items) detail.append(h('div', {}, label, h('b', { text: value })));

    row.addEventListener('click', () => {
      const open = row.getAttribute('aria-expanded') === 'true';
      row.setAttribute('aria-expanded', String(!open));
      detail.hidden = open;
    });
    ui.dailyList.append(h('li', { class: 'day' }, row, detail));
  });
}

function detailCard(label, value, sub, extra) {
  const v = h('div', { class: 'value' });
  if (extra) v.append(extra);
  v.append(value);
  return h('div', { class: 'detail' }, h('div', { class: 'label', text: label }), v, sub ? h('div', { class: 'sub', text: sub }) : null);
}

function renderDetails() {
  const units = store.units;
  const d = state.weather;
  const c = d.current;
  const today = d.daily[0] || {};
  const grid = ui.detailsGrid;
  grid.textContent = '';

  const arrow = icon('arrow', 'arrow');
  // Wind direction is where wind comes FROM; the arrow points where it blows TO.
  arrow.style.transform = `rotate(${(c.windDirection + 180) % 360}deg)`;
  grid.append(detailCard('Wind', fmt.wind(c.windSpeed, units), `${fmt.compass(c.windDirection)}${c.windGust ? ` · gusts ${fmt.wind(c.windGust, units)}` : ''}`, arrow));
  grid.append(detailCard('Humidity', `${Math.round(c.humidity)}%`, c.humidity > 75 ? 'Feels muggy' : c.humidity < 30 ? 'Dry air' : 'Comfortable'));
  grid.append(detailCard('Feels like', fmt.temp(c.feelsLike, units), Math.abs(c.feelsLike - c.temp) < 2 ? 'Similar to actual' : c.feelsLike < c.temp ? 'Cooler than actual' : 'Warmer than actual'));
  if (c.uvIndex != null) grid.append(detailCard('UV index', c.uvIndex.toFixed(1), d.insights ? d.insights.uvCategory : ''));
  grid.append(detailCard('Pressure', `${Math.round(c.pressure)} hPa`, c.pressure < 1005 ? 'Low: unsettled' : c.pressure > 1020 ? 'High: settled' : 'Normal'));
  if (c.visibilityKm != null) grid.append(detailCard('Visibility', fmt.distance(c.visibilityKm, units), c.visibilityKm < 2 ? 'Poor' : c.visibilityKm < 8 ? 'Moderate' : 'Clear'));
  grid.append(detailCard('Cloud cover', c.cloudCover == null ? '–' : `${Math.round(c.cloudCover)}%`, `Precip now: ${fmt.precip(c.precipitation, units)}`));
  grid.append(detailCard('Sun', `${fmt.hhmm(today.sunrise)}`, `Sunset ${fmt.hhmm(today.sunset)}`));

  if (d.airQuality && d.airQuality.usAqi != null) {
    const aqi = Math.round(d.airQuality.usAqi);
    const meter = h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i'));
    meter.firstChild.style.left = `calc(${Math.min(aqi / 300, 1) * 100}% - 2px)`;
    const card = detailCard('Air quality (US AQI)', String(aqi), d.insights && d.insights.airQuality ? d.insights.airQuality.label : '');
    if (d.airQuality.pm25 != null) card.append(h('div', { class: 'sub', text: `PM2.5 ${d.airQuality.pm25.toFixed(1)} µg/m³` }));
    card.append(meter);
    grid.append(card);
  }
}

// ---------- search with autocomplete ----------
let searchTimer;
ui.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = ui.searchInput.value.trim();
  ui.searchHint.textContent = '';
  if (q.length < 2) { closeResults(); return; }
  searchTimer = setTimeout(() => runSearch(q), 300);
});

ui.searchInput.addEventListener('keydown', (e) => {
  const n = state.searchResults.length;
  if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActiveResult((state.activeResult + 1) % n); }
  else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActiveResult((state.activeResult - 1 + n) % n); }
  else if (e.key === 'Escape') closeResults();
});

ui.searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.activeResult >= 0 && state.searchResults[state.activeResult]) {
    choosePlace(state.searchResults[state.activeResult]);
    return;
  }
  const q = ui.searchInput.value.trim();
  if (q.length < 2) { ui.searchHint.textContent = 'Type at least 2 characters to search.'; return; }
  const results = await runSearch(q);
  if (results && results.length) choosePlace(results[0]);
});

document.addEventListener('click', (e) => {
  if (!ui.searchForm.contains(e.target)) closeResults();
});

async function runSearch(q) {
  if (state.searchController) state.searchController.abort();
  const controller = new AbortController();
  state.searchController = controller;
  try {
    const data = await apiGet('/api/geocode', { q }, { signal: controller.signal, timeoutMs: 10000 });
    if (controller.signal.aborted) return null;
    state.searchResults = data.results;
    renderResults(q);
    return data.results;
  } catch (err) {
    if (err.name === 'AbortError') return null;
    closeResults();
    ui.searchHint.textContent = err.message;
    return null;
  }
}

function renderResults(q) {
  ui.searchResults.textContent = '';
  state.activeResult = -1;
  if (!state.searchResults.length) {
    ui.searchResults.append(h('li', { class: 'empty-row', text: `No places match "${q}". Check the spelling or try a nearby city.` }));
  }
  state.searchResults.forEach((r, i) => {
    const li = h('li', { role: 'option', id: `result-${i}`, 'aria-selected': 'false' },
      h('span', { text: r.name }),
      h('span', { class: 'sub', text: fmt.placeLabel(r) }));
    li.addEventListener('mousedown', (e) => { e.preventDefault(); choosePlace(r); });
    ui.searchResults.append(li);
  });
  ui.searchResults.hidden = false;
  ui.searchInput.setAttribute('aria-expanded', 'true');
}

function setActiveResult(i) {
  state.activeResult = i;
  [...ui.searchResults.children].forEach((li, idx) => li.setAttribute('aria-selected', String(idx === i)));
  ui.searchInput.setAttribute('aria-activedescendant', `result-${i}`);
  const active = ui.searchResults.children[i];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function closeResults() {
  ui.searchResults.hidden = true;
  ui.searchInput.setAttribute('aria-expanded', 'false');
  ui.searchInput.removeAttribute('aria-activedescendant');
  state.activeResult = -1;
}

function choosePlace(r) {
  closeResults();
  ui.searchInput.value = '';
  ui.searchInput.blur();
  loadWeather({ name: r.name, region: r.region, country: r.country, lat: r.lat, lon: r.lon });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- geolocation ----------
ui.locateBtn.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    showBanner('Your browser does not support location access. Search for your city instead.');
    return;
  }
  if (!window.isSecureContext) {
    showBanner('Location access needs a secure (HTTPS) connection. Search for your city instead.', { info: true });
    return;
  }
  ui.locateBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      ui.locateBtn.disabled = false;
      loadWeather({ name: 'My location', region: '', country: '', lat: Number(pos.coords.latitude.toFixed(4)), lon: Number(pos.coords.longitude.toFixed(4)) });
    },
    (err) => {
      ui.locateBtn.disabled = false;
      const msg = err.code === err.PERMISSION_DENIED ? 'Location permission was denied. Search for your city instead.' : 'Could not determine your location. Search for your city instead.';
      showBanner(msg, { info: true });
    },
    { timeout: 10000, maximumAge: 600000 },
  );
});

// ---------- units ----------
function syncUnitButtons() {
  ui.unitBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.units === store.units)));
}
ui.unitBtns.forEach((b) => b.addEventListener('click', () => {
  store.units = b.dataset.units;
  syncUnitButtons();
  renderWeather();
  renderCompare();
}));

// ---------- chart tabs ----------
ui.tabs.forEach((t) => t.addEventListener('click', () => {
  state.metric = t.dataset.metric;
  if (state.weather) renderHourly();
}));

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.weather) renderChart(ui.chart, state.weather.hourly.slice(0, 24), state.metric, store.units, ui.tooltip); }, 150);
});

// ---------- save / compare ----------
ui.saveBtn.addEventListener('click', () => {
  if (store.isSaved(state.place)) store.removeCity(state.place);
  else store.addCity(state.place);
  renderPlaceHeader();
  loadCompare();
});

async function loadCompare() {
  const cities = store.cities;
  if (!cities.length) {
    state.compareRows = [];
    renderCompare();
    return;
  }
  ui.compareRefresh.disabled = true;
  try {
    const points = cities.map((c) => `${c.lat},${c.lon}`).join('|');
    const data = await apiGet('/api/compare', { points });
    state.compareRows = data.results.map((r, i) => ({ ...r, ...cities[i] }));
  } catch (err) {
    state.compareRows = cities.map((c) => ({ ...c, ok: false, error: err.message }));
  } finally {
    ui.compareRefresh.disabled = false;
  }
  renderCompare();
}

const sortValue = {
  name: (r) => r.name.toLowerCase(),
  condition: (r) => (r.condition ? r.condition.label : ''),
  max: (r) => r.max,
};

function renderCompare() {
  const units = store.units;
  const text = ui.compareFilter.value.trim().toLowerCase();
  const cond = ui.compareCondition.value;
  const { key, dir } = store.sort;

  ui.sortHeaders.forEach((b) => {
    b.parentElement.setAttribute('aria-sort', b.dataset.sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });

  let rows = state.compareRows.filter((r) => {
    const matchesText = !text || `${r.name} ${r.region} ${r.country}`.toLowerCase().includes(text);
    const matchesCond = !cond || (r.ok && r.condition.group === cond);
    return matchesText && matchesCond;
  });

  const getter = sortValue[key] || ((r) => r[key]);
  rows = rows.slice().sort((a, b) => {
    // Failed rows always sink to the bottom.
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    const va = getter(a);
    const vb = getter(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return dir === 'asc' ? cmp : -cmp;
  });

  ui.compareBody.textContent = '';
  for (const r of rows) {
    const remove = h('button', { class: 'remove-btn', type: 'button', title: `Remove ${r.name}`, 'aria-label': `Remove ${r.name}`, text: '×' });
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      store.removeCity(r);
      state.compareRows = state.compareRows.filter((x) => placeKey(x) !== placeKey(r));
      renderCompare();
      renderPlaceHeader();
    });

    const cityCell = h('td', { class: 'city' }, r.name, h('small', { text: fmt.placeLabel(r) }));
    let cells;
    if (!r.ok) {
      cells = [cityCell, h('td', { class: 'err', colSpan: 7, text: r.error || 'Unavailable' })];
    } else {
      const level = fmt.aqiLevel(r.usAqi);
      cells = [
        cityCell,
        h('td', {}, h('span', { class: 'cond' }, icon(r.condition.icon), r.condition.label)),
        h('td', { class: 'num', text: fmt.temp(r.temp, units) }),
        h('td', { class: 'num', text: `${fmt.temp(r.max, units)} / ${fmt.temp(r.min, units)}` }),
        h('td', { class: 'num', text: r.precipProbMax == null ? '–' : `${r.precipProbMax}%` }),
        h('td', { class: 'num', text: fmt.wind(r.windSpeed, units) }),
        h('td', { class: 'num', text: `${Math.round(r.humidity)}%` }),
        h('td', { class: 'num' }, level ? h('span', { class: `aqi-pill aqi-${level}`, text: String(Math.round(r.usAqi)) }) : '–'),
      ];
    }
    const tr = h('tr', { tabIndex: 0, 'data-key': placeKey(r) }, ...cells, h('td', {}, remove));
    tr.addEventListener('click', () => loadWeather(r));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadWeather(r); });
    ui.compareBody.append(tr);
  }

  const total = state.compareRows.length;
  ui.compareEmpty.hidden = rows.length > 0;
  ui.compareEmpty.textContent = total === 0
    ? 'No saved cities yet. Search for a place and tap the star to add it here.'
    : 'No cities match your filters.';
  highlightCompareRow();
}

function highlightCompareRow() {
  const key = placeKey(state.place);
  [...ui.compareBody.children].forEach((tr) => tr.classList.toggle('active', tr.dataset.key === key));
}

ui.sortHeaders.forEach((b) => b.addEventListener('click', () => {
  const current = store.sort;
  const dir = current.key === b.dataset.sort && current.dir === 'asc' ? 'desc' : 'asc';
  store.sort = { key: b.dataset.sort, dir };
  renderCompare();
}));
ui.compareFilter.addEventListener('input', renderCompare);
ui.compareCondition.addEventListener('change', renderCompare);
ui.compareRefresh.addEventListener('click', loadCompare);

// ---------- connectivity ----------
window.addEventListener('offline', () => showBanner('You are offline. Showing the last data loaded.', { info: true }));
window.addEventListener('online', () => { hideBanner(); loadWeather(state.place); loadCompare(); });

// Refresh every 10 minutes while the tab is visible.
setInterval(() => { if (document.visibilityState === 'visible') loadWeather(state.place); }, 10 * 60 * 1000);

// ---------- boot ----------
syncUnitButtons();
loadWeather(state.place);
loadCompare();
