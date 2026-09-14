'use strict';

const dashboardService = require('../services/dashboardService');
const auditService = require('../services/auditService');
const settingsService = require('../services/settingsService');
const { success } = require('../utils/response');
const { parsePagination, paginated } = require('../utils/pagination');

async function admin(req, res, next) {
  try {
    success(res, await dashboardService.adminDashboard());
  } catch (error) {
    next(error);
  }
}

async function agent(req, res, next) {
  try {
    success(res, await dashboardService.agentDashboard(req.user.id));
  } catch (error) {
    next(error);
  }
}

async function auditLogs(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await auditService.list({
      ...pagination,
      actorUserId: req.query.actorUserId,
      action: req.query.action,
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      jobId: req.query.jobId,
    });
    success(res, paginated(result.items, result.total, pagination));
  } catch (error) {
    next(error);
  }
}

async function getSettings(req, res, next) {
  try {
    success(res, await settingsService.getAll());
  } catch (error) {
    next(error);
  }
}

async function updateSetting(req, res, next) {
  try {
    await settingsService.upsert({
      key: req.params.key,
      value: req.body.value,
      description: req.body.description,
      actorId: req.user.id,
    });
    success(res, await settingsService.getAll());
  } catch (error) {
    next(error);
  }
}

module.exports = { admin, agent, auditLogs, getSettings, updateSetting };
