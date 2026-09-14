'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const { query, withTransaction } = require('../config/database');
const { uuid, nextSequentialCode, roleCodePrefix } = require('../utils/ids');
const { AppError } = require('../utils/response');
const audit = require('./auditService');
const { sqlLimit } = require('../utils/pagination');

function hashRefresh(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccess(user, sessionId) {
  return jwt.sign(
    { sub: user.id, role: user.role, sid: sessionId },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtl }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    userCode: user.user_code,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: user.role,
    status: user.status,
  };
}

async function login({ username, password, ip, userAgent, requestId }) {
  const rows = await query(
    `SELECT * FROM users WHERE username = ? LIMIT 1`,
    [String(username || '').trim().toLowerCase()]
  );
  const user = rows[0];
  if (!user) {
    await audit.write({
      requestId,
      action: 'USER_LOGIN_FAILED',
      description: 'Login failed: unknown username',
      metadata: { username },
      ipAddress: ip,
      userAgent,
    });
    throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password.', 401);
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    await audit.write({
      requestId,
      actorUserId: user.id,
      actorRole: user.role,
      action: 'USER_LOGIN_FAILED',
      entityType: 'user',
      entityId: user.id,
      description: 'Login failed: bad password',
      ipAddress: ip,
      userAgent,
    });
    throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password.', 401);
  }

  if (user.status !== 'active') {
    throw new AppError('ACCOUNT_DISABLED', 'Account is not active.', 403);
  }

  const sessionId = uuid();
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const expires = new Date(Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO user_sessions (id, user_id, refresh_token_hash, ip_address, user_agent, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [sessionId, user.id, hashRefresh(refreshToken), ip, userAgent, expires]
  );
  await query(
    `UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?`,
    [ip, user.id]
  );

  await audit.write({
    requestId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'USER_LOGIN',
    entityType: 'user',
    entityId: user.id,
    description: `${user.username} signed in`,
    ipAddress: ip,
    userAgent,
  });

  return {
    user: publicUser(user),
    accessToken: signAccess(user, sessionId),
    refreshToken,
    expiresAt: expires.toISOString(),
  };
}

async function refresh({ refreshToken, ip, userAgent, requestId }) {
  if (!refreshToken) {
    throw new AppError('UNAUTHENTICATED', 'Refresh token required.', 401);
  }
  const tokenHash = hashRefresh(refreshToken);
  const sessions = await query(
    `SELECT s.*, u.id AS uid, u.role, u.status, u.username, u.email, u.first_name, u.last_name, u.user_code
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.refresh_token_hash = ? LIMIT 1`,
    [tokenHash]
  );
  const session = sessions[0];
  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
    throw new AppError('UNAUTHENTICATED', 'Refresh token is invalid or expired.', 401);
  }
  if (session.status !== 'active') {
    throw new AppError('ACCOUNT_DISABLED', 'Account is not active.', 403);
  }

  const newRefresh = crypto.randomBytes(48).toString('hex');
  await query(
    `UPDATE user_sessions
     SET refresh_token_hash = ?, last_used_at = NOW(), ip_address = ?, user_agent = ?
     WHERE id = ?`,
    [hashRefresh(newRefresh), ip, userAgent, session.id]
  );

  const user = {
    id: session.uid,
    role: session.role,
    username: session.username,
    email: session.email,
    first_name: session.first_name,
    last_name: session.last_name,
    user_code: session.user_code,
    status: session.status,
  };

  return {
    user: publicUser(user),
    accessToken: signAccess(user, session.id),
    refreshToken: newRefresh,
  };
}

async function logout({ sessionId, user, ip, userAgent, requestId }) {
  if (sessionId) {
    await query(`UPDATE user_sessions SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL`, [sessionId]);
  }
  if (user) {
    await audit.write({
      requestId,
      actorUserId: user.id,
      actorRole: user.role,
      action: 'USER_LOGOUT',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ip,
      userAgent,
    });
  }
}

async function nextUserCode(role) {
  const prefix = roleCodePrefix(role);
  const rows = await query(`SELECT user_code FROM users WHERE user_code LIKE ?`, [`${prefix}-%`]);
  return nextSequentialCode(rows.map((row) => row.user_code), prefix);
}

async function assignSequentialUserCodes() {
  for (const role of ['admin', 'agent']) {
    const prefix = roleCodePrefix(role);
    const users = await query(
      `SELECT id FROM users WHERE role = ? ORDER BY created_at ASC, email ASC`,
      [role]
    );
    for (const user of users) {
      await query(`UPDATE users SET user_code = ? WHERE id = ?`, [`TMP-${user.id}`, user.id]);
    }
    let n = 1;
    for (const user of users) {
      await query(`UPDATE users SET user_code = ? WHERE id = ?`, [`${prefix}-${n}`, user.id]);
      n += 1;
    }
  }
}

async function createUser({ actor, payload, ip, userAgent, requestId }) {
  const username = String(payload.username || '').trim().toLowerCase();

  if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
    throw new AppError(
      'INVALID_USERNAME',
      'Username must be 2-32 characters and contain only letters, numbers, dot, underscore or hyphen.',
      400
    );
  }

  const existing = await query(
    `SELECT id FROM users WHERE username = ?`,
    [username]
  );

  if (existing.length) {
    throw new AppError(
      'USERNAME_IN_USE',
      'Username is already in use.',
      409
    );
  }

  // Email is retained internally only because the current DB schema
  // requires a unique non-null email. It is NOT a login credential.
  const email = `${username}@dialpure.local`;
  const id = uuid();
  const hash = await bcrypt.hash(payload.password, 12);
  const role = payload.role === 'admin' ? 'admin' : 'agent';
  let code = await nextUserCode(role);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await query(
        `INSERT INTO users (id, user_code, username, first_name, last_name, email, password_hash, role, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
          id,
          code,
          username,
          payload.firstName.trim(),
          payload.lastName.trim(),
          email,
          hash,
          role,
          actor.id,
        ]
      );
      break;
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY' || attempt === 7) throw error;
      code = await nextUserCode(role);
    }
  }
  await audit.write({
    requestId,
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'USER_CREATED',
    entityType: 'user',
    entityId: id,
    description: `Created ${role} ${username}`,
    newValues: { username, role },
    ipAddress: ip,
    userAgent,
  });
  const rows = await query(`SELECT * FROM users WHERE id = ?`, [id]);
  return publicUser(rows[0]);
}

async function listUsers({ role, status, search, pagination }) {
  const where = [];
  const params = [];
  if (role) {
    where.push('role = ?');
    params.push(role);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(first_name LIKE ? OR last_name LIKE ? OR username LIKE ? OR email LIKE ? OR user_code LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await query(`SELECT COUNT(*) AS total FROM users ${clause}`, params);
  const items = await query(
    `SELECT id, user_code, username, first_name, last_name, email, role, status, last_login_at, last_login_ip, created_at
     FROM users ${clause}
     ORDER BY created_at DESC
     ${sqlLimit(pagination)}`,
    params
  );
  return { items, total: count[0].total };
}

async function updateUser({ actor, id, payload, ip, userAgent, requestId }) {
  const rows = await query(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!rows.length) throw new AppError('USER_NOT_FOUND', 'User not found.', 404);
  const user = rows[0];
  const fields = [];
  const params = [];
  const oldValues = {};
  const newValues = {};

  if (payload.username !== undefined) {
    payload.username = String(payload.username).trim().toLowerCase();

    if (!/^[a-z0-9._-]{2,32}$/.test(payload.username)) {
      throw new AppError(
        'INVALID_USERNAME',
        'Username must be 2-32 characters and contain only letters, numbers, dot, underscore or hyphen.',
        400
      );
    }

    const duplicateUsername = await query(
      `SELECT id FROM users WHERE username = ? AND id <> ?`,
      [payload.username, id]
    );

    if (duplicateUsername.length) {
      throw new AppError(
        'USERNAME_IN_USE',
        'Username is already in use.',
        409
      );
    }
  }

  for (const [key, column] of [
    ['firstName', 'first_name'],
    ['lastName', 'last_name'],
    ['username', 'username'],
    ['status', 'status'],
    ['role', 'role'],
  ]) {
    if (payload[key] !== undefined) {
      oldValues[column] = user[column];
      newValues[column] = payload[key];
      fields.push(`${column} = ?`);
      params.push(payload[key]);
    }
  }
  if (payload.role && payload.role !== user.role) {
    const nextRole = payload.role === 'admin' ? 'admin' : 'agent';
    const code = await nextUserCode(nextRole);
    fields.push('user_code = ?');
    params.push(code);
    oldValues.user_code = user.user_code;
    newValues.user_code = code;
  }
  if (payload.password) {
    fields.push('password_hash = ?');
    params.push(await bcrypt.hash(payload.password, 12));
    newValues.password = 'updated';
  }
  if (!fields.length) return publicUser(user);
  params.push(id);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);

  const action = payload.status && payload.status !== 'active' ? 'USER_DISABLED' : 'USER_UPDATED';
  await audit.write({
    requestId,
    actorUserId: actor.id,
    actorRole: actor.role,
    action,
    entityType: 'user',
    entityId: id,
    oldValues,
    newValues,
    ipAddress: ip,
    userAgent,
  });

  if (payload.status && payload.status !== 'active') {
    await query(`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`, [id]);
  }

  const updated = await query(`SELECT * FROM users WHERE id = ?`, [id]);
  return publicUser(updated[0]);
}

async function getById(id) {
  const rows = await query(
    `SELECT id, user_code, username, first_name, last_name, email, role, status, last_login_at, last_login_ip, created_at
     FROM users WHERE id = ?`,
    [id]
  );
  if (!rows.length) throw new AppError('USER_NOT_FOUND', 'User not found.', 404);
  return rows[0];
}


async function getUserCampaignAccess(id) {
  const users = await query(
    `SELECT id, username, role
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [id]
  );

  if (!users.length) {
    throw new AppError('USER_NOT_FOUND', 'User not found.', 404);
  }

  const user = users[0];

  const campaigns = await query(
    `SELECT
       c.id,
       c.campaign_code,
       c.name,
       c.status,
       CASE
         WHEN aca.id IS NOT NULL AND aca.is_active = 1 THEN 1
         ELSE 0
       END AS has_access
     FROM campaigns c
     LEFT JOIN agent_campaign_access aca
       ON aca.campaign_id = c.id
      AND aca.agent_id = ?
     WHERE c.status <> 'archived'
     ORDER BY c.name ASC`,
    [id]
  );

  return {
    user,
    campaigns,
    campaignIds: campaigns
      .filter((c) => Number(c.has_access) === 1)
      .map((c) => c.id),
  };
}

async function syncUserCampaignAccess({
  actor,
  id,
  campaignIds,
  ip,
  userAgent,
  requestId,
}) {
  const users = await query(
    `SELECT id, username, role
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [id]
  );

  if (!users.length) {
    throw new AppError('USER_NOT_FOUND', 'User not found.', 404);
  }

  const target = users[0];

  if (target.username === 'admin') {
    throw new AppError(
      'SYSTEM_ADMIN_ACCESS',
      'System Admin always has access to all campaigns.',
      400
    );
  }

  const selected = Array.from(
    new Set(
      (Array.isArray(campaignIds) ? campaignIds : [])
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    )
  );

  if (selected.length) {
    const placeholders = selected.map(() => '?').join(',');

    const valid = await query(
      `SELECT id
       FROM campaigns
       WHERE id IN (${placeholders})
         AND status <> 'archived'`,
      selected
    );

    if (valid.length !== selected.length) {
      throw new AppError(
        'INVALID_CAMPAIGN',
        'One or more selected campaigns are invalid.',
        400
      );
    }
  }

  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE agent_campaign_access
       SET is_active = 0,
           revoked_at = NOW()
       WHERE agent_id = ?`,
      [id]
    );

    for (const campaignId of selected) {
      await conn.execute(
        `INSERT INTO agent_campaign_access (
           id,
           campaign_id,
           agent_id,
           assigned_by,
           assigned_at,
           revoked_at,
           is_active
         )
         VALUES (?, ?, ?, ?, NOW(), NULL, 1)
         ON DUPLICATE KEY UPDATE
           is_active = 1,
           revoked_at = NULL,
           assigned_by = VALUES(assigned_by),
           assigned_at = NOW()`,
        [uuid(), campaignId, id, actor.id]
      );
    }
  });

  await audit.write({
    requestId,
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'USER_CAMPAIGN_ACCESS_UPDATED',
    entityType: 'user',
    entityId: id,
    description: `Updated campaign access for ${target.username}`,
    metadata: { campaignIds: selected },
    ipAddress: ip,
    userAgent,
  });

  return getUserCampaignAccess(id);
}

module.exports = {
  login,
  refresh,
  logout,
  createUser,
  listUsers,
  updateUser,
  getById,
  getUserCampaignAccess,
  syncUserCampaignAccess,
  publicUser,
  withTransaction,
  assignSequentialUserCodes,
};
