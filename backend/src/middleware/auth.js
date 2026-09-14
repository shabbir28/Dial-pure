'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../config/database');
const { fail } = require('../utils/response');

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return fail(res, 'UNAUTHENTICATED', 'Authentication required.', 401);
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.accessSecret);
    } catch {
      return fail(res, 'TOKEN_EXPIRED', 'Access token is invalid or expired.', 401);
    }

    const users = await query(
      `SELECT id, user_code, first_name, last_name, email, role, status
       FROM users WHERE id = ? LIMIT 1`,
      [payload.sub]
    );
    const user = users[0];
    if (!user) {
      return fail(res, 'UNAUTHENTICATED', 'User not found.', 401);
    }
    if (user.status !== 'active') {
      return fail(res, 'ACCOUNT_DISABLED', 'Account is not active.', 403);
    }

    req.user = user;
    req.sessionId = payload.sid;
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return fail(res, 'FORBIDDEN', 'You do not have permission to perform this action.', 403);
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
