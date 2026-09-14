'use strict';

const lookupService = require('../services/lookupService');
const { success } = require('../utils/response');
const { parsePagination, paginated } = require('../utils/pagination');

function ctx(req) {
  return {
    ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
    userAgent: req.headers['user-agent'],
    requestId: req.requestId,
  };
}

async function search(req, res, next) {
  try {
    const queryText = req.query.q || req.query.phone;
    if (!queryText) {
      const { AppError } = require('../utils/response');
      throw new AppError('PHONE_REQUIRED', 'Enter a phone number to search.', 400);
    }
    const result = await lookupService.searchPhone({
      queryText,
      actor: req.user,
      ...ctx(req),
    });
    success(res, result);
  } catch (error) {
    next(error);
  }
}

async function uploads(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await lookupService.listAgentUploads({
      actor: req.user,
      agentId: req.query.agentId || undefined,
      phone: req.query.phone || req.query.q || undefined,
      status: req.query.status || undefined,
      pagination,
    });
    success(res, {
      ...paginated(result.items, result.total, pagination),
      stats: result.stats,
    });
  } catch (error) {
    next(error);
  }
}

async function jobRows(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await lookupService.listJobRows({
      actor: req.user,
      jobId: req.params.id,
      phone: req.query.phone || req.query.q,
      status: req.query.status,
      pagination,
    });
    success(res, paginated(result.items, result.total, pagination));
  } catch (error) {
    next(error);
  }
}

module.exports = { search, uploads, jobRows };
