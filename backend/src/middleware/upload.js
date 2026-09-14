'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config');
const { uuid } = require('../utils/ids');
const { AppError } = require('../utils/response');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(config.storage.dir, 'tmp');
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').slice(0, 16);
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes },
});

function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return next(new AppError('FILE_TOO_LARGE', 'File is larger than 500 MB.', 413));
  }
  if (err instanceof multer.MulterError) {
    return next(new AppError('UPLOAD_FAILED', err.message || 'Upload failed.', 400));
  }
  return next(err);
}

module.exports = { upload, handleUploadError };
