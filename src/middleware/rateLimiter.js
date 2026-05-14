'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const defaultLimiter = rateLimit({
  windowMs: env.rate_limit.window_ms,
  max: env.rate_limit.max_requests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many requests. Please wait before trying again.',
  },
  skip: (req) => req.path === '/health',
});

// Stricter limit for auth-sensitive and verification endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many requests on this endpoint. Please wait 15 minutes.',
  },
});

// Webhook endpoints must not be rate-limited
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Webhook rate limit exceeded.',
  },
});

module.exports = { defaultLimiter, strictLimiter, webhookLimiter };