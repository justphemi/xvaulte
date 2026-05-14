'use strict';

const logger = require('../utils/logger');
const { error } = require('../utils/response');

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  logger.error('Unhandled error', {
    method: req.method,
    path: req.path,
    status: statusCode,
    error: err.message,
    stack: err.stack,
  });

  if (res.headersSent) return next(err);

  return error(res, message, statusCode, err.details || null);
}

function notFoundHandler(req, res) {
  return error(res, `Route not found: ${req.method} ${req.path}`, 404);
}

class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

module.exports = { errorHandler, notFoundHandler, AppError };