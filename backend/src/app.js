'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { requestId } = require('./middleware/requestId');
const { apiLimiter } = require('./middleware/rateLimit');
const { errorHandler } = require('./middleware/errorHandler');
const routes = require('./routes');
const { ping } = require('./config/database');

function allowedOrigins() {
  return String(config.corsOrigin || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function health(req, res) {
  const db = await ping().catch(() => false);
  res.json({
    success: true,
    data: { ok: true, database: !!db },
    requestId: req.requestId,
  });
}

function mountApi(app, prefix) {
  const api = routes();
  if (prefix) {
    app.use(prefix, apiLimiter);
    app.get(`${prefix}/health`, health);
    app.use(prefix, api);
    return;
  }
  app.use(apiLimiter);
  app.get('/health', health);
  app.use(api);
}

function createApp() {
  const app = express();
  app.set('env', config.env);
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, callback) {
        const allowed = allowedOrigins();
        if (!origin || allowed.includes(origin) || allowed.includes('*')) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(requestId);

  mountApi(app, '/api');
  // Staging nginx `proxy_pass ...:4000/;` strips `/api`, so login arrives as `/auth/login`.
  mountApi(app, '');

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
      requestId: req.requestId,
    });
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
