'use strict';

const { query, queryRaw } = require('../config/database');
const { uuid } = require('../utils/ids');
const { chainHash } = require('../utils/auditChain');

async function write(entry) {
  const last = await query(
    `SELECT event_hash FROM audit_logs ORDER BY id DESC LIMIT 1`
  );
  const previousEventHash = last[0]?.event_hash || null;
  const eventUuid = uuid();
  const payload = {
    eventUuid,
    requestId: entry.requestId || null,
    actorUserId: entry.actorUserId || null,
    actorRole: entry.actorRole || null,
    action: entry.action,
    entityType: entry.entityType || null,
    entityId: entry.entityId || null,
    description: entry.description || null,
    metadata: entry.metadata || null,
    createdAt: new Date().toISOString(),
  };
  const eventHash = chainHash({ previousEventHash, payload });

  await query(
    `INSERT INTO audit_logs (
      event_uuid, request_id, actor_user_id, actor_role, action, entity_type, entity_id,
      description, old_values, new_values, metadata, ip_address, user_agent,
      previous_event_hash, event_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventUuid,
      entry.requestId || null,
      entry.actorUserId || null,
      entry.actorRole || null,
      entry.action,
      entry.entityType || null,
      entry.entityId || null,
      entry.description || null,
      entry.oldValues ? JSON.stringify(entry.oldValues) : null,
      entry.newValues ? JSON.stringify(entry.newValues) : null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.ipAddress || null,
      entry.userAgent || null,
      previousEventHash,
      eventHash,
    ]
  );
}

async function list({ page, pageSize, offset, actorUserId, action, entityType, entityId, jobId }) {
  const where = [];
  const params = [];
  if (actorUserId) {
    where.push('a.actor_user_id = ?');
    params.push(actorUserId);
  }
  if (action) {
    where.push('a.action = ?');
    params.push(action);
  }
  if (entityType) {
    where.push('a.entity_type = ?');
    params.push(entityType);
  }
  if (entityId) {
    where.push('a.entity_id = ?');
    params.push(entityId);
  }
  if (jobId) {
    where.push('(a.entity_id = ? OR JSON_UNQUOTE(JSON_EXTRACT(a.metadata, "$.jobId")) = ? OR JSON_UNQUOTE(JSON_EXTRACT(a.metadata, "$.job_id")) = ?)');
    params.push(jobId, jobId, jobId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRows = await query(`SELECT COUNT(*) AS total FROM audit_logs a ${clause}`, params);
  const items = await queryRaw(
    `SELECT a.*, u.first_name, u.last_name, u.email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     ${clause}
     ORDER BY a.id DESC
     LIMIT ${Math.max(1, Number(pageSize) || 25)} OFFSET ${Math.max(0, Number(offset) || 0)}`,
    params
  );
  return { items, total: countRows[0].total };
}

module.exports = { write, list };
