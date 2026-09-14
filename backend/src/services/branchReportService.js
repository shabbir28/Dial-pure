'use strict';

const { query, queryRaw } = require('../config/database');
const { AppError } = require('../utils/response');

function n(value) {
  return Number(value || 0);
}

async function getBranchReport(userId) {
  const users = await query(
    `SELECT id, user_code, first_name, last_name, email, role, status, last_login_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  if (!users.length) {
    throw new AppError('USER_NOT_FOUND', 'User not found.', 404);
  }

  const user = users[0];

  /*
   * Job totals are kept separate from scrub_rows so joining millions of rows
   * cannot inflate SUM() values.
   */
  const totalsRows = await query(
    `SELECT
       COUNT(*) AS files_uploaded,
       COALESCE(SUM(total_rows), 0) AS total_rows,
       COALESCE(SUM(clean_count), 0) AS clean_count,
       COALESCE(SUM(matched_count), 0) AS matched_count,
       COALESCE(SUM(external_match_count), 0) AS external_match_count,
       COALESCE(SUM(invalid_count), 0) AS invalid_count,
       COALESCE(SUM(duplicate_count), 0) AS duplicate_count
     FROM scrub_jobs
     WHERE uploaded_by = ?`,
    [userId]
  );

  /*
   * True DISTINCT phone count across ALL files uploaded by this branch/user.
   * This is reporting only. It does NOT suppress future files.
   */
  const uniqueRows = await query(
    `SELECT COUNT(DISTINCT sr.phone_hash) AS unique_numbers
     FROM scrub_rows sr
     INNER JOIN scrub_jobs j ON j.id = sr.job_id
     WHERE j.uploaded_by = ?
       AND sr.phone_hash IS NOT NULL`,
    [userId]
  );

  const jobs = await queryRaw(
    `SELECT
       j.id,
       j.job_number,
       j.status,
       j.total_rows,
       j.clean_count,
       j.matched_count,
       j.external_match_count,
       j.invalid_count,
       j.duplicate_count,
       j.processing_percentage,
       j.created_at,
       j.started_at,
       j.completed_at,
       c.name AS campaign_name,
       c.campaign_code,
       cv.version_number,
       f.original_filename,
       (
         SELECT COUNT(DISTINCT sr.phone_hash)
         FROM scrub_rows sr
         WHERE sr.job_id = j.id
           AND sr.phone_hash IS NOT NULL
       ) AS unique_numbers
     FROM scrub_jobs j
     INNER JOIN campaigns c ON c.id = j.campaign_id
     INNER JOIN campaign_versions cv ON cv.id = j.campaign_version_id
     INNER JOIN files f ON f.id = j.input_file_id
     WHERE j.uploaded_by = ?
     ORDER BY j.created_at DESC`,
    [userId]
  );

  const exports = await queryRaw(
    `SELECT
       e.id,
       e.job_id,
       e.export_type,
       e.row_count,
       e.download_count,
       e.generated_at,
       e.last_downloaded_at,
       f.original_filename
     FROM exports e
     INNER JOIN scrub_jobs j ON j.id = e.job_id
     INNER JOIN files f ON f.id = e.file_id
     WHERE j.uploaded_by = ?
     ORDER BY e.generated_at DESC`,
    [userId]
  );

  const exportsByJob = {};

  for (const exp of exports) {
    if (!exportsByJob[exp.job_id]) {
      exportsByJob[exp.job_id] = [];
    }

    exportsByJob[exp.job_id].push(exp);
  }

  const jobsWithExports = jobs.map((job) => ({
    ...job,
    total_rows: n(job.total_rows),
    unique_numbers: n(job.unique_numbers),
    clean_count: n(job.clean_count),
    matched_count: n(job.matched_count),
    external_match_count: n(job.external_match_count),
    invalid_count: n(job.invalid_count),
    duplicate_count: n(job.duplicate_count),
    exports: exportsByJob[job.id] || [],
  }));

  const totals = totalsRows[0] || {};

  return {
    user,
    summary: {
      files_uploaded: n(totals.files_uploaded),
      total_rows: n(totals.total_rows),
      unique_numbers: n(uniqueRows[0]?.unique_numbers),
      clean_count: n(totals.clean_count),
      matched_count: n(totals.matched_count),
      external_match_count: n(totals.external_match_count),
      invalid_count: n(totals.invalid_count),
      duplicate_count: n(totals.duplicate_count),
    },
    jobs: jobsWithExports,
  };
}

module.exports = {
  getBranchReport,
};
