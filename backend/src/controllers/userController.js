'use strict';

const authService = require('../services/authService');
const { success } = require('../utils/response');
const { parsePagination, paginated } = require('../utils/pagination');

function ctx(req) {
  return {
    actor: req.user,
    ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
    userAgent: req.headers['user-agent'],
    requestId: req.requestId,
  };
}

async function list(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await authService.listUsers({
      role: req.query.role,
      status: req.query.status,
      search: req.query.search,
      pagination,
    });
    success(res, paginated(result.items, result.total, pagination));
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const user = await authService.createUser({
      ...ctx(req),
      payload: req.body,
    });
    success(res, user, 201);
  } catch (error) {
    next(error);
  }
}

async function get(req, res, next) {
  try {
    const user = await authService.getById(req.params.id);
    success(res, user);
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const user = await authService.updateUser({
      ...ctx(req),
      id: req.params.id,
      payload: req.body,
    });
    success(res, user);
  } catch (error) {
    next(error);
  }
}


async function getCampaignAccess(req, res, next) {
  try {
    const result = await authService.getUserCampaignAccess(
      req.params.id
    );
    success(res, result);
  } catch (error) {
    next(error);
  }
}

async function updateCampaignAccess(req, res, next) {
  try {
    const result = await authService.syncUserCampaignAccess({
      ...ctx(req),
      id: req.params.id,
      campaignIds: req.body.campaignIds,
    });

    success(res, result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  list,
  create,
  get,
  update,
  getCampaignAccess,
  updateCampaignAccess,
};
