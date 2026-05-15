// 'use strict';

// const { v4: uuidv4 } = require('uuid');
// const { success, created, error, notFound } = require('../utils/response');
// const { generateToken } = require('../utils/crypto');
// const db = require('../config/database');
// const verificationRepo = require('../repositories/verificationRepository');
// const aiService = require('../services/aiService');
// const webhookService = require('../services/webhookService');
// const logger = require('../utils/logger');


// /**
//  * B2B: Create a new verification session for a partner's user.
//  * POST /v1/verify/session
//  */
// async function createSession(req, res, next) {
//   try {
//     const { external_user_id, callback_url, expires_in_minutes = 15 } = req.body;
//     const partnerId = req.partner.id;

//     const sessionId = uuidv4();
//     const sessionToken = generateToken(32);
//     const expiresAt = new Date(Date.now() + expires_in_minutes * 60 * 1000);

//     const session = await verificationRepo.create({
//       id: sessionId,
//       partner_id: partnerId,
//       external_user_id,
//       session_token: sessionToken,
//       callback_url,
//       expires_at: expiresAt,
//     });

//     logger.info('B2B verification session created', {
//       session_id: sessionId,
//       partner_id: partnerId,
//       external_user_id
//     });

//     return created(res, {
//       session_id: sessionId,
//       session_token: sessionToken,
//       expires_at: expiresAt,
//       hosted_url: `${process.env.APP_HOSTED_URL}/verify/${sessionToken}`,
//     }, 'Verification session created');
//   } catch (err) {
//     next(err);
//   }
// }

// /**
//  * Public: Get session details for the hosted UI.
//  * GET /v1/verify/session/:token
//  */
// async function getSessionByToken(req, res, next) {
//   try {
//     const { token } = req.params;
//     const session = await verificationRepo.findByToken(token);

//     if (!session) return notFound(res, 'Session');
//     if (new Date(session.expires_at) < new Date()) {
//       return error(res, 'Verification session has expired', 410);
//     }

//     return success(res, {
//       status: session.status,
//       external_user_id: session.external_user_id,
//       expires_at: session.expires_at,
//     });
//   } catch (err) {
//     next(err);
//   }
// }

// /**
//  * Public: Submit NIN/Identity data.
//  * POST /v1/verify/session/:token/identity
//  */
// async function submitIdentity(req, res, next) {
//   try {
//     const { token } = req.params;
//     const { nin, first_name, last_name, dob } = req.body;

//     const session = await verificationRepo.findByToken(token);
//     if (!session) return notFound(res, 'Session');

//     // Update session data with identity info
//     await verificationRepo.updateData(session.id, {
//       identity: { nin, first_name, last_name, dob, submitted_at: new Date() }
//     });

//     return success(res, null, 'Identity information received');
//   } catch (err) {
//     next(err);
//   }
// }

// /**
//  * Public: Submit liveness frame.
//  * POST /v1/verify/session/:token/frame
//  */
// async function submitFrame(req, res, next) {
//   try {
//     const { token } = req.params;
//     const { frame_base64 } = req.body;

//     const session = await verificationRepo.findByToken(token);
//     if (!session) return notFound(res, 'Session');

//     const aiResult = await aiService.submitVerificationFrame(session.id, frame_base64);

//     // We don't store every frame, but we could log progress
//     return success(res, aiResult.data);
//   } catch (err) {
//     next(err);
//   }
// }

// /**
//  * Public: Start voice challenge.
//  * POST /v1/verify/session/:token/voice/start
//  */
// async function startVoice(req, res, next) {
//   try {
//     const { token } = req.params;
//     const session = await verificationRepo.findByToken(token);
//     if (!session) return notFound(res, 'Session');

//     const result = await aiService.startVoiceChallenge(session.id);
//     return success(res, result.data);
//   } catch (err) {
//     next(err);
//   }
// }

// /**
//  * Public: Verify voice transcript.
//  * POST /v1/verify/session/:token/voice/verify
//  */
// async function verifyVoice(req, res, next) {
//   try {
//     const { token } = req.params;
//     const { transcript, audio_confidence, multiple_speakers } = req.body;

//     const session = await verificationRepo.findByToken(token);
//     if (!session) return notFound(res, 'Session');

//     const result = await aiService.verifyVoiceChallenge(
//       session.id,
//       transcript,
//       audio_confidence,
//       multiple_speakers
//     );

//     if (result.success) {
//       await verificationRepo.updateData(session.id, {
//         voice: result.data
//       });
//     }

//     return success(res, result.data);
//   } catch (err) {
//     next(err);
//   }
// }

// /**
//  * Public: Finalize verification and trigger webhook.
//  * POST /v1/verify/session/:token/complete
//  */
// async function completeSession(req, res, next) {
//   try {
//     const { token } = req.params;
//     const session = await verificationRepo.findByToken(token);
//     if (!session) return notFound(res, 'Session');

//     // Liveness was already verified during submitLiveness — result is on session.data
//     // No need to call the AI service again; just read what was stored.
//     const livenessData = session.data?.liveness;
//     const livenessPassed = livenessData?.liveness_passed === true;

//     if (!livenessPassed) {
//       logger.warn('completeSession called but liveness not passed', { session_id: session.id });
//       return error(res, 'Liveness check has not been completed for this session', 400);
//     }

//     // Identity verification — uses selfie stored during liveness
//     const identityData = session.data?.identity;
//     let identityResult = { success: true, data: { identity_passed: true } }; // fallback if no NIN submitted

//     if (identityData) {
//       identityResult = await aiService.verifyIdentity(session.id, identityData);
//     }

//     const identityPassed = identityResult.data?.identity_passed === true;
//     const voicePassed = session.data?.voice?.voice_passed === true;

//     const overallPassed = livenessPassed && identityPassed && voicePassed;

//     const resultData = {
//       status: overallPassed ? 'completed' : 'failed',
//       liveness: livenessData,
//       identity: identityResult.data,
//       voice: session.data?.voice ?? { verified: false },
//       overall_passed: overallPassed,
//     };

//     await verificationRepo.updateStatus(session.id, resultData.status, resultData);

//     // Trigger webhook
//     const partner = await db.query(
//       'SELECT webhook_url, webhook_secret FROM b2b_partners WHERE id = $1',
//       [session.partner_id]
//     );
//     if (partner.rowCount > 0 && partner.rows[0].webhook_url) {
//       webhookService.sendWebhook(
//         partner.rows[0].webhook_url,
//         partner.rows[0].webhook_secret,
//         'verification.completed',
//         {
//           session_id: session.id,
//           external_user_id: session.external_user_id,
//           status: resultData.status,
//           result: resultData,
//         }
//       ).catch(err =>
//         logger.error('Webhook async dispatch failed', { session_id: session.id, error: err.message })
//       );
//     }

//     return success(
//       res,
//       resultData,
//       overallPassed ? 'Verification completed successfully' : 'Verification failed'
//     );
//   } catch (err) {
//     next(err);
//   }
// }


// /**
//  * Public: Get liveness challenge.
//  * GET /v1/verify/session/:token/liveness/challenge
//  */
// async function getLivenessChallenge(req, res, next) {
//   try {
//     const { token } = req.params;
//     const session = await verificationRepo.findByToken(token);
//     if (!session) return notFound(res, 'Session');

//     // Proxy to Python AI service (same pattern as startVoiceChallenge)
//     const result = await aiService.getLivenessChallenge(session.id);
//     if (!result.success) {
//       return error(res, 'Failed to generate liveness challenge', 500);
//     }

//     return success(res, result.data);
//   } catch (err) {
//     next(err);
//   }
// }

// /**
//  * Public: Submit liveness data.
//  * POST /v1/verify/session/:token/liveness
//  */
// async function submitLiveness(req, res, next) {
//   try {
//     const { token } = req.params;
//     const {
//       frame_base64,
//       nonce,
//       completed_sequence,
//       frame_timestamps_ms,
//       entropy,
//       blink_detected,
//       head_turn_detected,
//     } = req.body;

//     const session = await verificationRepo.findByToken(token);
//     if (!session) return notFound(res, 'Session');

//     logger.info('Liveness submission proxying to AI service', {
//       session_id: session.id,
//       completed_sequence,
//       frame_timestamps_count: frame_timestamps_ms?.length ?? 0,
//       entropy_keys: entropy ? Object.keys(entropy) : [],
//       has_nonce: !!nonce,
//       has_frame: !!frame_base64,
//     });

//     const aiResult = await aiService.submitLiveness(session.id, {
//       session_id: session.id,   // ← FastAPI needs this in the body too
//       nonce,
//       frame_base64,
//       completed_sequence,
//       frame_timestamps_ms,
//       entropy,
//       blink_detected,
//       head_turn_detected,
//     });

//     if (!aiResult.success) {
//       // Case 1: upstream (FastAPI) responded with a structured error — forward it verbatim
//       if (aiResult.upstreamBody) {
//         logger.warn('Liveness verification failed — forwarding upstream error', {
//           session_id: session.id,
//           status: aiResult.upstreamStatus,
//           error_code: aiResult.upstreamBody?.error_code ?? null,
//           detail: aiResult.upstreamBody?.detail ?? null,
//         });
//         return res
//           .status(aiResult.upstreamStatus ?? 422)
//           .json(aiResult.upstreamBody);  // client receives the real { error_code, detail, scores }
//       }

//       // Case 2: network failure — no upstream body to forward
//       logger.error('Liveness verification network failure', {
//         session_id: session.id,
//         error: aiResult.error,
//       });
//       return res.status(502).json({
//         error_code: 'AI_SERVICE_UNAVAILABLE',
//         detail: 'Could not reach the verification service — please try again.',
//       });
//     }

//     // Store liveness result on the session for the final complete step
//     await verificationRepo.updateData(session.id, { liveness: aiResult.data });

//     return success(res, aiResult.data);
//   } catch (err) {
//     next(err);
//   }
// }

// module.exports = {
//   createSession,
//   getSessionByToken,
//   submitIdentity,
//   submitFrame,
//   getLivenessChallenge,
//   submitLiveness,
//   startVoice,
//   verifyVoice,
//   completeSession
// };

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


// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Identity (NIN + personal details)
// Must pass before liveness or voice are accessible.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public: Submit NIN + personal details, verify against NIMC via ShuftiPro.
 * POST /v1/verify/session/:token/identity
 *
 * This is the FIRST step. The session is blocked from liveness/voice
 * until identity_passed === true.
 *
 * ShuftiPro passive eIDV returns the NIMC record. We compare name + DOB
 * against what the user submitted. face_match runs here too — the selfie
 * from liveness is NOT yet available, so face_match is deferred to liveness.
 */
async function submitIdentity(req, res, next) {
  try {
    const { token } = req.params;
    const { nin, first_name, middle_name, last_name, date_of_birth, selfie_image } = req.body;

    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');
    if (new Date(session.expires_at) < new Date()) {
      return error(res, 'Verification session has expired', 410);
    }

    // Don't allow re-submission if identity already passed
    if (session.data?.identity?.identity_passed === true) {
      return error(res, 'Identity has already been verified for this session', 409);
    }

    const identityResult = await aiService.verifyIdentity(session.id, { 
      nin,
      first_name,
      middle_name,
      last_name,
      dob: date_of_birth,
      selfie_image
    });

    if (!identityResult.success) {
      return error(res, identityResult.error ?? 'Identity verification service unavailable', 503);
    }

    const identityPassed = identityResult.data?.identity_passed === true;

    // Store result regardless of pass/fail so completeSession can read it
    await verificationRepo.updateData(session.id, {
      identity: {
        ...identityResult.data,
        submitted: { nin, first_name, middle_name, last_name, dob },
        submitted_at: new Date(),
      }
    });

    if (!identityPassed) {
      logger.warn('Identity verification failed', {
        session_id: session.id,
        nin_valid: identityResult.data?.nin_valid,
        data_match: identityResult.data?.data_match,
      });

      // Return the result but do NOT advance the session —
      // client should show the specific failure reason so user can retry
      return success(res, {
        identity_passed: false,
        nin_valid: identityResult.data?.nin_valid ?? false,
        data_match: identityResult.data?.data_match ?? false,
        message: identityResult.data?.message ?? 'Identity verification failed',
      });
    }

    logger.info('Identity verified', { session_id: session.id });

    return success(res, {
      identity_passed: true,
      nin_valid: identityResult.data?.nin_valid,
      data_match: identityResult.data?.data_match,
      identity_score: identityResult.data?.identity_score,
      message: identityResult.data?.message,
    }, 'Identity verified — proceed to liveness check');
  } catch (err) {
    next(err);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Liveness (camera challenge + selfie capture)
// Blocked until identity_passed === true.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public: Get liveness challenge.
 * GET /v1/verify/session/:token/liveness/challenge
 */
async function getLivenessChallenge(req, res, next) {
  try {
    const { token } = req.params;
    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    if (session.data?.identity?.identity_passed !== true) {
      return error(res, 'Identity verification must be completed before liveness check', 403);
    }

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
 * Public: Submit liveness data (final frame + challenge proof).
 * POST /v1/verify/session/:token/liveness
 *
 * The captured selfie (frame_base64) is stored here. ShuftiPro's
 * face_match already ran in Step 1 using the NIMC photo — the selfie
 * stored here is used for the final audit trail only.
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
      head_turn_detected,
    } = req.body;

    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    if (session.data?.identity?.identity_passed !== true) {
      return error(res, 'Identity verification must be completed before liveness check', 403);
    }

    logger.info('Liveness submission proxying to AI service', {
      session_id: session.id,
      completed_sequence,
      frame_timestamps_count: frame_timestamps_ms?.length ?? 0,
      entropy_keys: entropy ? Object.keys(entropy) : [],
      has_nonce: !!nonce,
      has_frame: !!frame_base64,
    });

    const aiResult = await aiService.submitLiveness(session.id, {
      session_id: session.id,
      nonce,
      frame_base64,
      completed_sequence,
      frame_timestamps_ms,
      entropy,
      blink_detected,
      head_turn_detected,
    });

    if (!aiResult.success) {
      if (aiResult.upstreamBody) {
        logger.warn('Liveness verification failed — forwarding upstream error', {
          session_id: session.id,
          status: aiResult.upstreamStatus,
          error_code: aiResult.upstreamBody?.error_code ?? null,
          detail: aiResult.upstreamBody?.detail ?? null,
        });
        return res
          .status(aiResult.upstreamStatus ?? 422)
          .json(aiResult.upstreamBody);
      }

      logger.error('Liveness verification network failure', {
        session_id: session.id,
        error: aiResult.error,
      });
      return res.status(502).json({
        error_code: 'AI_SERVICE_UNAVAILABLE',
        detail: 'Could not reach the verification service — please try again.',
      });
    }

    await verificationRepo.updateData(session.id, { liveness: aiResult.data });

    return success(res, aiResult.data);
  } catch (err) {
    next(err);
  }
}

/**
 * Public: Stream a single frame during liveness (progress updates only).
 * POST /v1/verify/session/:token/frame
 */
async function submitFrame(req, res, next) {
  try {
    const { token } = req.params;
    const { frame_base64 } = req.body;

    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    if (session.data?.identity?.identity_passed !== true) {
      return error(res, 'Identity verification must be completed before liveness check', 403);
    }

    const aiResult = await aiService.submitVerificationFrame(session.id, frame_base64);
    return success(res, aiResult.data);
  } catch (err) {
    next(err);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Voice challenge
// Blocked until liveness_passed === true.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public: Start voice challenge.
 * POST /v1/verify/session/:token/voice/start
 */
async function startVoice(req, res, next) {
  try {
    const { token } = req.params;
    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    if (session.data?.liveness?.liveness_passed !== true) {
      return error(res, 'Liveness check must be completed before voice challenge', 403);
    }

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

    if (session.data?.liveness?.liveness_passed !== true) {
      return error(res, 'Liveness check must be completed before voice challenge', 403);
    }

    const result = await aiService.verifyVoiceChallenge(
      session.id,
      transcript,
      audio_confidence,
      multiple_speakers
    );

    if (result.success) {
      await verificationRepo.updateData(session.id, { voice: result.data });
    }

    return success(res, result.data);
  } catch (err) {
    next(err);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: Complete
// Aggregates stored results from all three steps, fires webhook.
// No AI calls here — everything was already verified and stored.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public: Finalize verification and trigger webhook.
 * POST /v1/verify/session/:token/complete
 */
// async function completeSession(req, res, next) {
//   try {
//     const { token } = req.params;
//     const session = await verificationRepo.findByToken(token);
//     if (!session) return notFound(res, 'Session');

//     // Guard: all three steps must have run before completion is allowed
//     const identityPassed = session.data?.identity?.identity_passed === true;
//     const livenessPassed = session.data?.liveness?.liveness_passed === true;
//     const voicePassed = session.data?.voice?.voice_passed === true;

//     if (!identityPassed) {
//       return error(res, 'Identity verification has not been completed', 400);
//     }
//     if (!livenessPassed) {
//       return error(res, 'Liveness check has not been completed', 400);
//     }
//     if (!voicePassed) {
//       return error(res, 'Voice challenge has not been completed', 400);
//     }

//     const overallPassed = true; // all three guards above ensure this

//     const resultData = {
//       status: 'completed',
//       identity: session.data.identity,
//       liveness: session.data.liveness,
//       voice: session.data.voice,
//       overall_passed: overallPassed,
//     };

//     await verificationRepo.updateStatus(session.id, 'completed', resultData);

//     // Fire webhook (non-blocking)
//     const partner = await db.query(
//       'SELECT webhook_url, webhook_secret FROM b2b_partners WHERE id = $1',
//       [session.partner_id]
//     );
//     if (partner.rowCount > 0 && partner.rows[0].webhook_url) {
//       webhookService.sendWebhook(
//         partner.rows[0].webhook_url,
//         partner.rows[0].webhook_secret,
//         'verification.completed',
//         {
//           session_id: session.id,
//           external_user_id: session.external_user_id,
//           status: resultData.status,
//           result: resultData,
//         }
//       ).catch(err =>
//         logger.error('Webhook async dispatch failed', { session_id: session.id, error: err.message })
//       );
//     }

//     return success(res, resultData, 'Verification completed successfully');
//   } catch (err) {
//     next(err);
//   }
// }
async function completeSession(req, res, next) {
  try {
    const { token } = req.params;
    const session = await verificationRepo.findByToken(token);
    if (!session) return notFound(res, 'Session');

    // ── Guard: all three steps must have passed ───────────────────────────
    const identityPassed = session.data?.identity?.identity_passed === true;
    const livenessPassed = session.data?.liveness?.liveness_passed === true;
    const voicePassed = session.data?.voice?.voice_passed === true;

    if (!identityPassed) return error(res, 'Identity verification has not been completed', 400);
    if (!livenessPassed) return error(res, 'Liveness check has not been completed', 400);
    if (!voicePassed) return error(res, 'Voice challenge has not been completed', 400);

    // ── Calculate VaultScore using real values from all 3 steps ──────────
    // Pass session.data so completeVerification can extract the right fields:
    //   identity_score      ← session.data.identity.identity_score
    //   liveness_confidence ← session.data.liveness.scores.liveness_confidence
    //   voice_score         ← session.data.voice.confidence_score
    const scoreResult = await aiService.completeVerification(session.id, session.data);

    if (!scoreResult.success) {
      logger.error('VaultScore calculation failed', { session_id: session.id, error: scoreResult.error });
      // Non-fatal — complete the session anyway, score can be recalculated later
    }

    const vaultScore = scoreResult.data?.vault_score ?? null;
    const trustLevel = scoreResult.data?.trust_level ?? null;
    const breakdown = scoreResult.data?.score_breakdown ?? null;

    const resultData = {
      status: 'completed',
      identity: session.data.identity,
      liveness: session.data.liveness,
      voice: session.data.voice,
      vault_score: vaultScore,
      trust_level: trustLevel,
      score_breakdown: breakdown,
      overall_passed: true,
    };

    await verificationRepo.updateStatus(session.id, 'completed', resultData);

    // Persist vault score on the vendor record so getScore() returns it
    if (vaultScore !== null) {
      await vendorRepo.updateTrustScore(session.external_user_id ?? session.id, {
        trust_score: vaultScore,
        score_tier: trustLevel,
        verification_status: 'verified',
      });
    }

    // ── Fire webhook (non-blocking) ───────────────────────────────────────
    const partner = await db.query(
      'SELECT webhook_url, webhook_secret FROM b2b_partners WHERE id = $1',
      [session.partner_id]
    );
    if (partner.rowCount > 0 && partner.rows[0].webhook_url) {
      webhookService.sendWebhook(
        partner.rows[0].webhook_url,
        partner.rows[0].webhook_secret,
        'verification.completed',
        {
          session_id: session.id,
          external_user_id: session.external_user_id,
          status: resultData.status,
          result: resultData,
        }
      ).catch(err =>
        logger.error('Webhook dispatch failed', { session_id: session.id, error: err.message })
      );
    }

    return success(res, resultData, 'Verification completed successfully');
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
  completeSession,
};