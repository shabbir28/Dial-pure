'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { uuid } = require('../utils/ids');
const settings = require('../services/settingsService');
const { processPhone } = require('../utils/phone');
const { parse } = require('csv-parse/sync');

const SAMPLE_CSV = path.resolve(__dirname, '../../../wc_db_download_1786022976186.csv');

async function seed() {
  await settings.seedDefaults();

  const existingAdmin = await query(
    `SELECT id FROM users WHERE email IN ('admin@scrubber.local', 'admin@gmail.com') AND role = 'admin' LIMIT 1`
  );
  let adminId = existingAdmin[0]?.id;
  const adminHash = await bcrypt.hash('admin123', 12);
  if (!adminId) {
    adminId = uuid();
    await query(
      `INSERT INTO users (id, user_code, username, first_name, last_name, email, password_hash, role, status)
       VALUES (?, ?, 'admin', 'System', 'Admin', 'admin@gmail.com', ?, 'admin', 'active')`,
      [adminId, 'ADM-1', adminHash]
    );
    console.log('Created admin: admin@gmail.com / admin123 (username: admin)');
  } else {
    await query(
      `UPDATE users SET username = 'admin', email = 'admin@gmail.com', password_hash = ?, status = 'active' WHERE id = ?`,
      [adminHash, adminId]
    );
    console.log('Updated admin: admin@gmail.com / admin123');
  }

  const existingAgent = await query(
    `SELECT id FROM users WHERE email IN ('agent@scrubber.local', 'agent@gmail.com') AND role = 'agent' LIMIT 1`
  );
  let agentId = existingAgent[0]?.id;
  const agentHash = await bcrypt.hash('agent123', 12);
  if (!agentId) {
    agentId = uuid();
    await query(
      `INSERT INTO users (id, user_code, username, first_name, last_name, email, password_hash, role, status, created_by)
       VALUES (?, ?, 'agent', 'John', 'Agent', 'agent@gmail.com', ?, 'agent', 'active', ?)`,
      [agentId, 'AGT-1', agentHash, adminId]
    );
    console.log('Created agent: agent@gmail.com / agent123 (username: agent)');
  } else {
    await query(
      `UPDATE users SET username = 'agent', email = 'agent@gmail.com', password_hash = ?, status = 'active' WHERE id = ?`,
      [agentHash, agentId]
    );
    console.log('Updated agent: agent@gmail.com / agent123');
  }

  const existingCampaign = await query(`SELECT id FROM campaigns WHERE campaign_code = ?`, ['CMP-MEDICARE']);
  let campaignId = existingCampaign[0]?.id;
  if (!campaignId) {
    campaignId = uuid();
    await query(
      `INSERT INTO campaigns (id, campaign_code, name, description, status, country_code, default_phone_country, created_by)
       VALUES (?, 'CMP-MEDICARE', 'Medicare Live Transfer', 'US Medicare live-transfer DNC/scrub list', 'active', 'US', 'US', ?)`,
      [campaignId, adminId]
    );
  }

  const access = await query(
    `SELECT id FROM agent_campaign_access WHERE campaign_id = ? AND agent_id = ?`,
    [campaignId, agentId]
  );
  if (!access.length) {
    await query(
      `INSERT INTO agent_campaign_access (id, campaign_id, agent_id, assigned_by, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [uuid(), campaignId, agentId, adminId]
    );
  }

  const versionExists = await query(
    `SELECT id FROM campaign_versions WHERE campaign_id = ? LIMIT 1`,
    [campaignId]
  );

  if (!versionExists.length && fs.existsSync(SAMPLE_CSV)) {
    console.log('Importing sample master list from wc_db_download_1786022976186.csv ...');
    const csv = fs.readFileSync(SAMPLE_CSV, 'utf8');
    const rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true, trim: true });
    const fileId = uuid();
    await query(
      `INSERT INTO files (
        id, file_uuid, original_filename, stored_filename, storage_provider, storage_key,
        file_type, mime_type, extension, file_size_bytes, checksum_sha256, uploaded_by,
        row_count, processing_status
      ) VALUES (?, ?, ?, ?, 'local', ?, 'campaign_master', 'text/csv', 'csv', ?, ?, ?, ?, 'ready')`,
      [
        fileId,
        uuid(),
        'wc_db_download_1786022976186.csv',
        'sample-medicare.csv',
        'seed/sample-medicare.csv',
        fs.statSync(SAMPLE_CSV).size,
        require('crypto').createHash('sha256').update(csv).digest('hex'),
        adminId,
        rows.length,
      ]
    );

    const versionId = uuid();
    await query(
      `INSERT INTO campaign_versions (
        id, campaign_id, version_number, source_file_id, status, created_by, activated_by, activated_at
      ) VALUES (?, ?, 1, ?, 'processing', ?, ?, NOW())`,
      [versionId, campaignId, fileId, adminId, adminId]
    );

    const seen = new Set();
    let valid = 0;
    let invalid = 0;
    let duplicate = 0;
    const pending = [];
    rows.forEach((row, index) => {
      const parsed = processPhone(row['Phone No'], 'US');
      if (!parsed.valid) {
        invalid += 1;
        return;
      }
      valid += 1;
      if (seen.has(parsed.phoneHash)) {
        duplicate += 1;
        return;
      }
      seen.add(parsed.phoneHash);
      pending.push([versionId, parsed.phoneHash, parsed.last4, 'US', index + 1]);
    });

    for (let i = 0; i < pending.length; i += 500) {
      const chunk = pending.slice(i, i + 500);
      const placeholders = chunk.map(() => '(?,?,?,?,?)').join(',');
      await require('../config/database').queryRaw(
        `INSERT IGNORE INTO campaign_numbers
         (campaign_version_id, phone_hash, phone_last4, country_code, source_row_number)
         VALUES ${placeholders}`,
        chunk.flat()
      );
    }

    await query(
      `UPDATE campaign_versions
       SET status = 'active', total_rows = ?, valid_numbers = ?, invalid_numbers = ?,
           duplicate_numbers = ?, unique_numbers = ?
       WHERE id = ?`,
      [rows.length, valid, invalid, duplicate, seen.size, versionId]
    );
    console.log(`Imported ${seen.size} unique hashed numbers into Medicare Version 1.`);
  }

  const aca = await query(`SELECT id FROM campaigns WHERE campaign_code = ?`, ['CMP-ACA']);
  if (!aca.length) {
    await query(
      `INSERT INTO campaigns (id, campaign_code, name, description, status, country_code, default_phone_country, created_by)
       VALUES (?, 'CMP-ACA', 'ACA Live Transfer', 'ACA live-transfer scrub list', 'active', 'US', 'US', ?)`,
      [uuid(), adminId]
    );
  }

  await require('../services/authService').assignSequentialUserCodes();
  console.log('Seed complete.');
  await require('../config/database').closePool();
  process.exit(0);
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
