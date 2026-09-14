'use strict';

// ------------------------------------------------------------
// Shared heavy DB scheduler
// ------------------------------------------------------------
// - Up to 2 scrub jobs may run duplicate/internal-match stages together.
// - Internal-list imports get exclusive heavy DB access.
// - File ingestion remains parallel and does not use this gate.
const MAX_HEAVY_SCRUBS = 2;

let activeHeavyScrubs = 0;
let internalListHeavyActive = false;
const heavyDbWaiters = [];

function pumpHeavyDbWaiters() {
  if (internalListHeavyActive) return;

  while (heavyDbWaiters.length) {
    const next = heavyDbWaiters[0];

    // Internal-list requires exclusive access.
    if (next.type === 'internal') {
      if (activeHeavyScrubs !== 0) {
        return;
      }

      heavyDbWaiters.shift();
      internalListHeavyActive = true;
      next.resolve();
      return;
    }

    // Scrub heavy stage.
    if (activeHeavyScrubs >= MAX_HEAVY_SCRUBS) {
      return;
    }

    heavyDbWaiters.shift();
    activeHeavyScrubs += 1;
    next.resolve();

    // Keep filling scrub slots unless an internal-list
    // is now at the front of the queue.
    if (
      heavyDbWaiters.length &&
      heavyDbWaiters[0].type === 'internal'
    ) {
      return;
    }
  }
}

function acquireScrubHeavyStage() {
  return new Promise((resolve) => {
    heavyDbWaiters.push({ type: 'scrub', resolve });
    pumpHeavyDbWaiters();
  });
}

function releaseScrubHeavyStage() {
  activeHeavyScrubs = Math.max(0, activeHeavyScrubs - 1);
  pumpHeavyDbWaiters();
}

function acquireInternalListHeavyStage() {
  return new Promise((resolve) => {
    heavyDbWaiters.push({ type: 'internal', resolve });
    pumpHeavyDbWaiters();
  });
}

function releaseInternalListHeavyStage() {
  internalListHeavyActive = false;
  pumpHeavyDbWaiters();
}

async function withScrubHeavyStage(fn) {
  await acquireScrubHeavyStage();

  try {
    return await fn();
  } finally {
    releaseScrubHeavyStage();
  }
}

async function withInternalListHeavyStage(fn) {
  await acquireInternalListHeavyStage();

  try {
    return await fn();
  } finally {
    releaseInternalListHeavyStage();
  }
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stringify } = require('csv-stringify');
const { Transform } = require('stream');
const { getPool, query, queryRaw, withTransaction } = require('../config/database');
const { processPhone } = require('../utils/phone');
const { encrypt, decrypt } = require('../utils/crypto');
const { sanitizeCsvCell } = require('../utils/csvSafety');
const { guessPhoneColumn } = require('../utils/fileDetect');
const { uuid } = require('../utils/ids');
const storage = require('../services/storageService');
const { streamRows } = require('../services/fileParseService');
const audit = require('../services/auditService');
const { emitJobProgress } = require('../socket');
const settings = require('../services/settingsService');
const tldcrm = require('../services/tldcrmService');

const INSERT_BATCH = 1000;
const SCRUB_INSERT_BATCH = 3000;
const PROGRESS_EVERY = 2000;
const SCRUB_PROGRESS_EVERY = 1000;

const suppressionVersionCache = new Map();

function clearSuppressionCache() {
  suppressionVersionCache.clear();
}

async function getSuppressionSetForVersion(versionId) {
  if (!versionId) return new Set();
  if (suppressionVersionCache.has(versionId)) {
    return suppressionVersionCache.get(versionId);
  }

  const conn = await getPool().getConnection();
  try {
    const set = new Set();
    await new Promise((resolve, reject) => {
      const rawConn = conn.connection;
      const stream = rawConn
        .query(
          `SELECT phone_hash FROM internal_list_numbers WHERE list_version_id = ?`,
          [versionId]
        )
        .stream();

      stream.on('data', (row) => {
        if (row.phone_hash) set.add(row.phone_hash);
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    suppressionVersionCache.set(versionId, set);
    return set;
  } finally {
    conn.release();
  }
}

// Cache key for global DNC (not version-specific — "active" version)
const GLOBAL_DNC_CACHE_KEY = '__global_dnc__';

async function getGlobalDncSet() {
  if (suppressionVersionCache.has(GLOBAL_DNC_CACHE_KEY)) {
    return suppressionVersionCache.get(GLOBAL_DNC_CACHE_KEY);
  }

  const versionRows = await query(
    `SELECT id FROM global_dnc_dead_versions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
  );

  if (!versionRows.length) return new Set();

  const versionId = versionRows[0].id;
  const conn = await getPool().getConnection();
  try {
    const set = new Set();
    await new Promise((resolve, reject) => {
      const rawConn = conn.connection;
      const stream = rawConn
        .query(`SELECT phone_hash FROM global_dnc_dead_numbers WHERE version_id = ?`, [versionId])
        .stream();
      stream.on('data', (row) => { if (row.phone_hash) set.add(row.phone_hash); });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    suppressionVersionCache.set(GLOBAL_DNC_CACHE_KEY, set);
    return set;
  } finally {
    conn.release();
  }
}

async function getActiveSuppressionSets(campaignId) {
  const listTypes = ['sales', 'suppression'];
  const result = {
    salesSet: new Set(),
    dncSet: new Set(),
    suppSet: new Set(),
    globalDncSet: new Set(),
  };

  for (const listType of listTypes) {
    const sourceRows = await query(
      `SELECT source_campaign_id
       FROM campaign_internal_list_sources
       WHERE campaign_id = ?
         AND list_type = ?
       LIMIT 1`,
      [campaignId, listType]
    );

    const sourceCampaignId =
      sourceRows.length && sourceRows[0].source_campaign_id
        ? sourceRows[0].source_campaign_id
        : campaignId;

    const versionRows = await query(
      `SELECT id
       FROM internal_list_versions
       WHERE campaign_id = ?
         AND list_type = ?
         AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [sourceCampaignId, listType]
    );

    if (versionRows.length && versionRows[0].id) {
      const set = await getSuppressionSetForVersion(versionRows[0].id);
      if (listType === 'sales') result.salesSet = set;
      else if (listType === 'suppression') result.suppSet = set;
    }
  }

  // Always load global DNC/Dead set (cached in memory)
  result.globalDncSet = await getGlobalDncSet();

  // If global DNC has numbers, use that for dncSet too; otherwise fallback to old per-campaign dnc
  if (result.globalDncSet.size > 0) {
    result.dncSet = result.globalDncSet;
  } else {
    const oldDncRows = await query(
      `SELECT id FROM internal_list_versions WHERE campaign_id = ? AND list_type = 'dnc_dead' AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [campaignId]
    );
    if (oldDncRows.length && oldDncRows[0].id) {
      result.dncSet = await getSuppressionSetForVersion(oldDncRows[0].id);
    }
  }

  return result;
}

function phoneFromRow(row, column) {
  if (!column) return '';
  if (Object.prototype.hasOwnProperty.call(row, column)) return row[column];
  const found = Object.keys(row).find((k) => k.toLowerCase() === String(column).toLowerCase());
  return found ? row[found] : '';
}

async function bulkInsert(sqlPrefix, rows, chunkSize = INSERT_BATCH, conn = null) {
  let affected = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const rowPlaceholder = `(${chunk[0].map(() => '?').join(',')})`;
    const placeholders = new Array(chunk.length).fill(rowPlaceholder).join(',');
    const params = [];
    for (let r = 0; r < chunk.length; r++) {
      const row = chunk[r];
      for (let c = 0; c < row.length; c++) {
        params.push(row[c]);
      }
    }
    const res = conn
      ? (await conn.query(`${sqlPrefix} VALUES ${placeholders}`, params))[0]
      : await queryRaw(`${sqlPrefix} VALUES ${placeholders}`, params);
    if (res && res.affectedRows) {
      affected += Number(res.affectedRows);
    }
  }
  return affected;
}

async function processCampaignMaster({ versionId, campaignId, fileId, phoneColumn, actorId, requestId }) {
  const files = await query(`SELECT * FROM files WHERE id = ?`, [fileId]);
  const versions = await query(`SELECT * FROM campaign_versions WHERE id = ?`, [versionId]);
  if (!files.length || !versions.length) return;

  const file = files[0];
  const abs = storage.absolutePath(file.storage_key);
  const country = (await settings.get('DEFAULT_PHONE_COUNTRY')) || 'US';

  let resolvedColumn = phoneColumn;
  let total = 0;
  let totalKnown = false;
  let processed = 0;
  let valid = 0;
  let invalid = 0;
  const pending = [];

  try {
    // Single-pass: onMeta gives us the row count upfront (XLSX) or we use
    // the processed count at the end (CSV). No separate counting pass.
    await streamRows(abs, file.extension, async (row, sourceRow) => {
      if (!resolvedColumn) {
        resolvedColumn = guessPhoneColumn(Object.keys(row));
      }

      processed += 1;

      const parsed = processPhone(
        phoneFromRow(row, resolvedColumn),
        country
      );

      if (!parsed.valid) {
        invalid += 1;
      } else {
        valid += 1;

        pending.push([
          versionId,
          parsed.phoneHash,
          parsed.last4,
          parsed.countryCode || 'US',
          sourceRow
        ]);

        if (pending.length >= INSERT_BATCH) {
          await bulkInsert(
            `INSERT IGNORE INTO campaign_numbers
             (campaign_version_id, phone_hash, phone_last4, country_code, source_row_number)`,
            pending.splice(0, pending.length)
          );
        }
      }

      if (
        processed % PROGRESS_EVERY === 0
      ) {
        await query(
          `UPDATE campaign_versions
           SET processed_rows = ?,
               valid_numbers = ?,
               invalid_numbers = ?
           WHERE id = ?`,
          [processed, valid, invalid, versionId]
        );
      }
    }, async ({ totalRows }) => {
      // onMeta: called before rows stream (XLSX only — has upfront row count).
      total = Number(totalRows || 0);
      totalKnown = true;

      await query(
        `UPDATE campaign_versions
         SET status = 'processing',
             total_rows = ?,
             processed_rows = 0,
             valid_numbers = 0,
             invalid_numbers = 0,
             duplicate_numbers = 0,
             unique_numbers = 0
         WHERE id = ?`,
        [total, versionId]
      );
    });

    // CSV: total not known upfront, set after single pass completes.
    if (!totalKnown) {
      total = processed;
      await query(
        `UPDATE campaign_versions
         SET status = 'processing',
             total_rows = ?
         WHERE id = ?`,
        [total, versionId]
      );
    }

    if (pending.length) {
      await bulkInsert(
        `INSERT IGNORE INTO campaign_numbers
         (campaign_version_id, phone_hash, phone_last4, country_code, source_row_number)`,
        pending
      );
    }

    const uniqueRows = await query(
      `SELECT COUNT(*) AS c
       FROM campaign_numbers
       WHERE campaign_version_id = ?`,
      [versionId]
    );

    const unique = Number(uniqueRows[0].c);
    const duplicate = Math.max(0, valid - unique);

    await query(
      `UPDATE campaign_versions
       SET status = 'ready',
           total_rows = ?,
           processed_rows = ?,
           valid_numbers = ?,
           invalid_numbers = ?,
           duplicate_numbers = ?,
           unique_numbers = ?
       WHERE id = ?`,
      [
        total,
        total,
        valid,
        invalid,
        duplicate,
        unique,
        versionId
      ]
    );

    await query(
      `UPDATE files
       SET row_count = ?, processing_status = 'ready'
       WHERE id = ?`,
      [total, fileId]
    );

    await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE campaign_versions
         SET status = 'inactive',
             deactivated_at = NOW()
         WHERE campaign_id = ?
           AND status = 'active'
           AND id <> ?`,
        [campaignId, versionId]
      );

      await conn.execute(
        `UPDATE campaign_versions
         SET status = 'active',
             activated_by = ?,
             activated_at = NOW(),
             deactivated_at = NULL
         WHERE id = ?`,
        [actorId, versionId]
      );
    });

    await audit.write({
      requestId,
      actorUserId: actorId,
      action: 'CAMPAIGN_VERSION_ACTIVATED',
      entityType: 'campaign_version',
      entityId: versionId,
      description: 'Master version auto-activated',
      metadata: { campaignId, unique },
    });

    await audit.write({
      requestId,
      actorUserId: actorId,
      action: 'CAMPAIGN_VERSION_CREATED',
      entityType: 'campaign_version',
      entityId: versionId,
      metadata: {
        campaignId,
        total,
        valid,
        invalid,
        duplicate,
        unique
      },
    });
  } catch (error) {
    await query(
      `UPDATE campaign_versions
       SET status = 'failed',
           failure_reason = ?
       WHERE id = ?`,
      [error.message, versionId]
    );

    throw error;
  }
}

async function updateJobProgress(jobId, patch) {
  const fields = [];
  const params = [];
  for (const [key, value] of Object.entries(patch)) {
    fields.push(`${key} = ?`);
    params.push(value);
  }
  if (!fields.length) return;
  params.push(jobId);
  await query(`UPDATE scrub_jobs SET ${fields.join(', ')} WHERE id = ?`, params);
  emitJobProgress(jobId, { id: jobId, ...patch });
}



class JobCancelledError extends Error {
  constructor() {
    super('Scrub job cancelled');
    this.name = 'JobCancelledError';
  }
}

async function assertJobNotCancelled(jobId) {
  const rows = await query(
    `SELECT status FROM scrub_jobs WHERE id = ? LIMIT 1`,
    [jobId]
  );

  if (!rows.length || rows[0].status === 'cancelled') {
    throw new JobCancelledError();
  }
}

async function resetJobForRestart(jobId) {
  // Remove old calculated rows/results.
  await query(`DELETE FROM scrub_rows WHERE job_id = ?`, [jobId]);

  // Old export records will be regenerated from scratch.
  await query(`DELETE FROM exports WHERE job_id = ?`, [jobId]);

  await query(
    `UPDATE scrub_jobs
     SET status = 'queued',
         total_rows = 0,
         processed_rows = 0,
         clean_count = 0,
         matched_count = 0,
         external_match_count = 0,
         invalid_count = 0,
         duplicate_count = 0,
         processing_percentage = 0,
         started_at = NULL,
         completed_at = NULL,
         failed_at = NULL,
         failure_reason = NULL,
         updated_at = NOW()
     WHERE id = ?`,
    [jobId]
  );
}

async function processExternalTldcrmMatches(job) {
  if (String(process.env.TLDCRM_PAUSED || '').toLowerCase() === 'true') {
    console.log(`[TLDCRM] skipped for job ${job.id || job.job_number || ''}`);
    return;
  }

  const PROVIDER = 'tldcrm';
  const CONCURRENCY = 30;

  // Previously confirmed ready=0 numbers:
  // don't call TLDCRM again.
  await queryRaw(
    `UPDATE scrub_rows sr
     INNER JOIN external_matches em
       ON em.provider = ?
      AND em.phone_hash = sr.phone_hash
      AND em.external_ready = 0
     SET sr.status = 'external_match',
         sr.match_source = ?,
         sr.external_provider = ?,
         sr.external_ready = 0,
         sr.external_checked_at = NOW(),
         sr.processed_at = NOW()
     WHERE sr.job_id = ?
       AND (sr.status IS NULL OR sr.status = 'clean')`,
    [PROVIDER, PROVIDER, PROVIDER, job.id]
  );

  for (;;) {
    await assertJobNotCancelled(job.id);

    const rows = await query(
      `SELECT id, phone_hash, phone_last4, normalized_phone_encrypted
       FROM scrub_rows
       WHERE job_id = ?
         AND (status IS NULL OR status = 'clean')
         AND phone_hash IS NOT NULL
         AND external_checked_at IS NULL
       ORDER BY id
       LIMIT ?`,
      [job.id, CONCURRENCY]
    );

    if (!rows.length) break;

    const results = await Promise.all(
      rows.map(async (row) => {
        const normalized = decrypt(row.normalized_phone_encrypted);

        try {
          const result = await tldcrm.checkPhone(normalized);
          return { row, result, error: null };
        } catch (error) {
          return { row, result: null, error };
        }
      })
    );

    for (const { row, result, error } of results) {
      // Safety: API failure must never become CLEAN.
      if (error) {
        throw new Error(
          `TLDCRM check failed for scrub row ${row.id}: ${error.message}`
        );
      }

      if (result.ready === 0) {
        await query(
          `UPDATE scrub_rows
           SET status = 'external_match',
               match_source = 'tldcrm',
               external_provider = 'tldcrm',
               external_ready = 0,
               external_checked_at = NOW(),
               processed_at = NOW()
           WHERE id = ?`,
          [row.id]
        );

        await query(
          `INSERT INTO external_matches (
             phone_hash,
             normalized_phone_encrypted,
             phone_last4,
             provider,
             external_ready,
             first_job_id,
             first_user_id
           ) VALUES (?, ?, ?, 'tldcrm', 0, ?, ?)
           ON DUPLICATE KEY UPDATE
             last_seen_at = NOW(),
             seen_count = seen_count + 1,
             external_ready = 0`,
          [
            row.phone_hash,
            row.normalized_phone_encrypted,
            row.phone_last4,
            job.id,
            job.uploaded_by
          ]
        );
      } else {
        // ready=1 stays NULL and will become CLEAN
        // in the final clean step.
        await query(
          `UPDATE scrub_rows
           SET match_source = 'tldcrm',
               external_provider = 'tldcrm',
               external_ready = 1,
               external_checked_at = NOW()
           WHERE id = ?`,
          [row.id]
        );
      }
    }
  }
}

class ScrubExportStreamer {
  constructor(job) {
    this.job = job;
    this.folder = `exports/${job.id}`;
    this.dir = path.join(require('../config').storage.dir, this.folder);
    this.types = [
      { exportType: 'clean', fileType: 'clean_export' },
      { exportType: 'matched', fileType: 'matched_export' },
      { exportType: 'external_matched', fileType: 'external_matched_export' },
      { exportType: 'invalid', fileType: 'invalid_export' },
      { exportType: 'duplicate', fileType: 'duplicate_export' },
    ];
    this.streams = {};
    this.initialized = false;
    this.baseHeaders = [];
  }

  async init(sampleRow) {
    await storage.ensureDir(this.dir);
    const extraHeaders = ['scrub_status', 'normalized_phone', 'scrub_job_id'];
    this.baseHeaders = Object.keys(sampleRow || {}).filter((h) => !extraHeaders.includes(h));
    const headers = [...this.baseHeaders, ...extraHeaders];

    for (const { exportType, fileType } of this.types) {
      const storedFilename = `${this.job.job_number}-${exportType}.csv`;
      const relKey = `${this.folder}/${storedFilename}`;
      const abs = storage.absolutePath(relKey);

      const out = fs.createWriteStream(abs);
      const stringifier = stringify({ header: true, columns: headers });
      const hash = crypto.createHash('sha256');
      let size = 0;

      const transform = new Transform({
        transform(chunk, encoding, callback) {
          size += chunk.length;
          hash.update(chunk);
          callback(null, chunk);
        },
      });

      const finishPromise = new Promise((resolve, reject) => {
        out.on('finish', resolve);
        out.on('error', reject);
        stringifier.on('error', reject);
        transform.on('error', reject);
      });

      stringifier.pipe(transform).pipe(out);

      this.streams[exportType] = {
        exportType,
        fileType,
        storedFilename,
        relKey,
        abs,
        out,
        stringifier,
        transform,
        hash,
        getSize: () => size,
        finishPromise,
      };
    }
    this.initialized = true;
  }

  writeRow(exportType, row, rowStatus, normalizedPhone) {
    if (!this.initialized || !this.streams[exportType]) return;
    const record = {};
    for (const h of this.baseHeaders) {
      record[h] = sanitizeCsvCell(row[h]);
    }
    record.scrub_status = rowStatus;
    record.normalized_phone = sanitizeCsvCell(normalizedPhone || '');
    record.scrub_job_id = this.job.job_number;
    this.streams[exportType].stringifier.write(record);
  }

  async finish(tally) {
    if (!this.initialized) return;

    for (const { exportType } of this.types) {
      this.streams[exportType].stringifier.end();
    }

    await Promise.all(this.types.map(({ exportType }) => this.streams[exportType].finishPromise));

    for (const { exportType, fileType } of this.types) {
      const st = this.streams[exportType];
      const count =
        exportType === 'clean'
          ? tally.clean
          : exportType === 'matched'
            ? tally.match
            : exportType === 'external_matched'
              ? tally.external_match
              : exportType === 'invalid'
                ? tally.invalid
                : exportType === 'duplicate'
                  ? tally.duplicate
                  : 0;

      const checksum = st.hash.digest('hex');
      const fileId = uuid();
      await query(
        `INSERT INTO files (
          id, file_uuid, original_filename, stored_filename, storage_provider, storage_bucket,
          storage_key, file_type, mime_type, extension, file_size_bytes, checksum_sha256,
          uploaded_by, row_count, processing_status
        ) VALUES (?, ?, ?, ?, 'local', NULL, ?, ?, 'text/csv', 'csv', ?, ?, ?, ?, 'ready')`,
        [
          fileId,
          uuid(),
          st.storedFilename,
          st.storedFilename,
          st.relKey,
          fileType,
          st.getSize(),
          checksum,
          this.job.uploaded_by,
          0,
        ]
      );

      const exportId = uuid();
      await query(
        `INSERT INTO exports (id, export_uuid, job_id, export_type, file_id, row_count, generated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE file_id = VALUES(file_id), row_count = VALUES(row_count), generated_at = NOW()`,
        [exportId, uuid(), this.job.id, exportType, fileId, count, this.job.uploaded_by]
      );

      await audit.write({
        actorUserId: this.job.uploaded_by,
        action: 'EXPORT_GENERATED',
        entityType: 'export',
        entityId: exportId,
        metadata: { jobId: this.job.id, exportType, rowCount: count },
      });
    }
  }

  destroy() {
    for (const { exportType } of this.types) {
      if (this.streams[exportType]) {
        try { this.streams[exportType].stringifier.destroy(); } catch {}
        try { this.streams[exportType].transform.destroy(); } catch {}
        try { this.streams[exportType].out.destroy(); } catch {}
      }
    }
  }
}

async function processScrubJob({ jobId, requestId, restart = false }) {
  if (restart) {
    await resetJobForRestart(jobId);
  }

  const jobs = await queryRaw(
    `SELECT j.*, f.storage_key, f.extension, f.original_filename, f.row_count AS file_row_count,
            c.default_phone_country, c.name AS campaign_name, cv.version_number
     FROM scrub_jobs j
     JOIN files f ON f.id = j.input_file_id
     JOIN campaigns c ON c.id = j.campaign_id
     JOIN campaign_versions cv ON cv.id = j.campaign_version_id
     WHERE j.id = ?`,
    [jobId]
  );
  if (!jobs.length) return;
  const job = jobs[0];
  if (['completed', 'cancelled'].includes(job.status)) return;

  const initialTotal = Number(job.total_rows || job.file_row_count || 0);
  const country = job.default_phone_country || (await settings.get('DEFAULT_PHONE_COUNTRY')) || 'US';
  const abs = storage.absolutePath(job.storage_key);
  const exportStreamer = new ScrubExportStreamer(job);

  try {
    await assertJobNotCancelled(jobId);

    await updateJobProgress(jobId, {
      status: 'validating',
      total_rows: initialTotal,
      started_at: new Date(),
    });
    await audit.write({
      requestId,
      actorUserId: job.uploaded_by,
      action: 'SCRUB_JOB_STARTED',
      entityType: 'scrub_job',
      entityId: jobId,
      metadata: { jobNumber: job.job_number, campaignVersion: job.version_number },
    });

    const existingRows = await query(`SELECT 1 FROM scrub_rows WHERE job_id = ? LIMIT 1`, [jobId]);
    if (existingRows.length) {
      for (;;) {
        const res = await queryRaw(`DELETE FROM scrub_rows WHERE job_id = ? LIMIT 10000`, [jobId]);
        if (!res.affectedRows) break;
      }
    }

    await updateJobProgress(jobId, {
      status: 'processing',
      total_rows: initialTotal,
      processing_percentage: 5,
    });
    const { salesSet, dncSet, suppSet, globalDncSet } = await getActiveSuppressionSets(job.campaign_id);
    await assertJobNotCancelled(jobId);

    await updateJobProgress(jobId, {
      status: 'processing',
      total_rows: initialTotal,
      processing_percentage: 8,
    });

    const pending = [];
    const seenPhoneHashes = new Map();
    let total = 0;
    let expectedTotal = initialTotal;
    let totalKnown = initialTotal > 0;
    let lastProgressAt = 0;

    const tally = {
      clean: 0,
      match: 0,
      external_match: 0,
      invalid: 0,
      duplicate: 0,
      sales: 0,
      dnc_dead: 0,
      suppression: 0,
    };

    const flushRows = async () => {
      if (!pending.length) return;

      await assertJobNotCancelled(jobId);

      const chunk = pending.splice(0, pending.length);
      await bulkInsert(
        `INSERT INTO scrub_rows (
          job_id, source_row_number, original_phone_encrypted, normalized_phone_encrypted,
          phone_hash, phone_last4, status, match_source, invalid_reason, duplicate_of_row,
          matched_campaign_number_id, original_row_data, processed_at
        )`,
        chunk,
        SCRUB_INSERT_BATCH
      );

      if (total - lastProgressAt >= SCRUB_PROGRESS_EVERY) {
        lastProgressAt = total;
        const pct = totalKnown && expectedTotal > 0
          ? Math.min(75, 5 + Number(((total / expectedTotal) * 70).toFixed(2)))
          : 5;

        await updateJobProgress(jobId, {
          total_rows: totalKnown ? expectedTotal : total,
          processed_rows: total,
          processing_percentage: pct,
        });
      }
    };

    await streamRows(abs, job.extension, async (row, sourceRow) => {
      total += 1;

      if (!exportStreamer.initialized) {
        await exportStreamer.init(row);
      }

      const rawPhone = phoneFromRow(row, job.phone_column_name);
      const parsed = processPhone(rawPhone, country);
      const originalEnc = encrypt(String(rawPhone ?? ''));

      let rowStatus = null;
      let matchSource = null;
      let invalidReason = null;
      let duplicateOfRow = null;

      if (!parsed.valid) {
        rowStatus = 'invalid';
        invalidReason = parsed.reason;
        tally.invalid += 1;
        exportStreamer.writeRow('invalid', row, rowStatus, '');
      } else if (seenPhoneHashes.has(parsed.phoneHash)) {
        rowStatus = 'duplicate';
        duplicateOfRow = seenPhoneHashes.get(parsed.phoneHash);
        tally.duplicate += 1;
        exportStreamer.writeRow('duplicate', row, rowStatus, parsed.normalized);
      } else {
        seenPhoneHashes.set(parsed.phoneHash, sourceRow);

        if (salesSet.has(parsed.phoneHash)) {
          rowStatus = 'match';
          matchSource = 'sales';
          tally.match += 1;
          tally.sales += 1;
          exportStreamer.writeRow('matched', row, rowStatus, parsed.normalized);
        } else if (dncSet.has(parsed.phoneHash) || globalDncSet.has(parsed.phoneHash)) {
          rowStatus = 'match';
          matchSource = 'dnc_dead';
          tally.match += 1;
          tally.dnc_dead += 1;
          exportStreamer.writeRow('matched', row, rowStatus, parsed.normalized);
        } else if (suppSet.has(parsed.phoneHash)) {
          rowStatus = 'match';
          matchSource = 'suppression';
          tally.match += 1;
          tally.suppression += 1;
          exportStreamer.writeRow('matched', row, rowStatus, parsed.normalized);
        } else {
          rowStatus = 'clean';
          tally.clean += 1;
          exportStreamer.writeRow('clean', row, rowStatus, parsed.normalized);
        }
      }

      pending.push([
        jobId,
        sourceRow,
        originalEnc,
        parsed.valid ? encrypt(parsed.normalized) : null,
        parsed.phoneHash || null,
        parsed.last4 || null,
        rowStatus,
        matchSource,
        invalidReason,
        duplicateOfRow,
        null,
        JSON.stringify(row),
        new Date(),
      ]);

      if (pending.length >= SCRUB_INSERT_BATCH) return flushRows();
      return null;
    }, async ({ totalRows }) => {
      expectedTotal = Number(totalRows || 0);
      totalKnown = true;

      await updateJobProgress(jobId, {
        total_rows: expectedTotal,
        processed_rows: total,
        processing_percentage: 5,
      });
    });

    await flushRows();
    await assertJobNotCancelled(jobId);

    // Remaining clean rows can be checked against TLDCRM if enabled
    if (String(process.env.TLDCRM_PAUSED || '').toLowerCase() !== 'true') {
      await assertJobNotCancelled(jobId);
      await processExternalTldcrmMatches(job);
      await assertJobNotCancelled(jobId);

      const counts = await query(
        `SELECT status, match_source, COUNT(*) AS c
         FROM scrub_rows
         WHERE job_id = ?
         GROUP BY status, match_source`,
        [jobId]
      );

      tally.clean = 0;
      tally.match = 0;
      tally.external_match = 0;
      tally.invalid = 0;
      tally.duplicate = 0;
      tally.sales = 0;
      tally.dnc_dead = 0;
      tally.suppression = 0;

      for (const row of counts) {
        const c = Number(row.c || 0);

        if (row.status && Object.prototype.hasOwnProperty.call(tally, row.status)) {
          tally[row.status] += c;
        }

        if (
          row.status === 'match' &&
          ['sales', 'dnc_dead', 'suppression'].includes(row.match_source)
        ) {
          tally[row.match_source] += c;
        }
      }
    }

    await updateJobProgress(jobId, {
      status: 'generating_exports',
      clean_count: tally.clean,
      matched_count: tally.match,
      sales_match_count: tally.sales,
      dnc_dead_match_count: tally.dnc_dead,
      suppression_match_count: tally.suppression,
      external_match_count: tally.external_match,
      invalid_count: tally.invalid,
      duplicate_count: tally.duplicate,
      processing_percentage: 80,
    });

    await assertJobNotCancelled(jobId);
    if (exportStreamer && exportStreamer.initialized && tally.external_match === 0) {
      await exportStreamer.finish(tally);
    } else {
      if (exportStreamer) exportStreamer.destroy();
      await generateExports(job, tally);
    }
    await assertJobNotCancelled(jobId);

    await updateJobProgress(jobId, {
      status: 'completed',
      completed_at: new Date(),
      processing_percentage: 100,
    });

    await audit.write({
      requestId,
      actorUserId: job.uploaded_by,
      action: 'SCRUB_JOB_COMPLETED',
      entityType: 'scrub_job',
      entityId: jobId,
      metadata: {
        campaign: job.campaign_name,
        campaignVersion: job.version_number,
        total,
        clean: tally.clean,
        matched: tally.match,
        externalMatched: tally.external_match,
        invalid: tally.invalid,
        duplicates: tally.duplicate,
      },
    });
  } catch (error) {
    if (exportStreamer) {
      exportStreamer.destroy();
    }

    if (error instanceof JobCancelledError) {
      await query(
        `UPDATE scrub_jobs
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE id = ?`,
        [jobId]
      );

      emitJobProgress(jobId, { status: 'cancelled' });
      return;
    }

    await query(
      `UPDATE scrub_jobs
       SET status = 'failed', failed_at = NOW(), failure_reason = ?
       WHERE id = ?`,
      [error.message, jobId]
    );
    await audit.write({
      requestId,
      actorUserId: job.uploaded_by,
      action: 'SCRUB_JOB_FAILED',
      entityType: 'scrub_job',
      entityId: jobId,
      description: error.message,
    });
    emitJobProgress(jobId, { status: 'failed', failure_reason: error.message });
    throw error;
  }
}

async function generateExports(job, tally) {
  const types = [
    ['clean', 'clean_export', tally.clean],
    ['matched', 'matched_export', tally.match],
    ['external_matched', 'external_matched_export', tally.external_match],
    ['invalid', 'invalid_export', tally.invalid],
    ['duplicate', 'duplicate_export', tally.duplicate],
  ];

  for (const [exportType, fileType, count] of types) {
    await assertJobNotCancelled(job.id);

    const status =
      exportType === 'matched'
        ? 'match'
        : exportType === 'external_matched'
          ? 'external_match'
          : exportType;
    const fileId = await writeExportCsv(job, status, exportType, fileType, count);
    const exportId = uuid();
    await query(
      `INSERT INTO exports (id, export_uuid, job_id, export_type, file_id, row_count, generated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE file_id = VALUES(file_id), row_count = VALUES(row_count), generated_at = NOW()`,
      [exportId, uuid(), job.id, exportType, fileId, count, job.uploaded_by]
    );
    await audit.write({
      actorUserId: job.uploaded_by,
      action: 'EXPORT_GENERATED',
      entityType: 'export',
      entityId: exportId,
      metadata: { jobId: job.id, exportType, rowCount: count },
    });
  }
}

async function writeExportCsv(job, status, exportType, fileType, rowCount = 0) {
  const sample = await query(
    `SELECT original_row_data FROM scrub_rows WHERE job_id = ? LIMIT 1`,
    [job.id]
  );
  const extraHeaders = ['scrub_status', 'normalized_phone', 'scrub_job_id'];
  const baseHeaders = sample[0]?.original_row_data
    ? Object.keys(sample[0].original_row_data).filter((h) => !extraHeaders.includes(h))
    : [];
  const headers = [...baseHeaders, ...extraHeaders];

  const storedFilename = `${job.job_number}-${exportType}.csv`;
  const folder = `exports/${job.id}`;
  await storage.ensureDir(path.join(require('../config').storage.dir, folder));
  const relKey = `${folder}/${storedFilename}`;
  const abs = storage.absolutePath(relKey);

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(abs);
    const stringifier = stringify({ header: true, columns: headers });
    stringifier.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    stringifier.pipe(out);

    (async () => {
      if (rowCount === 0) {
        stringifier.end();
        return;
      }
      let lastId = 0;
      for (;;) {
        await assertJobNotCancelled(job.id);

        const rows = await query(
          `SELECT id, status, original_row_data, normalized_phone_encrypted
           FROM scrub_rows FORCE INDEX (idx_scrub_rows_job_status)
           WHERE job_id = ? AND status = ? AND id > ?
           ORDER BY id
           LIMIT 10000`,
          [job.id, status, lastId]
        );
        if (!rows.length) break;
        for (const row of rows) {
          lastId = row.id;
          const data = row.original_row_data || {};
          const record = {};
          for (const h of baseHeaders) {
            record[h] = sanitizeCsvCell(data[h]);
          }
          record.scrub_status = row.status;
          record.normalized_phone = sanitizeCsvCell(decrypt(row.normalized_phone_encrypted) || '');
          record.scrub_job_id = job.job_number;
          stringifier.write(record);
        }
      }
      stringifier.end();
    })().catch(reject);
  });

  const stat = fs.statSync(abs);
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(abs);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  const checksum = hash.digest('hex');
  const fileId = uuid();
  await query(
    `INSERT INTO files (
      id, file_uuid, original_filename, stored_filename, storage_provider, storage_bucket,
      storage_key, file_type, mime_type, extension, file_size_bytes, checksum_sha256,
      uploaded_by, row_count, processing_status
    ) VALUES (?, ?, ?, ?, 'local', NULL, ?, ?, 'text/csv', 'csv', ?, ?, ?, ?, 'ready')`,
    [
      fileId,
      uuid(),
      storedFilename,
      storedFilename,
      relKey,
      fileType,
      stat.size,
      checksum,
      job.uploaded_by,
      0,
    ]
  );
  return fileId;
}

async function processInternalList({
  versionId,
  campaignId,
  listType,
  fileId,
  phoneColumn,
  actorId,
  requestId
}) {
  const files = await query(`SELECT * FROM files WHERE id = ?`, [fileId]);
  const versions = await query(
    `SELECT * FROM internal_list_versions WHERE id = ?`,
    [versionId]
  );

  if (!files.length || !versions.length) return;

  const file = files[0];
  const abs = storage.absolutePath(file.storage_key);
  const country = (await settings.get('DEFAULT_PHONE_COUNTRY')) || 'US';

  let resolvedColumn = phoneColumn || versions[0].phone_column_name || null;
  let total = 0;
  let totalKnown = false;
  let processed = 0;
  let valid = 0;
  let invalid = 0;
  let duplicateCount = 0;
  const seenHashes = new Set();
  const pending = [];

  // Internal-list import tuning.
  // 5,000 rows per single INSERT statement reduces round-trips by 5x.
  const INTERNAL_INSERT_BATCH = 5000;
  const INTERNAL_PROGRESS_EVERY = 25000;

  const conn = await getPool().getConnection();
  let inTransaction = false;
  let uncommittedRows = 0;

  try {
    await conn.execute('SET foreign_key_checks = 0');
    await conn.beginTransaction();
    inTransaction = true;

    const [existing] = await conn.execute(
      `SELECT 1 FROM internal_list_numbers WHERE list_version_id = ? LIMIT 1`,
      [versionId]
    );
    if (existing.length) {
      for (;;) {
        const [idRows] = await conn.query(
          `SELECT id FROM internal_list_numbers WHERE list_version_id = ? LIMIT 10000`,
          [versionId]
        );
        if (!idRows.length) break;
        const ids = idRows.map((r) => r.id).join(',');
        await conn.query(`DELETE FROM internal_list_numbers WHERE id IN (${ids})`);
        await conn.commit();
        await conn.beginTransaction();
      }
    }

    await conn.execute(
      `UPDATE internal_list_versions
       SET status = 'processing',
           total_rows = 0,
           processed_rows = 0,
           valid_numbers = 0,
           invalid_numbers = 0,
           duplicate_numbers = 0,
           unique_numbers = 0,
           failure_reason = NULL
       WHERE id = ?`,
      [versionId]
    );
    await conn.commit();
    await conn.beginTransaction();

    let resolvedKey = null;
    let uniqueInserted = 0;

    // Single-pass import: count and process rows together.
    await streamRows(abs, file.extension, async (row, sourceRow) => {
      if (!totalKnown) {
        total += 1;
      }

      if (resolvedKey === null) {
        if (resolvedColumn && Object.prototype.hasOwnProperty.call(row, resolvedColumn)) {
          resolvedKey = resolvedColumn;
        } else {
          const keys = Object.keys(row);
          if (!resolvedColumn) {
            resolvedColumn = guessPhoneColumn(keys);
            if (resolvedColumn) {
              await conn.execute(
                `UPDATE internal_list_versions SET phone_column_name = ? WHERE id = ?`,
                [resolvedColumn, versionId]
              );
            }
          }
          const found = keys.find((k) => k.toLowerCase() === String(resolvedColumn).toLowerCase());
          resolvedKey = found || resolvedColumn;
        }
      }

      processed += 1;

      const rawPhone = row[resolvedKey] !== undefined ? row[resolvedKey] : phoneFromRow(row, resolvedColumn);
      const parsed = processPhone(rawPhone, country);

      if (!parsed.valid) {
        invalid += 1;
      } else if (seenHashes.has(parsed.phoneHash)) {
        duplicateCount += 1;
      } else {
        if (seenHashes.size < 3000000) {
          seenHashes.add(parsed.phoneHash);
        }
        valid += 1;

        pending.push([
          versionId,
          parsed.phoneHash,
          parsed.last4,
          parsed.countryCode || 'US',
          sourceRow
        ]);

        if (pending.length >= INTERNAL_INSERT_BATCH) {
          const inserted = await bulkInsert(
            `INSERT IGNORE INTO internal_list_numbers
             (list_version_id, phone_hash, phone_last4, country_code, source_row_number)`,
            pending.splice(0, pending.length),
            INTERNAL_INSERT_BATCH,
            conn
          );
          uniqueInserted += inserted;
          uncommittedRows += INTERNAL_INSERT_BATCH;

          if (uncommittedRows >= 25000) {
            await conn.commit();
            await conn.beginTransaction();
            uncommittedRows = 0;
          }
        }
      }

      if (processed % INTERNAL_PROGRESS_EVERY === 0) {
        if (uncommittedRows > 0) {
          await conn.commit();
          await conn.beginTransaction();
          uncommittedRows = 0;
        }

        const [check] = await conn.execute(
          `SELECT status FROM internal_list_versions WHERE id = ?`,
          [versionId]
        );
        if (check.length && ['failed', 'cancelled'].includes(check[0].status)) {
          throw new Error('Internal list processing cancelled by user');
        }

        await conn.execute(
          `UPDATE internal_list_versions
           SET total_rows = ?,
               processed_rows = ?,
               valid_numbers = ?,
               invalid_numbers = ?,
               duplicate_numbers = ?
           WHERE id = ?`,
          [totalKnown ? total : processed, processed, valid, invalid, duplicateCount, versionId]
        );
        await conn.commit();
        await conn.beginTransaction();
      }
    }, async ({ totalRows }) => {
      total = Number(totalRows || 0);
      totalKnown = true;

      await conn.execute(
        `UPDATE internal_list_versions
         SET total_rows = ?
         WHERE id = ?`,
        [total, versionId]
      );
    });

    // CSV does not provide an upfront total, so final processed count is its total.
    if (!totalKnown) {
      total = processed;
    }

    if (pending.length) {
      const inserted = await bulkInsert(
        `INSERT IGNORE INTO internal_list_numbers
         (list_version_id, phone_hash, phone_last4, country_code, source_row_number)`,
        pending.splice(0, pending.length),
        INTERNAL_INSERT_BATCH,
        conn
      );
      uniqueInserted += inserted;
    }

    if (inTransaction) {
      await conn.commit();
      inTransaction = false;
    }
    await conn.execute('SET foreign_key_checks = 1');

    const unique = uniqueInserted;
    const duplicate = Math.max(duplicateCount, (valid + duplicateCount) - unique);

    await withTransaction(async (tconn) => {
      await tconn.execute(
        `UPDATE internal_list_versions
         SET status = 'inactive',
             deactivated_at = NOW()
         WHERE campaign_id = ?
           AND list_type = ?
           AND status = 'active'
           AND id <> ?`,
        [campaignId, listType, versionId]
      );

      await tconn.execute(
        `UPDATE internal_list_versions
         SET status = 'active',
             total_rows = ?,
             processed_rows = ?,
             valid_numbers = ?,
             invalid_numbers = ?,
             duplicate_numbers = ?,
             unique_numbers = ?,
             activated_by = ?,
             activated_at = NOW(),
             deactivated_at = NULL,
             failure_reason = NULL
         WHERE id = ?`,
        [
          total,
          total,
          valid,
          invalid,
          duplicate,
          unique,
          actorId,
          versionId
        ]
      );
    });

    clearSuppressionCache();

    await query(
      `UPDATE files
       SET row_count = ?, processing_status = 'ready'
       WHERE id = ?`,
      [total, fileId]
    );

    await audit.write({
      requestId: requestId || versionId,
      actorUserId: actorId,
      action: 'INTERNAL_LIST_ACTIVATED',
      entityType: 'internal_list_version',
      entityId: versionId,
      description: `${listType} internal list auto-activated`,
      metadata: {
        campaignId,
        listType,
        total,
        valid,
        invalid,
        duplicate,
        unique
      },
    });
  } catch (error) {
    if (inTransaction) {
      try { await conn.rollback(); } catch {}
    }
    try { await conn.execute('SET foreign_key_checks = 1'); } catch {}

    await query(
      `UPDATE internal_list_versions
       SET status = 'failed',
           failure_reason = ?
       WHERE id = ?`,
      [error.message, versionId]
    );

    await query(
      `UPDATE files
       SET processing_status = 'failed'
       WHERE id = ?`,
      [fileId]
    );

    throw error;
  } finally {
    try { await conn.execute('SET foreign_key_checks = 1'); } catch {}
    conn.release();
  }
}

async function processGlobalDnc({ versionId, fileId, phoneColumn, actorId, requestId }) {
  const files = await query(`SELECT * FROM files WHERE id = ?`, [fileId]);
  const versions = await query(`SELECT * FROM global_dnc_dead_versions WHERE id = ?`, [versionId]);

  if (!files.length || !versions.length) return;

  const file = files[0];
  const abs = storage.absolutePath(file.storage_key);
  const country = (await settings.get('DEFAULT_PHONE_COUNTRY')) || 'US';

  let resolvedColumn = phoneColumn || versions[0].phone_column_name || null;
  let total = 0;
  let totalKnown = false;
  let processed = 0;
  let valid = 0;
  let invalid = 0;
  let duplicateCount = 0;
  const seenHashes = new Set();
  const pending = [];

  const INTERNAL_INSERT_BATCH = 5000;
  const INTERNAL_PROGRESS_EVERY = 25000;

  const conn = await getPool().getConnection();
  let inTransaction = false;
  let uncommittedRows = 0;

  try {
    await conn.execute('SET foreign_key_checks = 0');
    await conn.beginTransaction();
    inTransaction = true;

    // Clear any existing rows for this version (retry safety)
    for (;;) {
      const [idRows] = await conn.query(
        `SELECT id FROM global_dnc_dead_numbers WHERE version_id = ? LIMIT 10000`, [versionId]
      );
      if (!idRows.length) break;
      const ids = idRows.map((r) => r.id).join(',');
      await conn.query(`DELETE FROM global_dnc_dead_numbers WHERE id IN (${ids})`);
      await conn.commit();
      await conn.beginTransaction();
    }

    await conn.execute(
      `UPDATE global_dnc_dead_versions
       SET status = 'processing', total_rows = 0, processed_rows = 0,
           valid_numbers = 0, invalid_numbers = 0, duplicate_numbers = 0,
           unique_numbers = 0, failure_reason = NULL
       WHERE id = ?`,
      [versionId]
    );
    await conn.commit();
    await conn.beginTransaction();

    let resolvedKey = null;
    let uniqueInserted = 0;

    await streamRows(abs, file.extension, async (row, sourceRow) => {
      if (!totalKnown) total += 1;

      if (resolvedKey === null) {
        if (resolvedColumn && Object.prototype.hasOwnProperty.call(row, resolvedColumn)) {
          resolvedKey = resolvedColumn;
        } else {
          const keys = Object.keys(row);
          if (!resolvedColumn) {
            resolvedColumn = guessPhoneColumn(keys);
            if (resolvedColumn) {
              await conn.execute(
                `UPDATE global_dnc_dead_versions SET phone_column_name = ? WHERE id = ?`,
                [resolvedColumn, versionId]
              );
            }
          }
          const found = keys.find((k) => k.toLowerCase() === String(resolvedColumn).toLowerCase());
          resolvedKey = found || resolvedColumn;
        }
      }

      processed += 1;

      const rawPhone = row[resolvedKey] !== undefined ? row[resolvedKey] : phoneFromRow(row, resolvedColumn);
      const parsed = processPhone(rawPhone, country);

      if (!parsed.valid) {
        invalid += 1;
      } else if (seenHashes.has(parsed.phoneHash)) {
        duplicateCount += 1;
      } else {
        if (seenHashes.size < 5000000) seenHashes.add(parsed.phoneHash);
        valid += 1;

        pending.push([versionId, parsed.phoneHash, parsed.last4, parsed.countryCode || 'US', sourceRow]);

        if (pending.length >= INTERNAL_INSERT_BATCH) {
          const inserted = await bulkInsert(
            `INSERT IGNORE INTO global_dnc_dead_numbers (version_id, phone_hash, phone_last4, country_code, source_row_number)`,
            pending.splice(0, pending.length),
            INTERNAL_INSERT_BATCH,
            conn
          );
          uniqueInserted += inserted;
          uncommittedRows += INTERNAL_INSERT_BATCH;

          if (uncommittedRows >= 25000) {
            await conn.commit();
            await conn.beginTransaction();
            uncommittedRows = 0;
          }
        }
      }

      if (processed % INTERNAL_PROGRESS_EVERY === 0) {
        if (uncommittedRows > 0) {
          await conn.commit();
          await conn.beginTransaction();
          uncommittedRows = 0;
        }
        await conn.execute(
          `UPDATE global_dnc_dead_versions
           SET total_rows = ?, processed_rows = ?, valid_numbers = ?,
               invalid_numbers = ?, duplicate_numbers = ?
           WHERE id = ?`,
          [totalKnown ? total : processed, processed, valid, invalid, duplicateCount, versionId]
        );
        await conn.commit();
        await conn.beginTransaction();
      }
    }, async ({ totalRows }) => {
      total = Number(totalRows || 0);
      totalKnown = true;
      await conn.execute(
        `UPDATE global_dnc_dead_versions SET total_rows = ? WHERE id = ?`,
        [total, versionId]
      );
    });

    if (!totalKnown) total = processed;

    if (pending.length) {
      const inserted = await bulkInsert(
        `INSERT IGNORE INTO global_dnc_dead_numbers (version_id, phone_hash, phone_last4, country_code, source_row_number)`,
        pending.splice(0, pending.length),
        INTERNAL_INSERT_BATCH,
        conn
      );
      uniqueInserted += inserted;
    }

    if (inTransaction) {
      await conn.commit();
      inTransaction = false;
    }
    await conn.execute('SET foreign_key_checks = 1');

    const unique = uniqueInserted;
    const duplicate = Math.max(duplicateCount, (valid + duplicateCount) - unique);

    // Deactivate previous active version, activate this one
    await withTransaction(async (tconn) => {
      await tconn.execute(
        `UPDATE global_dnc_dead_versions
         SET status = 'inactive', deactivated_at = NOW()
         WHERE status = 'active' AND id <> ?`,
        [versionId]
      );

      await tconn.execute(
        `UPDATE global_dnc_dead_versions
         SET status = 'active',
             total_rows = ?, processed_rows = ?,
             valid_numbers = ?, invalid_numbers = ?,
             duplicate_numbers = ?, unique_numbers = ?,
             activated_by = ?, activated_at = NOW(), deactivated_at = NULL,
             failure_reason = NULL
         WHERE id = ?`,
        [total, total, valid, invalid, duplicate, unique, actorId, versionId]
      );
    });

    // Clear global DNC cache so next scrub picks up the new list
    suppressionVersionCache.delete(GLOBAL_DNC_CACHE_KEY);

    await query(
      `UPDATE files SET row_count = ?, processing_status = 'ready' WHERE id = ?`,
      [total, fileId]
    );

    await audit.write({
      requestId: requestId || versionId,
      actorUserId: actorId,
      action: 'GLOBAL_DNC_ACTIVATED',
      entityType: 'global_dnc_dead_version',
      entityId: versionId,
      description: 'Global DNC/Dead list auto-activated',
      metadata: { total, valid, invalid, duplicate, unique },
    });
  } catch (error) {
    if (inTransaction) { try { await conn.rollback(); } catch {} }
    try { await conn.execute('SET foreign_key_checks = 1'); } catch {}

    await query(
      `UPDATE global_dnc_dead_versions SET status = 'failed', failure_reason = ? WHERE id = ?`,
      [error.message, versionId]
    );
    await query(
      `UPDATE files SET processing_status = 'failed' WHERE id = ?`,
      [fileId]
    );
    throw error;
  } finally {
    try { await conn.execute('SET foreign_key_checks = 1'); } catch {}
    conn.release();
  }
}

module.exports = {
  processCampaignMaster,
  processInternalList,
  processGlobalDnc,
  processScrubJob,
};
