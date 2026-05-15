'use strict';

const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const verificationController = require('../controllers/verificationController');

// Public endpoints for the Hosted UI / Widget
// These use session tokens for identification

// GET /api/verify/session/:token
router.get('/session/:token', verificationController.getSessionByToken);

// POST /api/verify/session/:token/identity
router.post(
  '/session/:token/identity',
  [
    param('token').notEmpty(),
    body('nin').notEmpty().isLength({ min: 11, max: 11 }),
    body('first_name').notEmpty(),
    body('last_name').notEmpty(),
    body('date_of_birth').notEmpty(),
    body('selfie_image').notEmpty(),
  ],
  validate,
  verificationController.submitIdentity
);

// POST /api/verify/session/:token/frame
router.post(
  '/session/:token/frame',
  [
    param('token').notEmpty(),
    body('frame_base64').notEmpty(),
  ],
  validate,
  verificationController.submitFrame
);

// GET /api/verify/session/:token/liveness/challenge
router.get('/session/:token/liveness/challenge', verificationController.getLivenessChallenge);

// POST /api/verify/session/:token/liveness
// router.post(
//   '/session/:token/liveness',
//   [
//     param('token').notEmpty(),
//     body('frame_base64').notEmpty(),
//   ],
//   validate,
//   verificationController.submitLiveness
// );
router.post(
  '/session/:token/liveness',
  [
    param('token').notEmpty(),
    body('frame_base64').notEmpty().withMessage('frame_base64 is required'),
    body('nonce').notEmpty().withMessage('nonce is required'),
    body('completed_sequence')
      .isArray({ min: 3, max: 3 })
      .withMessage('completed_sequence must be an array of exactly 3 steps'),
    body('frame_timestamps_ms')
      .isArray({ min: 6 })
      .withMessage('frame_timestamps_ms must be an array of at least 6 timestamps'),
    body('entropy').isObject().withMessage('entropy must be an object'),
    body('entropy.brightnessVariance').isFloat({ min: 0 }).withMessage('entropy.brightnessVariance required'),
    body('entropy.noiseVariance').isFloat({ min: 0 }).withMessage('entropy.noiseVariance required'),
    body('entropy.headStabilityVariance').isFloat({ min: 0 }).withMessage('entropy.headStabilityVariance required'),
    body('entropy.earMicroVariance').isFloat({ min: 0 }).withMessage('entropy.earMicroVariance required'),
    body('entropy.blinkLatencyMs').isFloat({ min: 0 }).withMessage('entropy.blinkLatencyMs required'),
    body('entropy.turnLatencyMs').isFloat({ min: 0 }).withMessage('entropy.turnLatencyMs required'),
  ],
  validate,
  verificationController.submitLiveness
);

// POST /api/verify/session/:token/voice/start
router.post('/session/:token/voice/start', verificationController.startVoice);

// POST /api/verify/session/:token/voice/verify
router.post(
  '/session/:token/voice/verify',
  [
    param('token').notEmpty(),
    body('transcript').notEmpty(),
  ],
  validate,
  verificationController.verifyVoice
);

// POST /api/verify/session/:token/complete
router.post('/session/:token/complete', verificationController.completeSession);

module.exports = router;
