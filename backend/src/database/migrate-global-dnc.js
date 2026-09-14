'use strict';

/**
 * Migration: Create global_dnc_dead_versions and global_dnc_dead_numbers tables.
 * These are campaign-independent global DNC/Dead lists that apply to ALL scrub jobs.
 * Run once: node src/database/migrate-global-dnc.js
 */

const { query } = require('../config/database');

async function run() {
  console.log('Running global DNC/Dead migration...');

  await query(`
    CREATE TABLE IF NOT EXISTS global_dnc_dead_versions (
      id CHAR(36) NOT NULL,
      version_number INT NOT NULL DEFAULT 1,
      source_file_id CHAR(36) NULL,
      phone_column_name VARCHAR(128) NULL,
      status ENUM('processing','active','inactive','failed') NOT NULL DEFAULT 'processing',
      total_rows BIGINT NOT NULL DEFAULT 0,
      processed_rows BIGINT NOT NULL DEFAULT 0,
      valid_numbers BIGINT NOT NULL DEFAULT 0,
      invalid_numbers BIGINT NOT NULL DEFAULT 0,
      duplicate_numbers BIGINT NOT NULL DEFAULT 0,
      unique_numbers BIGINT NOT NULL DEFAULT 0,
      failure_reason TEXT NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      activated_by CHAR(36) NULL,
      activated_at DATETIME NULL,
      deactivated_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_gdnc_status (status),
      KEY idx_gdnc_created (created_at),
      CONSTRAINT fk_gdnc_file FOREIGN KEY (source_file_id) REFERENCES files(id) ON DELETE SET NULL,
      CONSTRAINT fk_gdnc_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_gdnc_activated_by FOREIGN KEY (activated_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  global_dnc_dead_versions table created (or already exists).');

  await query(`
    CREATE TABLE IF NOT EXISTS global_dnc_dead_numbers (
      id BIGINT NOT NULL AUTO_INCREMENT,
      version_id CHAR(36) NOT NULL,
      phone_hash CHAR(64) NOT NULL,
      phone_last4 CHAR(4) NULL,
      country_code VARCHAR(8) NOT NULL DEFAULT 'US',
      source_row_number BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_gdnc_hash (version_id, phone_hash),
      KEY idx_gdnc_num_hash (phone_hash),
      KEY idx_gdnc_num_version (version_id),
      CONSTRAINT fk_gdnc_num_version FOREIGN KEY (version_id) REFERENCES global_dnc_dead_versions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  global_dnc_dead_numbers table created (or already exists).');

  console.log('Migration complete!');
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
