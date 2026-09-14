'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { authLimiter, uploadLimiter } = require('../middleware/rateLimit');
const { upload, handleUploadError } = require('../middleware/upload');
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const campaignController = require('../controllers/campaignController');
const scrubJobController = require('../controllers/scrubJobController');
const branchReportController = require('../controllers/branchReportController');
const dashboardController = require('../controllers/dashboardController');
const lookupController = require('../controllers/lookupController');
const globalDncController = require('../controllers/globalDncController');

function routes() {
  const router = express.Router();

  router.post('/auth/login', authLimiter, authController.login);
  router.post('/auth/refresh', authLimiter, authController.refresh);
  router.post('/auth/logout', authenticate, authController.logout);
  router.get('/auth/me', authenticate, authController.me);

  router.get('/users', authenticate, requireRole('admin'), userController.list);
  router.post('/users', authenticate, requireRole('admin'), userController.create);
  router.get('/users/:id', authenticate, requireRole('admin'), userController.get);
  router.get(
    '/users/:id/campaigns',
    authenticate,
    requireRole('admin'),
    userController.getCampaignAccess
  );
  router.put(
    '/users/:id/campaigns',
    authenticate,
    requireRole('admin'),
    userController.updateCampaignAccess
  );
  router.get(
    '/branch-reports/:userId',
    authenticate,
    requireRole('admin'),
    branchReportController.get
  );
  router.patch('/users/:id', authenticate, requireRole('admin'), userController.update);

  router.get('/campaigns', authenticate, campaignController.list);
  router.post('/campaigns', authenticate, requireRole('admin'), campaignController.create);
  router.get('/campaigns/:id', authenticate, campaignController.get);
  router.patch('/campaigns/:id', authenticate, requireRole('admin'), campaignController.update);
  router.post('/campaigns/:id/agents', authenticate, requireRole('admin'), campaignController.assignAgent);
  router.delete('/campaigns/:id/agents/:agentId', authenticate, requireRole('admin'), campaignController.revokeAgent);
  router.get('/campaigns/:id/versions', authenticate, campaignController.versions);
  router.post(
    '/campaigns/:id/master-file',
    authenticate,
    requireRole('admin'),
    uploadLimiter,
    upload.single('file'),
    handleUploadError,
    campaignController.uploadMaster
  );

  router.get(
    '/campaigns/:id/internal-lists',
    authenticate,
    requireRole('admin'),
    campaignController.internalLists
  );

  router.post(
    '/campaigns/:id/internal-lists/:listType',
    authenticate,
    requireRole('admin'),
    uploadLimiter,
    upload.single('file'),
    handleUploadError,
    campaignController.uploadInternalList
  );

  router.post(
    '/campaigns/:id/versions/:versionId/activate',
    authenticate,
    requireRole('admin'),
    campaignController.activateVersion
  );

  router.post('/files/preview', authenticate, uploadLimiter, upload.single('file'), handleUploadError, campaignController.preview);
  router.get('/files', authenticate, requireRole('admin'), campaignController.listFiles);

  router.post('/scrub-jobs', authenticate, uploadLimiter, upload.single('file'), handleUploadError, scrubJobController.create);
  router.get('/scrub-jobs', authenticate, scrubJobController.list);
  router.get('/scrub-jobs/:id', authenticate, scrubJobController.get);
  router.post('/scrub-jobs/:id/cancel', authenticate, scrubJobController.cancel);
  router.post('/scrub-jobs/:id/restart', authenticate, scrubJobController.restart);
  router.get('/scrub-jobs/:id/exports', authenticate, scrubJobController.exportsList);
  router.get('/scrub-jobs/:id/rows', authenticate, lookupController.jobRows);
  router.get('/exports/:id/download', authenticate, scrubJobController.download);
  router.get('/lookup/phone', authenticate, lookupController.search);
  router.get('/lookup/uploads', authenticate, lookupController.uploads);

  router.get('/admin/dashboard', authenticate, requireRole('admin'), dashboardController.admin);
  router.get('/agent/dashboard', authenticate, dashboardController.agent);
  router.get('/audit-logs', authenticate, requireRole('admin'), dashboardController.auditLogs);
  router.get('/settings', authenticate, requireRole('admin'), dashboardController.getSettings);
  router.patch('/settings/:key', authenticate, requireRole('admin'), dashboardController.updateSetting);

  // Global DNC/Dead — applies to all scrub jobs across all campaigns
  router.get('/global-dnc', authenticate, requireRole('admin'), globalDncController.getSummary);
  router.post(
    '/global-dnc/upload',
    authenticate,
    requireRole('admin'),
    uploadLimiter,
    upload.single('file'),
    handleUploadError,
    globalDncController.upload
  );

  return router;
}

module.exports = routes;
