'use strict';
const { ValidationError } = require('./errors');

const NUMBER_RE = /^-?\d{1,3}(\.\d{1,8})?$/;
// Letters from any alphabet, combining marks, digits, spaces and . , ' ’ - ( )
const PLACE_RE = /^[\p{L}\p{M}\p{N}\s.,'’()-]+$/u;
const MAX_COMPARE_POINTS = 10;

function parseNumber(raw, name, min, max) {
  if (typeof raw !== 'string' || !NUMBER_RE.test(raw.trim())) {
    throw new ValidationError(`"${name}" must be a decimal number.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(`"${name}" must be between ${min} and ${max}.`);
  }
  return value;
}

function parseCoordinates(lat, lon) {
  return {
    lat: parseNumber(lat, 'lat', -90, 90),
    lon: parseNumber(lon, 'lon', -180, 180),
  };
}

function parsePlaceQuery(raw) {
  if (typeof raw !== 'string') throw new ValidationError('Search text is required.');
  const q = raw.trim().replace(/\s+/g, ' ');
  if (q.length < 2) throw new ValidationError('Type at least 2 characters to search.');
  if (q.length > 80) throw new ValidationError('Search text must be 80 characters or fewer.');
  if (!PLACE_RE.test(q)) throw new ValidationError('Search text contains unsupported characters.');
  return q;
}

/** Parses "lat,lon|lat,lon|..." used by the compare endpoint. */
function parsePoints(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new ValidationError('"points" is required.');
  const parts = raw.split('|').filter(Boolean);
  if (parts.length === 0) throw new ValidationError('"points" is required.');
  if (parts.length > MAX_COMPARE_POINTS) {
    throw new ValidationError(`You can compare at most ${MAX_COMPARE_POINTS} places at once.`);
  }
  return parts.map((part) => {
    const pieces = part.split(',');
    if (pieces.length !== 2) throw new ValidationError('Each point must look like "lat,lon".');
    return parseCoordinates(pieces[0], pieces[1]);
  });
}

module.exports = { parseCoordinates, parsePlaceQuery, parsePoints, MAX_COMPARE_POINTS };
