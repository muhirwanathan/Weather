// Dependency-free SVG chart for the hourly forecast with hover/touch tooltips.
import { tempValue, windValue, hhmm } from './format.js';

const NS = 'http://www.w3.org/2000/svg';

const METRICS = {
  temp: { label: 'Temperature', type: 'line', value: (h, u) => tempValue(h.temp, u), fmt: (v, u) => `${Math.round(v)}°${u === 'imperial' ? 'F' : 'C'}` },
  precipProb: { label: 'Rain chance', type: 'bar', value: (h) => h.precipProb, fmt: (v) => `${Math.round(v)}%`, min: 0, max: 100 },
  windSpeed: { label: 'Wind', type: 'line', value: (h, u) => windValue(h.windSpeed, u), fmt: (v, u) => `${Math.round(v)} ${u === 'imperial' ? 'mph' : 'km/h'}`, min: 0 },
  uvIndex: { label: 'UV index', type: 'bar', value: (h) => h.uvIndex ?? 0, fmt: (v) => v.toFixed(1), min: 0 },
};

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function niceRange(values, fixedMin, fixedMax) {
  let min = fixedMin ?? Math.min(...values);
  let max = fixedMax ?? Math.max(...values);
  if (max - min < 4) { max += 2; if (fixedMin == null) min -= 2; }
  const pad = (max - min) * 0.12;
  return { min: fixedMin ?? Math.floor(min - pad), max: fixedMax ?? Math.ceil(max + pad) };
}

export function renderChart(container, hours, metricKey, units, tooltip) {
  const metric = METRICS[metricKey] || METRICS.temp;
  container.textContent = '';
  if (!hours.length) return;

  const width = Math.max(container.clientWidth, 320);
  const height = container.clientHeight || 210;
  const m = { top: 14, right: 12, bottom: 26, left: 40 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;

  const values = hours.map((hr) => metric.value(hr, units));
  const { min, max } = niceRange(values, metric.min, metric.max);
  const step = w / hours.length;
  const x = (i) => m.left + step * i + step / 2;
  const y = (v) => m.top + h - ((v - min) / (max - min || 1)) * h;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' }, container);
  const defs = el('defs', {}, svg);
  const grad = el('linearGradient', { id: 'chart-fill', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': 0.35 }, grad);
  el('stop', { offset: '100%', 'stop-color': '#fff', 'stop-opacity': 0 }, grad);

  // Grid + y labels
  const grid = el('g', { class: 'grid' }, svg);
  const axis = el('g', { class: 'axis' }, svg);
  for (let i = 0; i <= 4; i += 1) {
    const v = min + ((max - min) * i) / 4;
    const yy = y(v);
    el('line', { x1: m.left, x2: width - m.right, y1: yy, y2: yy }, grid);
    const t = el('text', { x: m.left - 8, y: yy + 4, 'text-anchor': 'end' }, axis);
    t.textContent = metricKey === 'uvIndex' ? Math.round(v) : metric.fmt(v, units).replace(/ (km\/h|mph)$/, '');
  }
  // X labels every 3 hours
  hours.forEach((hr, i) => {
    if (i % 3 !== 0) return;
    const t = el('text', { x: x(i), y: height - 6, 'text-anchor': 'middle' }, axis);
    t.textContent = i === 0 ? 'Now' : hhmm(hr.time);
  });

  if (metric.type === 'bar') {
    const bw = Math.max(step * 0.62, 2);
    values.forEach((v, i) => {
      const yy = y(v);
      el('rect', { class: 'bar', x: x(i) - bw / 2, y: yy, width: bw, height: Math.max(m.top + h - yy, 0), rx: 2 }, svg);
    });
  } else {
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    el('path', { class: 'area', d: `M${x(0)},${m.top + h} L${pts.join(' L')} L${x(values.length - 1)},${m.top + h} Z` }, svg);
    el('path', { class: 'line', d: `M${pts.join(' L')}` }, svg);
  }

  // Hover / touch interaction
  const cursor = el('line', { class: 'cursor', y1: m.top, y2: m.top + h, visibility: 'hidden' }, svg);
  const dot = el('circle', { class: 'dot', r: 5, visibility: 'hidden' }, svg);
  const overlay = el('rect', { x: m.left, y: 0, width: w, height, fill: 'transparent' }, svg);

  function show(evt) {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * width;
    const i = Math.min(hours.length - 1, Math.max(0, Math.floor((px - m.left) / step)));
    const cx = x(i);
    const cy = y(values[i]);
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    tooltip.textContent = `${i === 0 ? 'Now' : hhmm(hours[i].time)} · ${metric.fmt(values[i], units)} · ${hours[i].condition.label}`;
    tooltip.hidden = false;
    tooltip.style.left = `${rect.left + (cx / width) * rect.width}px`;
    tooltip.style.top = `${rect.top + (cy / height) * rect.height}px`;
  }
  function hide() {
    cursor.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  }
  overlay.addEventListener('pointermove', show);
  overlay.addEventListener('pointerdown', show);
  overlay.addEventListener('pointerleave', hide);

  const peak = values.indexOf(Math.max(...values));
  container.setAttribute('aria-label', `${metric.label} for the next ${hours.length} hours. ` +
    `Ranges from ${metric.fmt(Math.min(...values), units)} to ${metric.fmt(values[peak], units)}, peaking at ${hhmm(hours[peak].time)}.`);
}
