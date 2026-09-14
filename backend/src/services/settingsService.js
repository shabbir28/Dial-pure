'use strict';

const { query } = require('../config/database');
const { uuid } = require('../utils/ids');
const { AppError } = require('../utils/response');

const DEFAULTS = {
  ALLOWED_FILE_TYPES: ['csv', 'xlsx'],
  DEFAULT_PHONE_COUNTRY: 'US',
};

const HIDDEN = new Set(['EXPORT_RETENTION_DAYS', 'JOB_RETENTION_DAYS', 'MAX_UPLOAD_SIZE']);

async function getAll() {
  const rows = await query(`SELECT * FROM system_settings ORDER BY setting_key`);
  const map = { ...DEFAULTS };
  const visible = [];
  for (const row of rows) {
    if (HIDDEN.has(row.setting_key)) continue;
    map[row.setting_key] = row.setting_value;
    visible.push(row);
  }
  return {
    raw: visible,
    map,
  };
}

async function get(key) {
  if (HIDDEN.has(key) || key === 'MAX_UPLOAD_SIZE') return undefined;
  const rows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = ?`, [key]);
  if (rows.length) return rows[0].setting_value;
  return DEFAULTS[key];
}

async function upsert({ key, value, description, actorId }) {
  if (HIDDEN.has(key) || key === 'MAX_UPLOAD_SIZE') {
    throw new AppError('SETTING_LOCKED', 'This setting cannot be changed.', 400);
  }
  const existing = await query(`SELECT id FROM system_settings WHERE setting_key = ?`, [key]);
  if (existing.length) {
    await query(
      `UPDATE system_settings SET setting_value = ?, description = ?, updated_by = ? WHERE setting_key = ?`,
      [JSON.stringify(value), description || null, actorId, key]
    );
  } else {
    await query(
      `INSERT INTO system_settings (id, setting_key, setting_value, description, updated_by)
       VALUES (?, ?, ?, ?, ?)`,
      [uuid(), key, JSON.stringify(value), description || null, actorId]
    );
  }
}

async function seedDefaults() {
  await query(
    `DELETE FROM system_settings WHERE setting_key IN ('EXPORT_RETENTION_DAYS', 'JOB_RETENTION_DAYS', 'MAX_UPLOAD_SIZE')`
  );
  const entries = [
    ['ALLOWED_FILE_TYPES', DEFAULTS.ALLOWED_FILE_TYPES, 'Allowed upload extensions'],
    ['DEFAULT_PHONE_COUNTRY', DEFAULTS.DEFAULT_PHONE_COUNTRY, 'Default phone country for normalization'],
  ];
  for (const [key, value, description] of entries) {
    await upsert({ key, value, description, actorId: null });
  }
}

module.exports = { getAll, get, upsert, seedDefaults, DEFAULTS };
