'use strict';

const { query, queryRaw, withTransaction, getPool } = require('../config/database');
const { uuid } = require('../utils/ids');
const { AppError } = require('../utils/response');
const { detectExtension, allowedMime, guessPhoneColumn } = require('../utils/fileDetect');
const storage = require('./storageService');
const settings = require('./settingsService');
const config = require('../config');
const audit = require('./auditService');
const { enqueue } = require('../queues');

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

async function validateUpload(file) {
  const maxSize = config.maxUploadBytes;
  const allowed = (await settings.get('ALLOWED_FILE_TYPES')) || ['csv', 'xlsx'];
  if (!file) throw new AppError('FILE_REQUIRED', 'A CSV or XLSX file is required.', 400);
  if ((file.size || 0) > maxSize) throw new AppError('FILE_TOO_LARGE', 'File is larger than 500 MB.', 413);
  const extension = detectExtension(file.originalname);
  if (!allowed.includes(extension)) {
    throw new AppError('INVALID_FILE_TYPE', 'Only CSV and XLSX files are allowed.', 400);
  }
  if (!allowedMime(extension, file.mimetype)) {
    throw new AppError('INVALID_FILE_TYPE', 'File MIME type does not match the extension.', 400);
  }
  return extension;
}

/**
 * Get the current active global DNC/Dead version info with file and uploader details.
 */
async function getGlobalDncSummary() {
  const versions = await query(
    `SELECT g.*, f.original_filename, f.file_size_bytes,
            u.first_name, u.last_name, u.email
     FROM global_dnc_dead_versions g
     LEFT JOIN files f ON f.id = g.source_file_id
     LEFT JOIN users u ON u.id = g.created_by
     ORDER BY g.created_at DESC LIMIT 50`
  );
  const active = versions.find((v) => v.status === 'active') || null;
  return { active, recent: versions };
}

/**
 * Upload a new global DNC/Dead list (replaces the active one after processing).
 */
async function uploadGlobalDnc({ actor, file, phoneColumn, req }) {
  // Only one version can be processing at a time.
  const running = await query(
    `SELECT id FROM global_dnc_dead_versions WHERE status = 'processing' LIMIT 1`
  );
  if (running.length) {
    throw new AppError(
      'GLOBAL_DNC_PROCESSING',
      'A Global DNC/Dead list is already being processed. Please wait until it completes.',
      409
    );
  }

  const extension = await validateUpload(file);
  const ip = clientIp(req);

  const stored = await storage.saveFromPath({
    sourcePath: file.path,
    folder: 'global-dnc',
    extension,
    size: file.size,
  });
  const checksum = stored.checksum;

  // Create file record.
  const fileId = uuid();
  await query(
    `INSERT INTO files (
      id, file_uuid, original_filename, stored_filename, storage_provider, storage_bucket,
      storage_key, file_type, mime_type, extension, file_size_bytes, checksum_sha256,
      uploaded_by, uploaded_ip, row_count, processing_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fileId,
      uuid(),
      file.originalname,
      stored.storedFilename,
      stored.provider,
      stored.bucket,
      stored.key,
      'campaign_master',
      file.mimetype,
      extension,
      stored.size,
      checksum,
      actor.id,
      ip,
      null,
      'stored',
    ]
  );

  // Get next version number.
  const versionRows = await query(
    `SELECT COALESCE(MAX(version_number), 0) AS maxv FROM global_dnc_dead_versions`
  );
  const versionNumber = Number(versionRows[0].maxv || 0) + 1;
  const versionId = uuid();

  await query(
    `INSERT INTO global_dnc_dead_versions (
      id, version_number, source_file_id, phone_column_name, status, created_by
    ) VALUES (?, ?, ?, ?, 'processing', ?)`,
    [versionId, versionNumber, fileId, phoneColumn || null, actor.id]
  );

  await audit.write({
    requestId: req.requestId,
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'GLOBAL_DNC_UPLOADED',
    entityType: 'global_dnc_dead_version',
    entityId: versionId,
    description: `Uploaded global DNC/Dead list ${file.originalname} as version ${versionNumber}`,
    metadata: { versionNumber, filename: file.originalname, checksum, phoneColumn: phoneColumn || null },
    ipAddress: ip,
    userAgent: req.headers['user-agent'],
  });

  await enqueue('global-dnc', {
    versionId,
    fileId,
    phoneColumn: phoneColumn || null,
    actorId: actor.id,
    requestId: req.requestId,
  });

  return { versionId, versionNumber, fileId, status: 'processing' };
}

module.exports = { getGlobalDncSummary, uploadGlobalDnc };
