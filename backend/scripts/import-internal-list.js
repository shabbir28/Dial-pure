'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const { query } = require('../src/config/database');
const storage = require('../src/services/storageService');
const { uuid } = require('../src/utils/ids');
const { processInternalList } = require('../src/workers/processors');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

function usage() {
  console.log(`
Usage:

node scripts/import-internal-list.js \\
  --campaign ACA \\
  --type dnc_dead \\
  --file /home/sbnr/imports/combined_dnc_dead_numbers.csv \\
  --phone-column phone \\
  --actor-email admin@example.com

Types:
  sales
  dnc_dead
  suppression
`);
}

async function main() {
  const campaignArg = arg('campaign');
  const listType = arg('type');
  const sourceFile = arg('file');
  const phoneColumn = arg('phone-column');
  const actorEmail = arg('actor-email');
  const actorIdArg = arg('actor-id');

  if (!campaignArg || !listType || !sourceFile || !phoneColumn) {
    usage();
    throw new Error(
      'Required: --campaign, --type, --file, --phone-column'
    );
  }

  if (!['sales', 'dnc_dead', 'suppression'].includes(listType)) {
    throw new Error(
      '--type must be sales, dnc_dead, or suppression'
    );
  }

  const absSource = path.resolve(sourceFile);

  if (!fs.existsSync(absSource)) {
    throw new Error(`Source file not found: ${absSource}`);
  }

  // ----------------------------------------------------------
  // Resolve campaign
  // ----------------------------------------------------------
  let campaigns;

  if (/^[0-9a-f-]{36}$/i.test(campaignArg)) {
    campaigns = await query(
      `SELECT id, name, status
       FROM campaigns
       WHERE id = ?
       LIMIT 1`,
      [campaignArg]
    );
  } else {
    campaigns = await query(
      `SELECT id, name, status
       FROM campaigns
       WHERE LOWER(name) = LOWER(?)
       LIMIT 1`,
      [campaignArg]
    );
  }

  if (!campaigns.length) {
    throw new Error(`Campaign not found: ${campaignArg}`);
  }

  const campaign = campaigns[0];

  if (campaign.status !== 'active') {
    throw new Error(
      `Campaign ${campaign.name} is not active`
    );
  }

  // ----------------------------------------------------------
  // Resolve actor
  // ----------------------------------------------------------
  let users;

  if (actorIdArg) {
    users = await query(
      `SELECT id, email
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [actorIdArg]
    );
  } else if (actorEmail) {
    users = await query(
      `SELECT id, email
       FROM users
       WHERE LOWER(email) = LOWER(?)
       LIMIT 1`,
      [actorEmail]
    );
  } else {
    throw new Error(
      'Provide --actor-email or --actor-id so the import has a valid owner'
    );
  }

  if (!users.length) {
    throw new Error('Actor user not found');
  }

  const actor = users[0];

  // ----------------------------------------------------------
  // Safety: CLI processor is a separate Node process.
  // Do not compete with live scrub/internal-list workers.
  // ----------------------------------------------------------
  const activeScrubs = await query(
    `SELECT job_number, status
     FROM scrub_jobs
     WHERE status IN (
       'queued',
       'validating',
       'processing',
       'generating_exports'
     )
     LIMIT 5`
  );

  if (activeScrubs.length) {
    console.error('\nActive scrub job(s) found:');
    for (const j of activeScrubs) {
      console.error(`  ${j.job_number} - ${j.status}`);
    }
    throw new Error(
      'Server-side internal-list import refused while scrub jobs are active'
    );
  }

  const activeLists = await query(
    `SELECT id, list_type, status
     FROM internal_list_versions
     WHERE status = 'processing'
     LIMIT 5`
  );

  if (activeLists.length) {
    console.error('\nActive internal-list import(s) found:');
    for (const l of activeLists) {
      console.error(`  ${l.id} - ${l.list_type} - ${l.status}`);
    }
    throw new Error(
      'Another internal-list import is already processing'
    );
  }

  // ----------------------------------------------------------
  // Determine extension / version
  // ----------------------------------------------------------
  const extension = path.extname(absSource)
    .replace(/^\./, '')
    .toLowerCase();

  if (!['csv', 'xlsx', 'xls'].includes(extension)) {
    throw new Error(
      `Unsupported file extension: ${extension}`
    );
  }

  const versions = await query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
     FROM internal_list_versions
     WHERE campaign_id = ?
       AND list_type = ?`,
    [campaign.id, listType]
  );

  const versionNumber =
    Number(versions[0].next_version || 1);

  // ----------------------------------------------------------
  // Preserve original file:
  // storage.saveFromPath() moves its input, so copy to /tmp first.
  // ----------------------------------------------------------
  const tmpPath = path.join(
    os.tmpdir(),
    `dialpure-${uuid()}.${extension}`
  );

  console.log(`Copying source file to temporary staging file...`);
  await fsp.copyFile(absSource, tmpPath);

  const stat = await fsp.stat(tmpPath);

  const stored = await storage.saveFromPath({
    sourcePath: tmpPath,
    folder: `campaigns/${campaign.id}/internal-lists/${listType}`,
    extension,
    size: stat.size,
  });

  const checksum = await storage.checksumFile(
    storage.absolutePath(stored.key)
  );

  // ----------------------------------------------------------
  // Create files record
  // ----------------------------------------------------------
  const fileId = uuid();

  await query(
    `INSERT INTO files (
       id,
       file_uuid,
       original_filename,
       stored_filename,
       storage_provider,
       storage_bucket,
       storage_key,
       file_type,
       mime_type,
       extension,
       file_size_bytes,
       checksum_sha256,
       uploaded_by,
       uploaded_ip,
       row_count,
       processing_status
     )
     VALUES (
       ?, ?, ?, ?, ?, ?, ?,
       'campaign_master',
       ?, ?, ?, ?, ?,
       '127.0.0.1',
       0,
       'processing'
     )`,
    [
      fileId,
      uuid(),
      path.basename(absSource),
      stored.storedFilename,
      stored.provider,
      stored.bucket,
      stored.key,
      extension === 'csv'
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension,
      stored.size,
      checksum,
      actor.id,
    ]
  );

  // ----------------------------------------------------------
  // Create internal-list version
  // ----------------------------------------------------------
  const versionId = uuid();

  await query(
    `INSERT INTO internal_list_versions (
       id,
       campaign_id,
       list_type,
       version_number,
       source_file_id,
       phone_column_name,
       status,
       created_by
     )
     VALUES (?, ?, ?, ?, ?, ?, 'processing', ?)`,
    [
      versionId,
      campaign.id,
      listType,
      versionNumber,
      fileId,
      phoneColumn,
      actor.id,
    ]
  );

  console.log('');
  console.log('Internal list created:');
  console.log(`  Campaign : ${campaign.name}`);
  console.log(`  Type     : ${listType}`);
  console.log(`  Version  : v${versionNumber}`);
  console.log(`  VersionID: ${versionId}`);
  console.log(`  File     : ${absSource}`);
  console.log('');
  console.log('Starting existing DialPure internal-list processor...');
  console.log('');

  try {
    await processInternalList({
      versionId,
      campaignId: campaign.id,
      listType,
      fileId,
      phoneColumn,
      actorId: actor.id,
      requestId: versionId,
    });
  } catch (error) {
    console.error('\nImport worker failed:', error.message);
    throw error;
  }

  const result = await query(
    `SELECT
       status,
       total_rows,
       processed_rows,
       valid_numbers,
       invalid_numbers,
       duplicate_numbers,
       unique_numbers,
       failure_reason
     FROM internal_list_versions
     WHERE id = ?`,
    [versionId]
  );

  console.log('');
  console.log('===== IMPORT RESULT =====');
  console.table(result);

  if (result[0]?.status !== 'active') {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`\nERROR: ${error.message}`);
    process.exitCode = 1;
  });
