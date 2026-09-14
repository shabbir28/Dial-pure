'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');

let io;

function init(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('UNAUTHENTICATED'));
    try {
      const payload = jwt.verify(token, config.jwt.accessSecret);
      socket.userId = payload.sub;
      socket.userRole = payload.role;
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);
    socket.on('job:subscribe', (jobId) => {
      if (jobId) socket.join(`job:${jobId}`);
    });
    socket.on('job:unsubscribe', (jobId) => {
      if (jobId) socket.leave(`job:${jobId}`);
    });
  });

  return io;
}

function emitJobProgress(jobId, payload) {
  if (!io) return;
  io.to(`job:${jobId}`).emit('job:progress', { jobId, ...payload });
  io.emit('dashboard:update', { jobId, ...payload });
}

function getIo() {
  return io;
}

module.exports = { init, emitJobProgress, getIo };
