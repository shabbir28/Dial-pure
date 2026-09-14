'use strict';

/**
 * Migration Script: Migrate existing DNC/Dead numbers from internal_list_numbers
 * into the new global_dnc_dead_versions and global_dnc_dead_numbers tables.
 *
 * This ensures the user does not lose their existing 5.8M+ DNC/Dead numbers.
 * Safe to run; copies numbers in chunks using direct server-side SQL queries.
 */

const crypto = require('crypto');
const { query } = require('../config/database');

async function migrate() {
  console.log('=== Starting DNC/Dead Migration to Global Module ===');

  // 1. Check if an active global version already exists
  const existingActive = await query(
    `SELECT id, version_number, unique_numbers FROM global_dnc_dead_versions WHERE status = 'active' LIMIT 1`
  );
  if (existingActive.length > 0 && existingActive[0].unique_numbers > 0) {
    console.log(`Global active DNC already exists: Version ${existingActive[0].version_number} with ${existingActive[0].unique_numbers} numbers.`);
    console.log('No migration needed or already migrated.');
    return;
  }

  // Clear any failed or incomplete versions before starting fresh
  await query(`DELETE FROM global_dnc_dead_versions WHERE status != 'active'`);

  // 2. Find active dnc_dead version from internal_list_versions
  const oldActiveVersions = await query(
    `SELECT * FROM internal_list_versions WHERE list_type = 'dnc_dead' AND status = 'active' ORDER BY created_at DESC LIMIT 1`
  );

  if (oldActiveVersions.length === 0) {
    console.log('No active dnc_dead version found in internal_list_versions.');
    return;
  }

  const oldVersion = oldActiveVersions[0];
  console.log(`Found active dnc_dead list: ID=${oldVersion.id}, unique_numbers=${oldVersion.unique_numbers}, total_rows=${oldVersion.total_rows}`);

  // 3. Create global_dnc_dead_versions entry in 'processing' state with source_file_id = NULL
  // Setting source_file_id to NULL prevents queue recovery from treating it as an uploaded file job
  const newVersionId = crypto.randomUUID();
  await query(
    `INSERT INTO global_dnc_dead_versions (
      id, version_number, source_file_id, phone_column_name, status,
      total_rows, processed_rows, valid_numbers, invalid_numbers, duplicate_numbers,
      unique_numbers, created_by, created_at
    ) VALUES (?, 1, NULL, ?, 'processing', ?, 0, ?, ?, ?, 0, ?, ?)`,
    [
      newVersionId,
      oldVersion.phone_column_name || 'phone',
      oldVersion.total_rows || oldVersion.valid_numbers || 0,
      oldVersion.valid_numbers || 0,
      oldVersion.invalid_numbers || 0,
      oldVersion.duplicate_numbers || 0,
      oldVersion.created_by || null,
      oldVersion.created_at || new Date()
    ]
  );
  console.log(`Created global_dnc_dead_versions record: ID=${newVersionId}`);

  // 4. Get min and max id in internal_list_numbers for this old version
  const [range] = await query(
    `SELECT MIN(id) AS min_id, MAX(id) AS max_id, COUNT(*) AS count
     FROM internal_list_numbers
     WHERE list_version_id = ?`,
    [oldVersion.id]
  );

  console.log(`Numbers to copy: ${range.count} rows (ID range: ${range.min_id} - ${range.max_id})`);

  const minId = range.min_id;
  const maxId = range.max_id;
  const CHUNK_SIZE = 200000;
  let copied = 0;

  if (minId && maxId) {
    for (let currentMin = minId; currentMin <= maxId; currentMin += CHUNK_SIZE) {
      const currentMax = currentMin + CHUNK_SIZE;
      const startTime = Date.now();

      await query(
        `INSERT IGNORE INTO global_dnc_dead_numbers (
          version_id, phone_hash, phone_last4, country_code, source_row_number, created_at
        )
        SELECT ?, phone_hash, phone_last4, country_code, source_row_number, created_at
        FROM internal_list_numbers FORCE INDEX (PRIMARY)
        WHERE id >= ? AND id < ? AND list_version_id = ?`,
        [newVersionId, currentMin, currentMax, oldVersion.id]
      );

      copied += Math.min(CHUNK_SIZE, maxId - currentMin + 1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`  Copied IDs ${currentMin}..${currentMax} in ${elapsed}s (Approx progress: ${Math.min(copied, range.count)} / ${range.count})`);
    }
  }

  // 5. Verify actual copied count
  const [actual] = await query(
    `SELECT COUNT(*) AS total_count
     FROM global_dnc_dead_numbers
     WHERE version_id = ?`,
    [newVersionId]
  );

  console.log(`Copied complete: Total=${actual.total_count}`);

  // 6. Activate the global version and link source_file_id
  await query(
    `UPDATE global_dnc_dead_versions
     SET status = 'active',
         source_file_id = ?,
         processed_rows = ?,
         unique_numbers = ?,
         valid_numbers = ?,
         activated_by = ?,
         activated_at = NOW()
     WHERE id = ?`,
    [
      oldVersion.source_file_id || null,
      actual.total_count,
      actual.total_count,
      actual.total_count,
      oldVersion.created_by || null,
      newVersionId
    ]
  );

  console.log(`=== Global DNC Version 1 Activated Successfully with ${actual.total_count} numbers! ===`);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
