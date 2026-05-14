'use strict';

const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticateVendor } = require('../middleware/auth');
const escrowController = require('../controllers/escrowController');

// POST /api/escrow/create (vendor creates a payment link and escrow)
router.post(
  '/create',
  authenticateVendor,
  [
    body('amount').isFloat({ min: 100 }).withMessage('Amount must be at least NGN 100'),
    body('item_description').trim().notEmpty().withMessage('Item description is required').isLength({ max: 255 }),
    body('buyer_phone').trim().notEmpty().withMessage('Buyer phone is required').matches(/^\+?[0-9]{10,15}$/),
    body('buyer_email').optional().isEmail(),
  ],
  validate,
  escrowController.createEscrow
);

// GET /api/escrow/confirm/:token — buyer accesses via SMS link
// Returns transaction details before they confirm
router.get('/confirm/:token', escrowController.getTransactionByToken);

// POST /api/escrow/confirm/:token — buyer confirms delivery
router.post(
  '/confirm/:token',
  [param('token').notEmpty()],
  validate,
  escrowController.confirmDelivery
);

// POST /api/escrow/:id/dispute — buyer raises a dispute
router.post(
  '/:id/dispute',
  [
    param('id').isUUID().withMessage('Invalid transaction ID'),
    body('dispute_text').trim().notEmpty().withMessage('Dispute description is required').isLength({ min: 20, max: 2000 }),
  ],
  validate,
  escrowController.submitDispute
);

module.exports = router;