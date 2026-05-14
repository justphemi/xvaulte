'use strict';

function success(res, data, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    status: 'success',
    message,
    data,
  });
}

function created(res, data, message = 'Created') {
  return success(res, data, message, 201);
}

function error(res, message = 'An error occurred', statusCode = 500, details = null) {
  const body = {
    status: 'error',
    message,
  };
  if (details && process.env.NODE_ENV !== 'production') {
    body.details = details;
  }
  return res.status(statusCode).json(body);
}

function validationError(res, errors) {
  return res.status(422).json({
    status: 'error',
    message: 'Validation failed',
    errors,
  });
}

function notFound(res, resource = 'Resource') {
  return error(res, `${resource} not found`, 404);
}

function unauthorized(res, message = 'Unauthorized') {
  return error(res, message, 401);
}

function forbidden(res, message = 'Forbidden') {
  return error(res, message, 403);
}

module.exports = { success, created, error, validationError, notFound, unauthorized, forbidden };