'use strict';

const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticateVendor } = require('../middleware/auth');
const transactionRepo = require('../repositories/transactionRepository');
const vendorRepo = require('../repositories/vendorRepository');
const { success, notFound } = require('../utils/response');
const escrowController = require('../controllers/escrowController');
const { getTransactionById } = require('../controllers/escrowController');

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


// POST /api/escrow/create-public
// Buyer-facing: creates escrow by vendor_id without requiring vendor token
router.post(
  '/create-public',
  [
    body('vendor_id').isUUID().withMessage('vendor_id is required'),
    body('amount').isFloat({ min: 100 }).withMessage('Amount must be at least NGN 100'),
    body('item_description').trim().notEmpty().isLength({ max: 255 }),
    body('buyer_phone').trim().notEmpty().matches(/^\+?[0-9]{10,15}$/),
    body('buyer_email').optional().isEmail(),
  ],
  validate,
  escrowController.createEscrow  // your existing controller handles this already
                                  // it already reads vendor_id from req.body when req.vendor is absent
);

router.get('/by-ref/:id', getTransactionById);
router.get('/check-status/:transaction_id', escrowController.checkPaymentStatus);


// GET /api/escrow/by-ref/:transaction_id
// Called by the confirm page after Squad redirects back
router.get('/by-ref/:transaction_id', async (req, res, next) => {
  try {
    const transaction = await transactionRepo.findById(req.params.transaction_id);
    if (!transaction) return notFound(res, 'Transaction');

    const vendor = await vendorRepo.findById(transaction.vendor_id);

    return success(res, {
      transaction_id: transaction.id,
      escrow_status: transaction.escrow_status,
      amount: transaction.amount,
      item_description: transaction.item_description,
      confirmation_token: transaction.confirmation_link_token,
      confirmation_expires_at: transaction.confirmation_link_expires_at,
      vendor: vendor ? {
        business_name: vendor.business_name,
        trust_score: vendor.trust_score,
        score_tier: vendor.score_tier,
      } : null,
    });
  } catch (err) {
    next(err);
  }
});


module.exports = router;