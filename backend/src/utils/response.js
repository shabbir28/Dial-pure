'use strict';

function success(res, data, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    requestId: res.req.requestId,
  });
}

function fail(res, code, message, status = 400, details) {
  const body = {
    success: false,
    error: { code, message },
    requestId: res.req.requestId,
  };
  if (details) body.error.details = details;
  return res.status(status).json(body);
}

class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = { success, fail, AppError };
