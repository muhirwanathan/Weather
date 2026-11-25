// Unit conversion and date formatting. The API always returns metric values;
// conversion happens here so one cached response serves every user.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function temp(c, units, withUnit = false) {
  if (c == null || Number.isNaN(c)) return '–';
  const v = units === 'imperial' ? c * 9 / 5 + 32 : c;
  return `${Math.round(v)}°${withUnit ? (units === 'imperial' ? 'F' : 'C') : ''}`;
}

export function tempValue(c, units) {
  return units === 'imperial' ? c * 9 / 5 + 32 : c;
}

export function wind(kmh, units) {
  if (kmh == null) return '–';
  return units === 'imperial' ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`;
}

export function windValue(kmh, units) {
  return units === 'imperial' ? kmh * 0.621371 : kmh;
}

export function distance(km, units) {
  if (km == null) return '–';
  return units === 'imperial' ? `${(km * 0.621371).toFixed(1)} mi` : `${km.toFixed(1)} km`;
}

export function precip(mm, units) {
  if (mm == null) return '–';
  return units === 'imperial' ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`;
}

export function compass(deg) {
  if (deg == null) return '';
  return COMPASS[Math.round(deg / 22.5) % 16];
}

// Times from the API are local to the place ("2026-11-25T14:00"), so we read
// them as plain strings and never convert through the browser's time zone.
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : '–');

export function dayName(dateStr, index) {
  if (index === 0) return 'Today';
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  return DAYS[d.getUTCDay()];
}

export function longDate(iso) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function placeLabel(p) {
  return [p.region && p.region !== p.name ? p.region : '', p.country].filter(Boolean).join(', ');
}

export function aqiLevel(aqi) {
  if (aqi == null) return null;
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'sensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very-unhealthy';
  return 'hazardous';
}

export function timeAgo(isoUtc) {
  const mins = Math.round((Date.now() - new Date(isoUtc).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : `${Math.round(hrs / 24)} d ago`;
}
