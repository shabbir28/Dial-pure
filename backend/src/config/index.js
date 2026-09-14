'use strict';

require('dotenv').config();
const path = require('path');

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: Number(process.env.PORT || 4000),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  corsOrigin: process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'hussain12',
    database: process.env.DB_NAME || 'campaign_scrubber',
    waitForConnections: true,
    connectionLimit: 20,
    namedPlaceholders: false,
    charset: 'utf8mb4',
    timezone: 'Z',
  },
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS || 7),
  },
  phoneHmacSecret: required('PHONE_HMAC_SECRET', 'dev-phone-hmac'),
  fieldEncryptionKey: required(
    'FIELD_ENCRYPTION_KEY',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local',
    dir: path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage'),
    bucket: process.env.AWS_S3_BUCKET || '',
    region: process.env.AWS_S3_REGION || '',
  },
  maxUploadBytes: 500 * 1024 * 1024,
};
