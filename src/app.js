'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
const { parseCoordinates, parsePlaceQuery, parsePoints } = require('./validate');

/**
 * Builds the Express application. The weather service is injected so tests
 * can run the real HTTP stack against fake providers.
 */
function createApp({ service, serverName = 'local', trustProxy = 1, rateLimitPerMinute = 120, logger = console }) {
  const app = express();
  const startedAt = Date.now();

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  // Lets you see which backend answered when testing the load balancer.
  app.use((req, res, next) => {
    res.set('X-Served-By', serverName);
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // The servers may be reached over plain HTTP, so do not force HTTPS here.
        upgradeInsecureRequests: null,
      },
    },
  }));
  app.use(compression());

  const api = express.Router();
  api.use(rateLimit({
    windowMs: 60 * 1000,
    limit: rateLimitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute and try again.' } },
  }));

  api.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      server: serverName,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      providers: service.providerNames,
      cache: service.cacheStats(),
    });
  });

  api.get('/geocode', async (req, res, next) => {
    try {
      const q = parsePlaceQuery(req.query.q);
      const data = await service.geocode(q);
      res.set('Cache-Control', 'public, max-age=3600');
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  api.get('/weather', async (req, res, next) => {
    try {
      const { lat, lon } = parseCoordinates(req.query.lat, req.query.lon);
      const data = await service.getWeather(lat, lon);
      res.set('Cache-Control', 'private, max-age=120');
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  api.get('/compare', async (req, res, next) => {
    try {
      const points = parsePoints(req.query.points);
      const results = await service.compare(points);
      res.set('Cache-Control', 'private, max-age=120');
      res.json({ results });
    } catch (err) {
      next(err);
    }
  });

  api.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API endpoint.' } });
  });

  app.use('/api', api);

  app.use(express.static(path.join(__dirname, '..', 'public'), {
    index: 'index.html',
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // Central error handler: never leak stack traces to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    const code = err.name === 'ValidationError' ? 'INVALID_INPUT'
      : err.name === 'ServiceUnavailableError' ? 'UPSTREAM_UNAVAILABLE' : 'INTERNAL_ERROR';
    if (status >= 500) logger.error(`[api] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
    res.status(status).json({
      error: {
        code,
        message: status === 500 ? 'Something went wrong on our side. Please try again.' : err.message,
      },
    });
  });

  return app;
}

module.exports = { createApp };
