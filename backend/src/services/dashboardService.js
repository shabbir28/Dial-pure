'use strict';

const { queryRaw } = require('../config/database');

function n(value) {
  return Number(value || 0);
}

function deltaPct(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

async function adminDashboard() {
  const [campaigns] = await queryRaw(
    `SELECT
       COUNT(*) AS total_campaigns,
       SUM(status = 'active') AS active_campaigns
     FROM campaigns`
  );
  const [agents] = await queryRaw(
    `SELECT COUNT(*) AS total_agents FROM users WHERE role = 'agent'`
  );
  const [today] = await queryRaw(
    `SELECT
       COUNT(*) AS uploads_today,
       COALESCE(SUM(total_rows), 0) AS numbers_today,
       COALESCE(SUM(clean_count), 0) AS clean_today,
       COALESCE(SUM(matched_count), 0) AS matched_today,
       COALESCE(SUM(invalid_count), 0) AS invalid_today,
       COALESCE(SUM(duplicate_count), 0) AS duplicate_today,
       SUM(status = 'failed') AS failed_today
     FROM scrub_jobs
     WHERE created_at >= UTC_DATE()`
  );
  const [yesterday] = await queryRaw(
    `SELECT
       COUNT(*) AS uploads,
       COALESCE(SUM(total_rows), 0) AS numbers,
       COALESCE(SUM(clean_count), 0) AS clean,
       COALESCE(SUM(matched_count), 0) AS matched
     FROM scrub_jobs
     WHERE created_at >= DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)
       AND created_at < UTC_DATE()`
  );
  const [lifetime] = await queryRaw(
    `SELECT
       COUNT(*) AS jobs,
       COALESCE(SUM(total_rows), 0) AS numbers,
       COALESCE(SUM(clean_count), 0) AS clean,
       COALESCE(SUM(matched_count), 0) AS matched,
       COALESCE(SUM(invalid_count), 0) AS invalid,
       COALESCE(SUM(duplicate_count), 0) AS duplicate
     FROM scrub_jobs`
  );
  const [failedOpen] = await queryRaw(
    `SELECT COUNT(*) AS failed_jobs FROM scrub_jobs WHERE status = 'failed'`
  );
  const [downloadsToday] = await queryRaw(
    `SELECT COUNT(*) AS c FROM download_events WHERE downloaded_at >= UTC_DATE()`
  );
  const [activeVersions] = await queryRaw(
    `SELECT COUNT(*) AS c FROM campaign_versions WHERE status = 'active'`
  );

  // Internal list aggregate stats
  const [salesStats] = await queryRaw(
    `SELECT COUNT(*) AS list_count, COALESCE(SUM(unique_numbers), 0) AS total_unique
     FROM internal_list_versions WHERE list_type = 'sales' AND status = 'active'`
  );
  const [suppStats] = await queryRaw(
    `SELECT COUNT(*) AS list_count, COALESCE(SUM(unique_numbers), 0) AS total_unique
     FROM internal_list_versions WHERE list_type = 'suppression' AND status = 'active'`
  );

  // Campaign-specific internal lists (ACA & Medicare)
  const campaignListsRows = await queryRaw(
    `SELECT
       c.id AS campaign_id,
       c.name AS campaign_name,
       c.campaign_code,
       ilv.list_type,
       COALESCE(SUM(ilv.unique_numbers), 0) AS total_unique
     FROM campaigns c
     LEFT JOIN internal_list_versions ilv ON ilv.campaign_id = c.id AND ilv.status = 'active'
     WHERE c.status != 'archived'
     GROUP BY c.id, c.name, c.campaign_code, ilv.list_type`
  );

  const campaignLists = {};
  for (const row of campaignListsRows) {
    const code = (row.campaign_code || '').toUpperCase();
    const name = (row.campaign_name || '').toUpperCase();
    const key = name.includes('ACA') || code.includes('ACA') ? 'aca'
      : name.includes('MEDICARE') || code.includes('MEDICARE') ? 'medicare'
      : row.campaign_id;

    if (!campaignLists[key]) {
      campaignLists[key] = {
        id: row.campaign_id,
        name: row.campaign_name,
        code: row.campaign_code,
        sales: 0,
        suppression: 0,
      };
    }
    const val = Number(row.total_unique || 0);
    if (row.list_type === 'sales') {
      campaignLists[key].sales += val;
    } else if (row.list_type === 'suppression') {
      campaignLists[key].suppression += val;
    }
  }

  const acaData = campaignLists['aca'] || { name: 'ACA', code: 'CAMP-1', sales: 0, suppression: 0 };
  const medicareData = campaignLists['medicare'] || { name: 'Medicare', code: 'CAMP-3', sales: 0, suppression: 0 };
  const acaTotal = acaData.sales + acaData.suppression;
  const medicareTotal = medicareData.sales + medicareData.suppression;

  // Global DNC/Dead stats
  const globalDncRows = await queryRaw(
    `SELECT unique_numbers, total_rows, status, version_number, created_at, activated_at
     FROM global_dnc_dead_versions
     WHERE status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`
  );
  const globalDncStats = globalDncRows.length ? globalDncRows[0] : null;

  const recent = await queryRaw(
    `SELECT j.id, j.job_number, j.status, j.total_rows, j.clean_count, j.matched_count,
            j.invalid_count, j.duplicate_count, j.created_at, j.started_at, j.completed_at,
            j.processing_percentage, c.name AS campaign_name, cv.version_number,
            f.original_filename, u.first_name, u.last_name
     FROM scrub_jobs j
     JOIN campaigns c ON c.id = j.campaign_id
     JOIN campaign_versions cv ON cv.id = j.campaign_version_id
     JOIN files f ON f.id = j.input_file_id
     JOIN users u ON u.id = j.uploaded_by
     ORDER BY j.created_at DESC
     LIMIT 12`
  );
  const trend = await queryRaw(
    `SELECT DATE_FORMAT(created_at, '%b %d') AS day,
            COUNT(*) AS jobs,
            COALESCE(SUM(total_rows), 0) AS total,
            COALESCE(SUM(clean_count), 0) AS clean,
            COALESCE(SUM(matched_count), 0) AS matched,
            COALESCE(SUM(invalid_count), 0) AS invalid,
            COALESCE(SUM(duplicate_count), 0) AS duplicate
     FROM scrub_jobs
     WHERE created_at >= DATE_SUB(UTC_DATE(), INTERVAL 13 DAY)
     GROUP BY DATE(created_at), DATE_FORMAT(created_at, '%b %d')
     ORDER BY DATE(created_at)`
  );
  const byCampaign = await queryRaw(
    `SELECT c.name AS campaign_name,
            COUNT(j.id) AS jobs,
            COALESCE(SUM(j.total_rows), 0) AS total,
            COALESCE(SUM(j.clean_count), 0) AS clean,
            COALESCE(SUM(j.matched_count), 0) AS matched,
            COALESCE(SUM(j.invalid_count), 0) AS invalid,
            COALESCE(SUM(j.duplicate_count), 0) AS duplicate
     FROM campaigns c
     LEFT JOIN scrub_jobs j ON j.campaign_id = c.id
     GROUP BY c.id, c.name
     ORDER BY total DESC
     LIMIT 8`
  );
  const statusBreakdown = await queryRaw(
    `SELECT status AS name, COUNT(*) AS value
     FROM scrub_jobs
     GROUP BY status`
  );
  const byAgent = await queryRaw(
    `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name, u.email,
            COUNT(j.id) AS jobs,
            COALESCE(SUM(j.total_rows), 0) AS total,
            COALESCE(SUM(j.clean_count), 0) AS clean,
            COALESCE(SUM(j.matched_count), 0) AS matched
     FROM users u
     LEFT JOIN scrub_jobs j ON j.uploaded_by = u.id
     WHERE u.role = 'agent'
     GROUP BY u.id, u.first_name, u.last_name, u.email
     ORDER BY total DESC`
  );

  const stats = {
    totalCampaigns: n(campaigns.total_campaigns),
    activeCampaigns: n(campaigns.active_campaigns),
    totalAgents: n(agents.total_agents),
    uploadsToday: n(today.uploads_today),
    numbersToday: n(today.numbers_today),
    cleanToday: n(today.clean_today),
    matchedToday: n(today.matched_today),
    invalidToday: n(today.invalid_today),
    duplicateToday: n(today.duplicate_today),
    failedJobs: n(failedOpen.failed_jobs),
    downloadsToday: n(downloadsToday.c),
    activeVersions: n(activeVersions.c),
    lifetimeJobs: n(lifetime.jobs),
    lifetimeNumbers: n(lifetime.numbers),
    lifetimeClean: n(lifetime.clean),
    lifetimeMatched: n(lifetime.matched),
    lifetimeInvalid: n(lifetime.invalid),
    lifetimeDuplicate: n(lifetime.duplicate),
    salesTotalNumbers: n(salesStats.total_unique),
    suppTotalNumbers: n(suppStats.total_unique),
    acaSalesNumbers: acaData.sales,
    acaSuppNumbers: acaData.suppression,
    acaTotalNumbers: acaTotal,
    medicareSalesNumbers: medicareData.sales,
    medicareSuppNumbers: medicareData.suppression,
    medicareTotalNumbers: medicareTotal,
    globalDncUniqueNumbers: n(globalDncStats ? globalDncStats.unique_numbers : 0),
    globalDncActive: !!(globalDncStats),
    globalDncVersion: globalDncStats ? globalDncStats.version_number : null,
  };

  const cleanRateLifetime = stats.lifetimeNumbers > 0
    ? ((stats.lifetimeClean / stats.lifetimeNumbers) * 100).toFixed(1)
    : '0.0';
  const matchRateLifetime = stats.lifetimeNumbers > 0
    ? ((stats.lifetimeMatched / stats.lifetimeNumbers) * 100).toFixed(1)
    : '0.0';

  const lifetimeKpis = [
    {
      key: 'lifetime_numbers',
      label: 'Lifetime Processed',
      icon: 'database',
      color: 'copper',
      value: stats.lifetimeNumbers,
      delta: 0,
      sub: `Across ${stats.lifetimeJobs} scrub jobs`,
    },
    {
      key: 'lifetime_clean',
      label: 'Lifetime Clean Leads',
      icon: 'check',
      color: 'success',
      value: stats.lifetimeClean,
      delta: 0,
      sub: `${cleanRateLifetime}% clean rate`,
    },
    {
      key: 'lifetime_matched',
      label: 'Lifetime Suppressed',
      icon: 'alert',
      color: 'danger',
      value: stats.lifetimeMatched,
      delta: 0,
      sub: `${matchRateLifetime}% suppression rate`,
    },
    {
      key: 'lifetime_jobs',
      label: 'Lifetime Scrub Jobs',
      icon: 'activity',
      color: 'purple',
      value: stats.lifetimeJobs,
      delta: 0,
      sub: stats.failedJobs > 0 ? `${stats.failedJobs} failed` : 'All successful',
    },
  ];

  const internalListKpis = [
    {
      key: 'global_dnc',
      label: 'Global DNC / Dead',
      icon: 'ban',
      color: 'danger',
      value: stats.globalDncUniqueNumbers,
      delta: 0,
      sub: stats.globalDncActive ? `v${stats.globalDncVersion} active (Universal)` : 'No list uploaded',
    },
    {
      key: 'sales',
      label: 'Sales Numbers',
      icon: 'dollar',
      color: 'purple',
      value: stats.salesTotalNumbers,
      delta: 0,
      sub: 'Across all campaigns',
    },
    {
      key: 'suppression',
      label: 'Suppression Numbers',
      icon: 'shield',
      color: 'stone',
      value: stats.suppTotalNumbers,
      delta: 0,
      sub: 'Across all campaigns',
    },
    {
      key: 'aca_lists',
      label: 'ACA Campaign',
      badge: acaData.code || 'CAMP-1',
      icon: 'layers',
      color: 'forest',
      value: acaTotal,
      delta: 0,
      sub: `Sales: ${acaData.sales.toLocaleString()} · Supp: ${acaData.suppression.toLocaleString()}`,
      breakdown: {
        sales: acaData.sales,
        suppression: acaData.suppression,
      },
    },
    {
      key: 'medicare_lists',
      label: 'Medicare Campaign',
      badge: medicareData.code || 'CAMP-3',
      icon: 'sky',
      color: 'sky',
      value: medicareTotal,
      delta: 0,
      sub: `Sales: ${medicareData.sales.toLocaleString()} · Supp: ${medicareData.suppression.toLocaleString()}`,
      breakdown: {
        sales: medicareData.sales,
        suppression: medicareData.suppression,
      },
    },
  ];

  const todayKpis = [
    {
      key: 'numbers_today',
      label: 'Numbers Today',
      icon: 'hash',
      color: 'copper',
      value: stats.numbersToday,
      delta: deltaPct(stats.numbersToday, n(yesterday.numbers)),
      sub: 'Total processed today',
    },
    {
      key: 'clean_today',
      label: 'Clean Today',
      icon: 'check',
      color: 'success',
      value: stats.cleanToday,
      delta: deltaPct(stats.cleanToday, n(yesterday.clean)),
      sub: 'Passed all checks',
    },
    {
      key: 'matched_today',
      label: 'Matched Today',
      icon: 'alert',
      color: 'warn',
      value: stats.matchedToday,
      delta: deltaPct(stats.matchedToday, n(yesterday.matched)),
      sub: 'Suppressed numbers',
    },
    {
      key: 'uploads_today',
      label: 'Uploads Today',
      icon: 'upload',
      color: 'forest',
      value: stats.uploadsToday,
      delta: deltaPct(stats.uploadsToday, n(yesterday.uploads)),
      sub: 'Scrub jobs started',
    },
    {
      key: 'campaigns',
      label: 'Active Campaigns',
      icon: 'megaphone',
      color: 'sky',
      value: stats.activeCampaigns,
      delta: 0,
      sub: `of ${stats.totalCampaigns} total`,
    },
    {
      key: 'agents',
      label: 'Total Agents',
      icon: 'users',
      color: 'indigo',
      value: stats.totalAgents,
      delta: 0,
      sub: 'Registered agents',
    },
  ];

  return {
    refreshedAt: new Date().toISOString(),
    stats,
    lifetimeKpis,
    internalListKpis,
    todayKpis,
    kpis: [...lifetimeKpis, ...internalListKpis, ...todayKpis],
    recentJobs: recent,
    trend,
    byCampaign,
    statusBreakdown,
    byAgent,
  };
}

async function agentDashboard(userId) {
  const [today] = await queryRaw(
    `SELECT
       COUNT(*) AS uploads_today,
       COALESCE(SUM(total_rows), 0) AS numbers_today,
       COALESCE(SUM(clean_count), 0) AS clean_today,
       COALESCE(SUM(matched_count), 0) AS matched_today,
       COALESCE(SUM(invalid_count), 0) AS invalid_today,
       COALESCE(SUM(duplicate_count), 0) AS duplicate_today
     FROM scrub_jobs
     WHERE uploaded_by = ? AND created_at >= UTC_DATE()`,
    [userId]
  );
  const [lifetime] = await queryRaw(
    `SELECT
       COUNT(*) AS jobs,
       COALESCE(SUM(total_rows), 0) AS numbers,
       COALESCE(SUM(clean_count), 0) AS clean,
       COALESCE(SUM(matched_count), 0) AS matched
     FROM scrub_jobs WHERE uploaded_by = ?`,
    [userId]
  );
  const campaigns = await queryRaw(
    `SELECT c.id, c.name, c.campaign_code,
            cv.version_number, cv.unique_numbers
     FROM agent_campaign_access a
     JOIN campaigns c ON c.id = a.campaign_id
     LEFT JOIN campaign_versions cv ON cv.campaign_id = c.id AND cv.status = 'active'
     WHERE a.agent_id = ? AND a.is_active = 1 AND c.status = 'active'
     ORDER BY c.name`,
    [userId]
  );
  const recent = await queryRaw(
    `SELECT j.id, j.job_number, j.status, j.total_rows, j.clean_count, j.matched_count,
            j.invalid_count, j.duplicate_count, j.created_at, j.processing_percentage,
            c.name AS campaign_name, cv.version_number, f.original_filename
     FROM scrub_jobs j
     JOIN campaigns c ON c.id = j.campaign_id
     JOIN campaign_versions cv ON cv.id = j.campaign_version_id
     JOIN files f ON f.id = j.input_file_id
     WHERE j.uploaded_by = ?
     ORDER BY j.created_at DESC
     LIMIT 10`,
    [userId]
  );
  const trend = await queryRaw(
    `SELECT DATE_FORMAT(created_at, '%b %d') AS day,
            COUNT(*) AS jobs,
            COALESCE(SUM(total_rows), 0) AS total,
            COALESCE(SUM(clean_count), 0) AS clean,
            COALESCE(SUM(matched_count), 0) AS matched
     FROM scrub_jobs
     WHERE uploaded_by = ? AND created_at >= DATE_SUB(UTC_DATE(), INTERVAL 13 DAY)
     GROUP BY DATE(created_at), DATE_FORMAT(created_at, '%b %d')
     ORDER BY DATE(created_at)`,
    [userId]
  );
  const downloads = await queryRaw(
    `SELECT d.downloaded_at, e.export_type, e.id AS export_id, j.job_number, f.original_filename
     FROM download_events d
     JOIN exports e ON e.id = d.export_id
     JOIN scrub_jobs j ON j.id = d.job_id
     JOIN files f ON f.id = e.file_id
     WHERE d.downloaded_by = ?
     ORDER BY d.downloaded_at DESC
     LIMIT 10`,
    [userId]
  );
  return {
    stats: {
      uploadsToday: n(today.uploads_today),
      numbersToday: n(today.numbers_today),
      cleanToday: n(today.clean_today),
      matchedToday: n(today.matched_today),
      invalidToday: n(today.invalid_today),
      duplicateToday: n(today.duplicate_today),
      assignedCampaigns: campaigns.length,
      lifetimeJobs: n(lifetime.jobs),
      lifetimeNumbers: n(lifetime.numbers),
      lifetimeClean: n(lifetime.clean),
      lifetimeMatched: n(lifetime.matched),
    },
    campaigns,
    recentJobs: recent,
    downloads,
    trend,
  };
}

module.exports = { adminDashboard, agentDashboard };
