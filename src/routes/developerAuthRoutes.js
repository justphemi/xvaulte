'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { strictLimiter } = require('../middleware/rateLimiter');
const { authenticateDeveloperJWT } = require('../middleware/auth');
const developerAuthController = require('../controllers/developerAuthController');
const dashboardController = require('../controllers/dashboardController');

// POST /v1/developer/auth/signup
router.post(
  '/auth/signup',
  strictLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('company_name').trim().notEmpty().withMessage('Company name is required'),
  ],
  validate,
  developerAuthController.signup
);

// POST /v1/developer/auth/signin
router.post(
  '/auth/signin',
  strictLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  developerAuthController.signin
);

// POST /v1/developer/auth/api-keys/roll
router.post(
  '/auth/api-keys/roll',
  authenticateDeveloperJWT,
  developerAuthController.rollApiKey
);

// GET /v1/developer/dashboard/metrics
router.get(
  '/dashboard/metrics',
  authenticateDeveloperJWT,
  dashboardController.getMetrics
);

// POST /v1/developer/dashboard/webhook
router.post(
  '/dashboard/webhook',
  authenticateDeveloperJWT,
  [
    body('callback_url').optional({ checkFalsy: true }).isURL().withMessage('Must be a valid URL')
  ],
  validate,
  dashboardController.updateWebhook
);

module.exports = router;
