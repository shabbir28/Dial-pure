'use strict';

const branchReportService = require('../services/branchReportService');
const { success } = require('../utils/response');

async function get(req, res, next) {
  try {
    const data = await branchReportService.getBranchReport(req.params.userId);
    return success(res, data);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  get,
};
