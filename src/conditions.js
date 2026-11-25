'use strict';
/**
 * Weather condition vocabulary. Internally everything uses WMO weather
 * interpretation codes (the format Open-Meteo returns). OpenWeatherMap
 * condition IDs are mapped onto the same codes so the frontend never needs to
 * know which provider answered.
 *
 * group: used for filtering, backgrounds and icons.
 */
const WMO = {
  0: ['Clear sky', 'clear'],
  1: ['Mainly clear', 'partly'],
  2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'rain'],
  53: ['Drizzle', 'rain'],
  55: ['Heavy drizzle', 'rain'],
  56: ['Freezing drizzle', 'rain'],
  57: ['Heavy freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Heavy freezing rain', 'rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'],
  81: ['Showers', 'rain'],
  82: ['Violent showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'],
  96: ['Thunderstorm with hail', 'storm'],
  99: ['Severe thunderstorm', 'storm'],
};

function describe(code, isDay = true) {
  const [label, group] = WMO[code] || ['Unknown', 'cloudy'];
  const dayPart = isDay ? 'day' : 'night';
  const icon = group === 'clear' || group === 'partly' ? `${group}-${dayPart}` : group;
  return { code: Number(code), label, group, icon };
}

/** Maps an OpenWeatherMap condition id (https://openweathermap.org/weather-conditions) to a WMO code. */
function owmToWmo(id) {
  if (id >= 200 && id < 300) return 95;
  if (id >= 300 && id < 400) return 53;
  if (id === 500) return 61;
  if (id === 501) return 63;
  if (id >= 502 && id <= 504) return 65;
  if (id === 511) return 66;
  if (id >= 520 && id < 600) return 81;
  if (id === 600) return 71;
  if (id === 601) return 73;
  if (id === 602) return 75;
  if (id >= 611 && id <= 616) return 77;
  if (id >= 620 && id < 700) return 85;
  if (id >= 700 && id < 800) return 45;
  if (id === 800) return 0;
  if (id === 801) return 1;
  if (id === 802) return 2;
  return 3;
}

module.exports = { describe, owmToWmo, GROUPS: ['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow', 'storm'] };
