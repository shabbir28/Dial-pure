'use strict';

const { AppError } = require('../utils/response');

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      requestId: req.requestId,
    });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: { code: 'FILE_TOO_LARGE', message: 'File is larger than 500 MB.' },
      requestId: req.requestId,
    });
  }

  console.error(err);
  const message = req.app.get('env') === 'production' ? 'An unexpected error occurred.' : err.message;
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message },
    requestId: req.requestId,
  });
}

module.exports = { errorHandler };
