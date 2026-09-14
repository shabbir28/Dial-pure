'use strict';

const { query, queryRaw } = require('../config/database');
const { processPhone } = require('../utils/phone');
const { decrypt } = require('../utils/crypto');
const { AppError } = require('../utils/response');
const audit = require('./auditService');
const { sqlLimit } = require('../utils/pagination');

function displayPhone(encryptedNormalized, encryptedOriginal, last4) {
  const normalized = decrypt(encryptedNormalized);
  const original = decrypt(encryptedOriginal);
  if (normalized && normalized.length === 11 && normalized.startsWith('1')) {
    return {
      national: normalized.slice(1),
      e164: `+${normalized}`,
      original: original || normalized.slice(1),
      last4: last4 || normalized.slice(-4),
    };
  }
  return {
    national: original || (last4 ? `******${last4}` : '—'),
    e164: original || null,
    original: original || null,
    last4: last4 || null,
  };
}

function maskForAgent(phone) {
  if (!phone?.national) return phone;
  const n = phone.national;
  return {
    national: n.length >= 4 ? `******${n.slice(-4)}` : n,
    e164: null,
    original: n.length >= 4 ? `******${n.slice(-4)}` : n,
    last4: n.slice(-4),
  };
}

async function searchPhone({ queryText, actor, ip, userAgent, requestId }) {
  const parsed = processPhone(queryText, 'US');
  if (!parsed.valid) {
    throw new AppError('INVALID_PHONE', 'Enter a valid US phone number to search.', 400, { reason: parsed.reason });
  }

  const campaigns = await queryRaw(
    `SELECT c.id AS campaign_id, c.name AS campaign_name, c.campaign_code,
            cv.id AS version_id, cv.version_number, cv.status AS version_status,
            cv.activated_at, cn.source_row_number, cn.phone_last4
     FROM campaign_numbers cn
     JOIN campaign_versions cv ON cv.id = cn.campaign_version_id
     JOIN campaigns c ON c.id = cv.campaign_id
     WHERE cn.phone_hash = ?
     ORDER BY cv.created_at DESC`,
    [parsed.phoneHash]
  );

  const params = [parsed.phoneHash];
  let jobSql = `
    SELECT sr.source_row_number, sr.status, sr.invalid_reason, sr.duplicate_of_row,
           sr.processed_at, sr.original_phone_encrypted, sr.normalized_phone_encrypted,
           sr.phone_last4, sr.original_row_data,
           j.id AS job_id, j.job_number, j.created_at, j.created_ip, j.phone_column_name,
           c.name AS campaign_name, cv.version_number,
           f.original_filename,
           u.id AS agent_id, u.first_name, u.last_name, u.email
    FROM scrub_rows sr
    JOIN scrub_jobs j ON j.id = sr.job_id
    JOIN campaigns c ON c.id = j.campaign_id
    JOIN campaign_versions cv ON cv.id = j.campaign_version_id
    JOIN files f ON f.id = j.input_file_id
    JOIN users u ON u.id = j.uploaded_by
    WHERE sr.phone_hash = ?`;
  if (actor.role === 'agent') {
    jobSql += ' AND j.uploaded_by = ?';
    params.push(actor.id);
  }
  jobSql += ' ORDER BY j.created_at DESC, sr.source_row_number ASC LIMIT 100';

  const jobs = await queryRaw(jobSql, params);

  await audit.write({
    requestId,
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'PHONE_SEARCHED',
    entityType: 'phone',
    description: `${actor.email || actor.id} searched a phone number`,
    metadata: { last4: parsed.last4, resultJobs: jobs.length, resultCampaigns: campaigns.length },
    ipAddress: ip,
    userAgent,
  });

  const uploads = jobs.map((row) => {
    let phone = displayPhone(row.normalized_phone_encrypted, row.original_phone_encrypted, row.phone_last4);
    if (actor.role !== 'admin') phone = maskForAgent(phone);
    return {
      jobId: row.job_id,
      jobNumber: row.job_number,
      campaignName: row.campaign_name,
      versionNumber: row.version_number,
      filename: row.original_filename,
      sourceRow: row.source_row_number,
      status: row.invalid_reason === 'already_present' ? 'already_present' : row.status,
      invalidReason: row.invalid_reason,
      duplicateOfRow: row.duplicate_of_row,
      uploadedAt: row.created_at,
      processedAt: row.processed_at,
      uploadedIp: row.created_ip,
      agent: {
        id: row.agent_id,
        name: `${row.first_name} ${row.last_name}`,
        email: row.email,
      },
      phone,
      lead: actor.role === 'admin' ? row.original_row_data : null,
    };
  });

  return {
    query: queryText,
    normalized: actor.role === 'admin' ? parsed.normalized : null,
    national: actor.role === 'admin' ? parsed.national : `******${parsed.last4}`,
    last4: parsed.last4,
    inMasterLists: campaigns.length > 0,
    campaigns,
    uploads,
    stats: {
      total: uploads.length,
      unique: uploads.length || campaigns.length ? 1 : 0,
      alreadyPresent: campaigns.length,
    },
  };
}

async function listAgentUploads({ actor, agentId, phone, status, pagination }) {
  const where = ['1=1'];
  const params = [];

  if (actor.role !== 'admin') {
    where.push('j.uploaded_by = ?');
    params.push(actor.id);
  } else if (agentId) {
    where.push('j.uploaded_by = ?');
    params.push(agentId);
  }

  if (phone) {
    const parsed = processPhone(phone, 'US');
    if (parsed.valid) {
      where.push('sr.phone_hash = ?');
      params.push(parsed.phoneHash);
    } else if (/^\d{4}$/.test(String(phone).trim())) {
      where.push('sr.phone_last4 = ?');
      params.push(String(phone).trim());
    } else {
      throw new AppError('INVALID_PHONE', 'Enter a full US number or a 4-digit last-4 filter.', 400);
    }
  }
  if (status) {
    where.push('sr.status = ?');
    params.push(status);
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const count = await query(
    `SELECT
            COUNT(*) AS total,
            0 AS unique_count,
            0 AS already_present
     FROM scrub_rows sr
     JOIN scrub_jobs j ON j.id = sr.job_id
     ${clause}`,
    params
  );

  const items = await queryRaw(
    `SELECT sr.source_row_number, sr.status, sr.invalid_reason, sr.processed_at,
            sr.original_phone_encrypted, sr.normalized_phone_encrypted, sr.phone_last4,
            j.id AS job_id, j.job_number, j.created_at, j.created_ip,
            c.name AS campaign_name, cv.version_number, f.original_filename,
            u.first_name, u.last_name, u.email, u.id AS agent_id
     FROM scrub_rows sr
     JOIN scrub_jobs j ON j.id = sr.job_id
     JOIN campaigns c ON c.id = j.campaign_id
     JOIN campaign_versions cv ON cv.id = j.campaign_version_id
     JOIN files f ON f.id = j.input_file_id
     JOIN users u ON u.id = j.uploaded_by
     ${clause}
     ORDER BY j.created_at DESC, sr.source_row_number ASC
     ${sqlLimit(pagination)}`,
    params
  );

  return {
    total: count[0].total,
    stats: {
      total: Number(count[0].total || 0),
      unique: Number(count[0].unique_count || 0),
      alreadyPresent: Number(count[0].already_present || 0),
    },
    items: items.map((row) => ({
      jobId: row.job_id,
      jobNumber: row.job_number,
      campaignName: row.campaign_name,
      versionNumber: row.version_number,
      filename: row.original_filename,
      sourceRow: row.source_row_number,
      status: row.invalid_reason === 'already_present' ? 'already_present' : row.status,
      invalidReason: row.invalid_reason,
      uploadedAt: row.created_at,
      processedAt: row.processed_at,
      uploadedIp: row.created_ip,
      agent: {
        id: row.agent_id,
        name: `${row.first_name} ${row.last_name}`,
        email: row.email,
      },
      phone: displayPhone(row.normalized_phone_encrypted, row.original_phone_encrypted, row.phone_last4),
    })),
  };
}

async function listJobRows({ actor, jobId, phone, status, pagination }) {
  const jobs = await query(`SELECT id, uploaded_by FROM scrub_jobs WHERE id = ?`, [jobId]);
  if (!jobs.length) throw new AppError('JOB_NOT_FOUND', 'Scrub job not found.', 404);
  if (actor.role !== 'admin' && jobs[0].uploaded_by !== actor.id) {
    throw new AppError('FORBIDDEN', 'You cannot view another agent\'s job rows.', 403);
  }

  const where = ['sr.job_id = ?'];
  const params = [jobId];
  if (status) {
    where.push('sr.status = ?');
    params.push(status);
  }
  if (phone) {
    const parsed = processPhone(phone, 'US');
    if (parsed.valid) {
      where.push('sr.phone_hash = ?');
      params.push(parsed.phoneHash);
    } else if (/^\d{4}$/.test(String(phone).trim())) {
      where.push('sr.phone_last4 = ?');
      params.push(String(phone).trim());
    }
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const count = await query(`SELECT COUNT(*) AS total FROM scrub_rows sr ${clause}`, params);
  const items = await queryRaw(
    `SELECT sr.source_row_number, sr.status, sr.invalid_reason, sr.duplicate_of_row,
            sr.processed_at, sr.original_phone_encrypted, sr.normalized_phone_encrypted, sr.phone_last4,
            sr.matched_campaign_number_id, j.created_ip, c.name AS matched_campaign_name
     FROM scrub_rows sr
     JOIN scrub_jobs j ON j.id = sr.job_id
     LEFT JOIN campaign_numbers cn ON cn.id = sr.matched_campaign_number_id
     LEFT JOIN campaign_versions cv ON cv.id = cn.campaign_version_id
     LEFT JOIN campaigns c ON c.id = cv.campaign_id
     ${clause}
     ORDER BY sr.source_row_number
     ${sqlLimit(pagination)}`,
    params
  );

  return {
    total: count[0].total,
    items: items.map((row) => {
      let phoneInfo = displayPhone(row.normalized_phone_encrypted, row.original_phone_encrypted, row.phone_last4);
      if (actor.role !== 'admin') phoneInfo = maskForAgent(phoneInfo);
      return {
        sourceRow: row.source_row_number,
        status: row.invalid_reason === 'already_present' ? 'already_present' : row.status,
        invalidReason: row.invalid_reason,
        duplicateOfRow: row.duplicate_of_row,
        processedAt: row.processed_at,
        uploadedIp: row.created_ip,
        matchedCampaignName: row.matched_campaign_name || null,
        phone: phoneInfo,
      };
    }),
  };
}

module.exports = { searchPhone, listAgentUploads, listJobRows };
