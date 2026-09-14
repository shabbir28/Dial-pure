'use strict';

require('dotenv').config();
const http = require('http');
const config = require('./config');
const { createApp } = require('./app');
const { init } = require('./socket');
const { initQueues } = require('./queues');
const storage = require('./services/storageService');

async function start() {
  await storage.ensureDir(config.storage.dir);
  const app = createApp();
  const server = http.createServer(app);
  init(server);
  const { query } = require('./config/database');
  await query('SET GLOBAL innodb_buffer_pool_size = 2147483648').catch(() => {});
  await initQueues();

  const uploadWindowMs = 30 * 60 * 1000;
  server.timeout = uploadWindowMs;
  server.headersTimeout = uploadWindowMs + 10 * 1000;
  server.requestTimeout = uploadWindowMs;

  server.listen(config.port, () => {
    console.log(`DialPure API listening on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
