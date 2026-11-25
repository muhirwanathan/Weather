'use strict';
/**
 * Turns raw forecast numbers into decisions people actually make:
 * "Do I need an umbrella?", "When should I go for a run?", "Can I dry laundry
 * outside?", "What should I wear?". Works on the normalized (metric) data so it
 * is provider-independent and easy to unit test.
 */

function aqiCategory(usAqi) {
  if (usAqi == null) return null;
  if (usAqi <= 50) return { level: 'good', label: 'Good', advice: 'Air quality is great for outdoor activity.' };
  if (usAqi <= 100) return { level: 'moderate', label: 'Moderate', advice: 'Acceptable; unusually sensitive people should limit long exertion.' };
  if (usAqi <= 150) return { level: 'sensitive', label: 'Unhealthy for sensitive groups', advice: 'Children, older adults and people with asthma should reduce outdoor exertion.' };
  if (usAqi <= 200) return { level: 'unhealthy', label: 'Unhealthy', advice: 'Everyone should reduce prolonged outdoor exertion.' };
  if (usAqi <= 300) return { level: 'very-unhealthy', label: 'Very unhealthy', advice: 'Avoid outdoor exertion; keep windows closed.' };
  return { level: 'hazardous', label: 'Hazardous', advice: 'Stay indoors.' };
}

function uvCategory(uv) {
  if (uv == null) return null;
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very high';
  return 'Extreme';
}

const hourLabel = (iso) => iso.slice(11, 16);

/** Score 0-100 for how pleasant an hour is for outdoor exercise. */
function exerciseScore(h) {
  let score = 100;
  const t = h.feelsLike;
  if (t < 10) score -= (10 - t) * 4;
  if (t > 22) score -= (t - 22) * 5;
  score -= h.precipProb * 0.8;
  if (h.windSpeed > 20) score -= (h.windSpeed - 20) * 2;
  if (h.uvIndex > 6) score -= (h.uvIndex - 6) * 8;
  if (!h.isDay) score -= 25;
  if (h.condition.group === 'storm') score -= 60;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function umbrellaAdvice(hours) {
  const next = hours.slice(0, 12);
  if (!next.length) return null;
  const peak = next.reduce((a, b) => (b.precipProb > a.precipProb ? b : a));
  const storm = next.find((h) => h.condition.group === 'storm');
  if (storm) {
    return { id: 'umbrella', title: 'Umbrella', status: 'bad', headline: 'Storms expected', detail: `Thunderstorms possible around ${hourLabel(storm.time)}. Plan to be indoors.` };
  }
  if (peak.precipProb >= 50) {
    return { id: 'umbrella', title: 'Umbrella', status: 'bad', headline: 'Take an umbrella', detail: `${peak.precipProb}% chance of rain around ${hourLabel(peak.time)}.` };
  }
  if (peak.precipProb >= 20) {
    return { id: 'umbrella', title: 'Umbrella', status: 'caution', headline: 'Maybe pack one', detail: `Up to ${peak.precipProb}% chance of rain in the next 12 hours.` };
  }
  return { id: 'umbrella', title: 'Umbrella', status: 'good', headline: 'Leave it at home', detail: 'Rain is unlikely for the next 12 hours.' };
}

function sunscreenAdvice(hours) {
  // Only look ahead: this morning's peak is irrelevant at 9 pm.
  const values = hours.slice(0, 12).map((h) => h.uvIndex).filter((v) => v != null);
  if (!values.length) return null; // provider has no UV data
  const uvMax = Math.max(...values);
  if (uvMax < 1) {
    return { id: 'sunscreen', title: 'Sun protection', status: 'good', headline: 'Not needed', detail: 'UV stays negligible for the next 12 hours.' };
  }
  const label = uvCategory(uvMax);
  if (uvMax >= 6) {
    return { id: 'sunscreen', title: 'Sun protection', status: 'bad', headline: 'Sunscreen essential', detail: `UV peaks at ${uvMax.toFixed(1)} (${label}). Use SPF 30+, a hat, and seek shade at midday.` };
  }
  if (uvMax >= 3) {
    return { id: 'sunscreen', title: 'Sun protection', status: 'caution', headline: 'Sunscreen recommended', detail: `UV peaks at ${uvMax.toFixed(1)} (${label}).` };
  }
  return { id: 'sunscreen', title: 'Sun protection', status: 'good', headline: 'Low UV', detail: `UV peaks at ${uvMax.toFixed(1)}. Minimal protection needed.` };
}

function exerciseAdvice(hours) {
  const window = hours.slice(0, 24);
  if (window.length < 2) return null;
  let best = { score: -1, index: 0 };
  for (let i = 0; i < window.length - 1; i += 1) {
    const score = Math.round((exerciseScore(window[i]) + exerciseScore(window[i + 1])) / 2);
    if (score > best.score) best = { score, index: i };
  }
  const from = hourLabel(window[best.index].time);
  const to = hourLabel(window[best.index + 1].time.replace(/T(\d\d)/, (m, hh) => `T${String((Number(hh) + 1) % 24).padStart(2, '0')}`));
  const status = best.score >= 70 ? 'good' : best.score >= 45 ? 'caution' : 'bad';
  const headline = status === 'bad' ? 'Better to train indoors' : `Best: ${from}–${to}`;
  return {
    id: 'exercise',
    title: 'Outdoor exercise',
    status,
    headline,
    detail: `Best 2-hour window in the next 24 h scores ${best.score}/100 (temperature, rain, wind, UV and daylight).`,
    score: best.score,
  };
}

function laundryAdvice(hours) {
  const daylight = hours.slice(0, 24).filter((h) => h.isDay);
  if (daylight.length < 3) {
    return { id: 'laundry', title: 'Laundry drying', status: 'bad', headline: 'Dry indoors', detail: 'Not enough daylight hours left in the next 24 hours.' };
  }
  const run = daylight.slice(0, 6);
  const maxRain = Math.max(...run.map((h) => h.precipProb));
  const avgHumidity = run.reduce((s, h) => s + h.humidity, 0) / run.length;
  if (maxRain < 20 && avgHumidity < 70) {
    return { id: 'laundry', title: 'Laundry drying', status: 'good', headline: 'Great drying weather', detail: `Dry from ${hourLabel(run[0].time)}, humidity around ${Math.round(avgHumidity)}%.` };
  }
  if (maxRain < 40 && avgHumidity < 85) {
    return { id: 'laundry', title: 'Laundry drying', status: 'caution', headline: 'Possible, keep an eye on it', detail: `Up to ${maxRain}% rain chance, humidity around ${Math.round(avgHumidity)}%.` };
  }
  return { id: 'laundry', title: 'Laundry drying', status: 'bad', headline: 'Dry indoors', detail: `Up to ${maxRain}% rain chance, humidity around ${Math.round(avgHumidity)}%.` };
}

function clothingAdvice(current) {
  const t = current.feelsLike;
  let headline;
  if (t < 0) headline = 'Heavy coat, gloves & hat';
  else if (t < 8) headline = 'Warm coat and layers';
  else if (t < 15) headline = 'Light jacket or sweater';
  else if (t < 22) headline = 'Long sleeves or a light layer';
  else if (t < 28) headline = 'T-shirt weather';
  else headline = 'Light, breathable clothing';
  const extra = current.windSpeed > 30 ? ' It is windy, so add a windproof layer.' : '';
  return { id: 'clothing', title: 'What to wear', status: 'good', headline, detail: `Feels like ${Math.round(t)}°C.${extra}` };
}

function airAdvice(airQuality) {
  const cat = airQuality ? aqiCategory(airQuality.usAqi) : null;
  if (!cat) return null;
  const status = cat.level === 'good' ? 'good' : cat.level === 'moderate' ? 'caution' : 'bad';
  return { id: 'air', title: 'Air quality', status, headline: `${cat.label} (AQI ${Math.round(airQuality.usAqi)})`, detail: cat.advice };
}

function summarize(data) {
  const { current, hourly } = data;
  const parts = [`${current.condition.label}, ${Math.round(current.temp)}°C`];
  const rainy = hourly.slice(0, 12).find((h) => h.precipProb >= 50);
  if (rainy && current.condition.group !== 'rain') parts.push(`rain likely around ${hourLabel(rainy.time)}`);
  else if (!rainy && current.condition.group === 'rain') parts.push('drying up later');
  const today = data.daily[0];
  if (today) parts.push(`high ${Math.round(today.max)}°, low ${Math.round(today.min)}°`);
  return `${parts.join('; ')}.`;
}

function buildInsights(data) {
  const activities = [
    umbrellaAdvice(data.hourly),
    exerciseAdvice(data.hourly),
    clothingAdvice(data.current),
    sunscreenAdvice(data.hourly),
    laundryAdvice(data.hourly),
    airAdvice(data.airQuality),
  ].filter(Boolean);
  return {
    summary: summarize(data),
    uvCategory: uvCategory(data.current.uvIndex),
    airQuality: data.airQuality ? aqiCategory(data.airQuality.usAqi) : null,
    activities,
  };
}

module.exports = { buildInsights, exerciseScore, aqiCategory, uvCategory };
