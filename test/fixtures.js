'use strict';
const { describe } = require('../src/conditions');

/** Builds a normalized forecast (the shape providers return) for tests. */
function sampleForecast({ rainAt = null, provider = 'Fake-Primary' } = {}) {
  const hourly = [];
  for (let i = 0; i < 48; i += 1) {
    const hour = (8 + i) % 24;
    const isDay = hour >= 6 && hour < 18;
    const rainy = rainAt !== null && i === rainAt;
    hourly.push({
      time: `2026-11-${String(25 + Math.floor((8 + i) / 24)).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`,
      temp: 18,
      feelsLike: 17,
      humidity: 55,
      precipProb: rainy ? 80 : 5,
      precip: rainy ? 2 : 0,
      windSpeed: 8,
      uvIndex: isDay ? 4 : 0,
      isDay,
      condition: describe(rainy ? 63 : 1, isDay),
    });
  }
  return {
    provider,
    timezone: 'Africa/Kigali',
    utcOffsetSeconds: 7200,
    current: {
      time: '2026-11-25T08:10',
      temp: 18,
      feelsLike: 17,
      humidity: 55,
      precipitation: 0,
      cloudCover: 20,
      pressure: 1015,
      windSpeed: 8,
      windDirection: 90,
      windGust: 14,
      uvIndex: 4,
      visibilityKm: 20,
      isDay: true,
      condition: describe(1, true),
    },
    hourly,
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${25 + i}`,
      max: 24,
      min: 14,
      sunrise: `2026-11-${25 + i}T05:50`,
      sunset: `2026-11-${25 + i}T18:05`,
      uvMax: 7,
      precipSum: 0,
      precipProbMax: 10,
      windMax: 15,
      condition: describe(1, true),
    })),
    airQuality: { usAqi: 42, europeanAqi: 20, pm25: 8, pm10: 12, ozone: 40, no2: 5 },
  };
}

module.exports = { sampleForecast };
