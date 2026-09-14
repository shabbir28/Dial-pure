'use strict';

const globalDncService = require('../services/globalDncService');
const { success } = require('../utils/response');

async function getSummary(req, res, next) {
  try {
    success(res, await globalDncService.getGlobalDncSummary());
  } catch (error) {
    next(error);
  }
}

async function upload(req, res, next) {
  try {
    const result = await globalDncService.uploadGlobalDnc({
      actor: req.user,
      file: req.file,
      phoneColumn: req.body.phoneColumn || null,
      req,
    });
    success(res, result, 201);
  } catch (error) {
    next(error);
  }
}

module.exports = { getSummary, upload };
