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
router.post(
  '/session/:token/liveness',
  [
    param('token').notEmpty(),
    body('frame_base64').notEmpty(),
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
