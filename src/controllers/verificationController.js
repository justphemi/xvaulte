'use strict';

const { v4: uuidv4 } = require('uuid');
const { success, created, error, notFound } = require('../utils/response');
const { generateToken } = require('../utils/crypto');
const db = require('../config/database');
const verificationRepo = require('../repositories/verificationRepository');
const aiService = require('../services/aiService');
const webhookService = require('../services/webhookService');
const logger = require('../utils/logger');


/**
 * B2B: Create a new verification session for a partner's user.
 * POST /v1/verify/session
 */
async function createSession(req, res, next) {
  try {
    const { external_user_id, callback_url, expires_in_minutes = 15 } = req.body;
    const partnerId = req.partner.id;

    const sessionId = uuidv4();
    const sessionToken = generateToken(32);
    const expiresAt = new Date(Date.now() + expires_in_minutes * 60 * 1000);

    const session = await verificationRepo.create({
      id: sessionId,
      partner_id: partnerId,
      external_user_id,
      session_token: sessionToken,
      callback_url,
      expires_at: expiresAt,
    });

    logger.info('B2B verification session created', { 
      session_id: sessionId, 
      partner_id: partnerId,
      external_user_id 
    });

    return created(res, {
      session_id: sessionId,
      session_token: sessionToken,
      expires_at: expiresAt,
      hosted_url: `${process.env.APP_HOSTED_URL}/verify/${sessionToken}`,
    }, 'Verification session created');
  } catch (err) {
    next(err);
  }
}

/**
 * Public: Get session details for the hosted UI.
 * GET /v1/verify/session/:token
 */
async function getSessionByToken(req, res, next) {
  try {
    const { token } = req.params;
    const session = await verificationRepo.findByToken(token);

    if (!session) return notFound(res, 'Session');
    if (new Date(session.expires_at) < new Date()) {
      return error(res, 'Verification session has expired', 410);
    }

    return success(res, {
      status: session.status,
      external_user_id: session.external_user_id,
      expires_at: session.expires_at,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Public: Submit NIN/Identity data.
 * POST /v1/verify/session/:token/identity
 */
async function submitIdentity(req, res, next) {
  try {
    const { token } = req.params;
    const { nin, first_name, last_name, dob } = req.body;

    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    // Update session data with identity info
    await verificationRepo.updateData(session.id, {
      identity: { nin, first_name, last_name, dob, submitted_at: new Date() }
    });

    return success(res, null, 'Identity information received');
  } catch (err) {
    next(err);
  }
}

/**
 * Public: Submit liveness frame.
 * POST /v1/verify/session/:token/frame
 */
async function submitFrame(req, res, next) {
  try {
    const { token } = req.params;
    const { frame_base64 } = req.body;

    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    const aiResult = await aiService.submitVerificationFrame(session.id, frame_base64);
    
    // We don't store every frame, but we could log progress
    return success(res, aiResult.data);
  } catch (err) {
    next(err);
  }
}

/**
 * Public: Start voice challenge.
 * POST /v1/verify/session/:token/voice/start
 */
async function startVoice(req, res, next) {
  try {
    const { token } = req.params;
    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    const result = await aiService.startVoiceChallenge(session.id);
    return success(res, result.data);
  } catch (err) {
    next(err);
  }
}

/**
 * Public: Verify voice transcript.
 * POST /v1/verify/session/:token/voice/verify
 */
async function verifyVoice(req, res, next) {
  try {
    const { token } = req.params;
    const { transcript, audio_confidence, multiple_speakers } = req.body;

    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    const result = await aiService.verifyVoiceChallenge(
      session.id, 
      transcript, 
      audio_confidence, 
      multiple_speakers
    );

    if (result.success) {
      await verificationRepo.updateData(session.id, {
        voice: result.data
      });
    }

    return success(res, result.data);
  } catch (err) {
    next(err);
  }
}

/**
 * Public: Finalize verification and trigger webhook.
 * POST /v1/verify/session/:token/complete
 */
async function completeSession(req, res, next) {
  try {
    const { token } = req.params;
    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    // 1. Finalize Liveness in AI service
    const livenessResult = await aiService.completeVerification(session.id);
    if (!livenessResult.success) {
      return error(res, 'Failed to finalize liveness check', 500);
    }

    // 2. Perform Identity Verification (NIN + Face Match)
    // We retrieve the identity data we stored earlier in submitIdentity
    const identityData = session.data?.identity;
    let identityResult = { success: true, data: { identity_passed: true } }; // Default/Fallback
    
    if (identityData) {
      identityResult = await aiService.verifyIdentity(session.id, identityData);
    }

    // 3. Aggregate results
    const livenessPassed = livenessResult.data?.verified === true;
    const identityPassed = identityResult.data?.identity_passed === true;
    const voicePassed    = session.data?.voice_verified === true;

    const overallPassed = livenessPassed && identityPassed && voicePassed;

    const resultData = {
      status: overallPassed ? 'completed' : 'failed',
      liveness: livenessResult.data,
      identity: identityResult.data,
      voice: { verified: voicePassed, ...session.data?.voice_result },
      overall_passed: overallPassed
    };

    // Update DB
    await verificationRepo.updateStatus(session.id, resultData.status, resultData);

    // 4. Trigger Webhook
    const partner = await db.query('SELECT webhook_url, webhook_secret FROM b2b_partners WHERE id = $1', [session.partner_id]);
    if (partner.rowCount > 0 && partner.rows[0].webhook_url) {
      webhookService.sendWebhook(
        partner.rows[0].webhook_url,
        partner.rows[0].webhook_secret,
        'verification.completed',
        {
          session_id: session.id,
          external_user_id: session.external_user_id,
          status: resultData.status,
          result: resultData
        }
      ).catch(err => logger.error('Webhook async dispatch failed', { session_id: session.id, error: err.message }));
    }

    return success(res, resultData, overallPassed ? 'Verification completed successfully' : 'Verification failed');
  } catch (err) {
    next(err);
  }
}


/**
 * Public: Get liveness challenge.
 * GET /v1/verify/session/:token/liveness/challenge
 */
async function getLivenessChallenge(req, res, next) {
  try {
    const { token } = req.params;
    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    // Proxy to Python AI service (same pattern as startVoiceChallenge)
    const result = await aiService.getLivenessChallenge(session.id);
    if (!result.success) {
      return error(res, 'Failed to generate liveness challenge', 500);
    }

    return success(res, result.data);
  } catch (err) {
    next(err);
  }
}

/**
 * Public: Submit liveness data.
 * POST /v1/verify/session/:token/liveness
 */
async function submitLiveness(req, res, next) {
  try {
    const { token } = req.params;
    const { 
      frame_base64, 
      nonce,
      completed_sequence,
      frame_timestamps_ms,
      entropy,
      blink_detected,
      head_turn_detected 
    } = req.body;

    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    // Proxy full payload to Python AI service
    const aiResult = await aiService.submitLiveness(session.id, {
      nonce,
      frame_base64,
      completed_sequence,
      frame_timestamps_ms,
      entropy,
      blink_detected,
      head_turn_detected,
    });

    if (!aiResult.success) {
      return error(res, aiResult.error || 'Liveness verification failed', 422);
    }

    return success(res, aiResult.data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createSession,
  getSessionByToken,
  submitIdentity,
  submitFrame,
  getLivenessChallenge,
  submitLiveness,
  startVoice,
  verifyVoice,
  completeSession
};

