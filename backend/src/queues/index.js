'use strict';

const { query } = require('../config/database');

const processors = {
  'scrub-job': (data) => require('../workers/processors').processScrubJob(data),
  'campaign-master': (data) => require('../workers/processors').processCampaignMaster(data),
  'internal-list': (data) => require('../workers/processors').processInternalList(data),
  'global-dnc': (data) => require('../workers/processors').processGlobalDnc(data),
};

// ------------------------------------------------------------
// Separate queue lanes
// ------------------------------------------------------------

// Internal/admin imports stay serial.
const importQueue = [];
let importDraining = false;

// User scrub jobs:
// - max 1 active scrub per user
// - different users may run in parallel
// - up to 10 different users at the same time
const scrubQueue = [];
const MAX_SCRUB_CONCURRENCY = 10;
let activeScrubJobs = 0;
const activeScrubUsers = new Set();

const queuedKeys = new Set();

function queueKey(name, data = {}) {
  if (name === 'scrub-job' && data.jobId) {
    return `${name}:${data.jobId}:${data.restart ? 'restart' : 'normal'}`;
  }

  if (name === 'internal-list' && data.versionId) {
    return `${name}:${data.versionId}`;
  }

  if (name === 'global-dnc' && data.versionId) {
    return `${name}:${data.versionId}`;
  }

  return null;
}

// ------------------------------------------------------------
// Serial import lane
// ------------------------------------------------------------
async function drainImportQueue() {
  if (importDraining) return;

  importDraining = true;

  while (importQueue.length) {
    const item = importQueue.shift();

    try {
      await processors[item.name](item.data);
    } catch (error) {
      console.error(`Job ${item.name} failed:`, error);
    } finally {
      if (item.key) queuedKeys.delete(item.key);
    }
  }

  importDraining = false;
}

// ------------------------------------------------------------
// Concurrent scrub lane
// ------------------------------------------------------------
function drainScrubQueue() {
  if (
    activeScrubJobs >= MAX_SCRUB_CONCURRENCY ||
    scrubQueue.length === 0
  ) {
    return;
  }

  // Pick the first queued job whose user does not already
  // have another scrub running.
  const index = scrubQueue.findIndex(
    (item) => item.ownerId && !activeScrubUsers.has(item.ownerId)
  );

  if (index === -1) {
    return;
  }

  const [item] = scrubQueue.splice(index, 1);

  activeScrubJobs += 1;
  activeScrubUsers.add(item.ownerId);

  Promise.resolve()
    .then(() => processors[item.name](item.data))
    .catch((error) => {
      console.error(`Job ${item.name} failed:`, error);
    })
    .finally(() => {
      activeScrubJobs -= 1;
      activeScrubUsers.delete(item.ownerId);

      if (item.key) {
        queuedKeys.delete(item.key);
      }

      setImmediate(drainScrubQueue);
    });

  // Fill remaining slots with jobs belonging to other users.
  setImmediate(drainScrubQueue);
}

async function enqueue(name, data) {
  if (!processors[name]) {
    throw new Error(`Unknown queue job: ${name}`);
  }

  const key = queueKey(name, data);

  if (key && queuedKeys.has(key)) {
    return false;
  }

  if (key) {
    queuedKeys.add(key);
  }

  let ownerId = null;

  if (name === 'scrub-job') {
    const rows = await query(
      `SELECT uploaded_by
       FROM scrub_jobs
       WHERE id = ?
       LIMIT 1`,
      [data.jobId]
    );

    if (!rows.length || !rows[0].uploaded_by) {
      if (key) queuedKeys.delete(key);
      throw new Error(`Could not resolve scrub owner for job ${data.jobId}`);
    }

    ownerId = rows[0].uploaded_by;
  }

  const item = { name, data, key, ownerId };

  if (name === 'scrub-job') {
    scrubQueue.push(item);
    setImmediate(drainScrubQueue);
  } else {
    importQueue.push(item);
    setImmediate(drainImportQueue);
  }

  return true;
}

async function initQueues() {
  console.log(
    `Background queues ready (scrub max=${MAX_SCRUB_CONCURRENCY}, per-user=1, imports serial).`
  );

  try {
    const unfinished = await query(
      `SELECT id, job_number, status
       FROM scrub_jobs
       WHERE status IN (
         'queued',
         'validating',
         'processing',
         'generating_exports'
       )
       ORDER BY created_at ASC`
    );

    if (unfinished.length) {
      console.log(
        `[Queue Recovery] Found ${unfinished.length} unfinished scrub job(s).`
      );
    }

    for (const job of unfinished) {
      console.log(
        `[Queue Recovery] Re-queueing ${job.job_number} from status ${job.status}`
      );

      await enqueue('scrub-job', {
        jobId: job.id,
        requestId: job.id,
        restart: true,
      });
    }

    const unfinishedLists = await query(
      `SELECT
         ilv.id,
         ilv.campaign_id,
         ilv.list_type,
         ilv.source_file_id,
         ilv.phone_column_name,
         ilv.created_by
       FROM internal_list_versions ilv
       WHERE ilv.status = 'processing'
         AND ilv.source_file_id IS NOT NULL
       ORDER BY ilv.created_at ASC`
    );

    if (unfinishedLists.length) {
      console.log(
        `[Queue Recovery] Found ${unfinishedLists.length} unfinished internal list(s).`
      );
    }

    for (const item of unfinishedLists) {
      console.log(
        `[Queue Recovery] Re-queueing internal list ${item.list_type} ${item.id}`
      );

      await enqueue('internal-list', {
        versionId: item.id,
        campaignId: item.campaign_id,
        listType: item.list_type,
        fileId: item.source_file_id,
        phoneColumn: item.phone_column_name || null,
        actorId: item.created_by,
        requestId: item.id,
      });
    }
    // Recover unfinished global DNC uploads
    const unfinishedGlobalDnc = await query(
      `SELECT id, source_file_id, phone_column_name, created_by
       FROM global_dnc_dead_versions
       WHERE status = 'processing'
         AND source_file_id IS NOT NULL
       ORDER BY created_at ASC`
    );

    if (unfinishedGlobalDnc.length) {
      console.log(`[Queue Recovery] Found ${unfinishedGlobalDnc.length} unfinished global DNC upload(s).`);
    }

    for (const item of unfinishedGlobalDnc) {
      console.log(`[Queue Recovery] Re-queueing global DNC ${item.id}`);
      await enqueue('global-dnc', {
        versionId: item.id,
        fileId: item.source_file_id,
        phoneColumn: item.phone_column_name || null,
        actorId: item.created_by,
        requestId: item.id,
      });
    }
  } catch (error) {
    console.error(
      '[Queue Recovery] Could not recover unfinished jobs:',
      error
    );
  }
}

module.exports = { enqueue, initQueues };
