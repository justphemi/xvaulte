'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticateVendor } = require('../middleware/auth');
const { strictLimiter } = require('../middleware/rateLimiter');
const vendorController = require('../controllers/vendorController');

// POST /api/vendors/register
router.post(
  '/register',
  strictLimiter,
  [
    body('business_name').trim().notEmpty().withMessage('Business name is required').isLength({ max: 150 }),
    body('category').trim().notEmpty().withMessage('Category is required'),
    body('phone').trim().notEmpty().withMessage('Phone is required').matches(/^\+?[0-9]{10,15}$/),
    body('nin').trim().optional().isLength({ min: 11, max: 11 }).withMessage('NIN must be 11 digits'),
    body('payout_account_number').trim().notEmpty().withMessage('Payout account number is required'),
    body('payout_bank_code').trim().notEmpty().withMessage('Bank code is required'),
    body('location_state').trim().optional(),
  ],
  validate,
  vendorController.register
);

// POST /api/vendors/verify/start
router.post('/verify/start', authenticateVendor, vendorController.startVerification);

// POST /api/vendors/verify-internal (Using B2B Infra)
router.post('/verify-internal', authenticateVendor, vendorController.verifyInternal);

// POST /api/vendors/verify/frame
router.post(
  '/verify/frame',
  authenticateVendor,
  [
    body('session_id').notEmpty().withMessage('session_id is required'),
    body('frame_base64').notEmpty().withMessage('frame_base64 is required'),
  ],
  validate,
  vendorController.submitVerificationFrame
);

// POST /api/vendors/verify/complete
router.post(
  '/verify/complete',
  authenticateVendor,
  [body('session_id').notEmpty().withMessage('session_id is required')],
  validate,
  vendorController.completeVerification
);

// GET /api/vendors/me/score
router.get('/me/score', authenticateVendor, vendorController.getScore);

// GET /api/vendors/me/transactions
router.get('/me/transactions', authenticateVendor, vendorController.getTransactions);

// GET /api/vendors/:id/score (public, for buyer-facing trust display)
router.get('/:id/score', vendorController.getScore);

// GET /api/vendors/banks
router.get('/banks', vendorController.getBanks);

// POST /api/vendors/login/request-otp
router.post(
  '/login/request-otp',
  // strictLimiter,
  [
    body('phone').trim().notEmpty().withMessage('Phone number is required').matches(/^\+?[0-9]{10,15}$/),
  ],
  validate,
  vendorController.requestOTP
);

// POST /api/vendors/login/verify-otp
router.post(
  '/login/verify-otp',
  strictLimiter,
  [
    body('otp_token').notEmpty().withMessage('OTP token is required'),
    body('otp_code').notEmpty().withMessage('OTP code is required').matches(/^\d{6}$/),
  ],
  validate,
  vendorController.verifyOTPAndLogin
);

// DEV ONLY - GET OTP code for testing
if (process.env.NODE_ENV === 'development') {
  router.get('/login/dev-otp', vendorController.devGetOTP);
}

module.exports = router;