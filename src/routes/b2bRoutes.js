'use strict';

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticateB2B } = require('../middleware/auth');
const b2bController = require('../controllers/b2bController');
const verificationController = require('../controllers/verificationController');


// All B2B routes require API key authentication
router.use(authenticateB2B);

// GET /v1/vendor/:id/score
router.get('/vendor/:id/score', b2bController.getVendorScore);

// GET /v1/vendor/:id/badge (returns SVG)
router.get('/vendor/:id/badge', b2bController.getVendorBadge);

// POST /v1/escrow/create
router.post(
  '/escrow/create',
  [
    body('vendor_id').isUUID().withMessage('vendor_id must be a valid UUID'),
    body('amount').isFloat({ min: 100 }).withMessage('Amount must be at least NGN 100'),
    body('item_description').trim().notEmpty().isLength({ max: 255 }),
    body('buyer_phone').trim().notEmpty().matches(/^\+?[0-9]{10,15}$/),
    body('buyer_email').optional().isEmail(),
  ],
  validate,
  b2bController.b2bCreateEscrow
);

// POST /v1/escrow/:id/release
router.post(
  '/escrow/:id/release',
  [
    param('id').isUUID(),
    body('confirmation_token').notEmpty().withMessage('confirmation_token is required'),
  ],
  validate,
  b2bController.b2bReleaseEscrow
);

// POST /v1/escrow/:id/dispute
router.post(
  '/escrow/:id/dispute',
  [
    param('id').isUUID(),
    body('dispute_text').trim().notEmpty().isLength({ min: 20, max: 2000 }),
  ],
  validate,
  b2bController.b2bSubmitDispute
);

// GET /v1/vendors
router.get(
  '/vendors',
  [
    query('badge').optional(),
    query('category').optional(),
    query('location_state').optional(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  b2bController.listVendors
);

// POST /v1/verify/session
router.post(
  '/verify/session',
  [
    body('external_user_id').notEmpty().withMessage('external_user_id is required'),
    body('callback_url').optional().isURL().withMessage('callback_url must be a valid URL'),
  ],
  validate,
  verificationController.createSession
);

module.exports = router;