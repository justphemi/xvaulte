'use strict';

const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');

const aiClient = axios.create({
  baseURL: env.ai.url,
  timeout: env.ai.timeout_ms,
  headers: { 'Content-Type': 'application/json' },
});

// ============================================================
// AI TOGGLE
// Set AI_ENABLED=false in .env to bypass all AI calls.
// The system will return mock responses that let you test the
// full escrow flow (register -> verify -> escrow -> confirm -> dispute)
// without needing the Python AI microservice running.
// ============================================================

function isAiEnabled() {
  return env.ai.enabled;
}

function mockVerificationFrame(frameCount) {
  return {
    face_distance: 0.38,
    blink_detected: frameCount >= 2,
    head_yaw: frameCount >= 3 ? 28.4 : 0,
    progress: frameCount >= 5 ? 'complete' : 'processing',
  };
}

function mockVerificationComplete() {
  return {
    verified: true,
    confidence_percent: 87.5,
    deepfake_variance: 0.012,
    failure_reason: null,
  };
}

function mockAnomalyResult() {
  return {
    anomaly_score: -0.15,
    is_anomalous: false,
    flag_level: null,
    triggered_signals: [],
  };
}

function mockDisputeClassification(disputeText) {
  const text = disputeText.toLowerCase();
  if (text.includes('never') || text.includes('not receive') || text.includes('arrived')) {
    return { category: 'non-delivery', confidence: 0.91, resolution_recommendation: 'full-refund' };
  }
  if (text.includes('fake') || text.includes('counterfeit') || text.includes('not real')) {
    return { category: 'counterfeit', confidence: 0.88, resolution_recommendation: 'full-refund' };
  }
  if (text.includes('wrong') || text.includes('different') || text.includes('incorrect')) {
    return { category: 'wrong-item', confidence: 0.83, resolution_recommendation: 'manual-review' };
  }
  return { category: 'not-as-described', confidence: 0.72, resolution_recommendation: 'manual-review' };
}

/**
 * Submit a base64-encoded webcam frame for liveness/face processing.
 * If AI_ENABLED=false, returns a mock response.
 */
async function submitVerificationFrame(sessionId, frameBase64) {
  if (!isAiEnabled()) {
    logger.info('AI disabled — returning mock verification frame result', { session_id: sessionId });
    return { success: true, data: mockVerificationFrame(1) };
  }

  try {
    const response = await aiClient.post('/verify/frame', {
      session_id: sessionId,
      frame_base64: frameBase64,
    });
    return { success: true, data: response.data };
  } catch (err) {
    logger.error('AI frame submission failed — using fallback', { session_id: sessionId, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Finalize liveness session.
 * If AI_ENABLED=false, returns a mock verified=true result.
 */
/**
 * Called after all 3 steps pass in completeSession.
 * Replaces the old /verify/complete call (which doesn't exist).
 *
 * Pulls real scores out of the stored session data and sends them
 * to FastAPI's /vendor/vault-score endpoint.
 *
 * @param {string} sessionId
 * @param {object} sessionData  — session.data from verificationRepo
 */
async function completeVerification(sessionId, sessionData) {
  if (!isAiEnabled()) {
    logger.info('AI disabled — returning mock vault score', { session_id: sessionId });
    return { success: true, data: mockVaultScore() };
  }

  // ── Extract real values from stored session results ───────────────────────

  // Identity: identity_score is 0-100 from ShuftiPro (_calculate_identity_score)
  const identityScore = sessionData?.identity?.identity_score ?? 0;

  // Liveness: scores object returned by LivenessResult
  // scores.liveness_confidence is the float you want (0-1)
  const livenessConfidence = sessionData?.liveness?.scores?.liveness_confidence ?? 0;

  // Voice: confidence_score is the raw float (0-1) from VoiceChallengeVerifyResponse
  const voiceScore = sessionData?.voice?.confidence_score ?? 0;

  logger.info('Requesting VaultScore from AI service', {
    session_id: sessionId,
    identity_score: identityScore,
    liveness_confidence: livenessConfidence,
    voice_score: voiceScore,
  });

  try {
    const response = await aiClient.post('/vendor/vault-score', {
      vendor_id: sessionId,           // use session_id as correlation key;
      // swap for actual vendor_id if available
      identity_score: identityScore,
      liveness_confidence: livenessConfidence,
      voice_score: voiceScore,
      total_orders: 0,                // no history yet for new vendors
      successful_deliveries: 0,
      total_disputes: 0,
    });

    return { success: true, data: response.data };
  } catch (err) {
    logger.error('VaultScore request failed', { session_id: sessionId, error: err.message });
    return { success: false, error: err.message };
  }
}

// ── Mock for dev/AI-disabled mode ─────────────────────────────────────────────
function mockVaultScore() {
  return {
    vault_score: 72,
    score_breakdown: {
      identity: 40,
      liveness: 16,
      voice: 16,
      transaction_history: 0,
    },
    trust_level: 'Moderate',
    verified: true,
  };
}

/**
 * Run behavioral anomaly detection on a vendor's recent transactions.
 * If AI_ENABLED=false, returns a mock clean result (no anomaly).
 */
async function runAnomalyDetection(vendorId) {
  if (!isAiEnabled()) {
    logger.info('AI disabled — returning mock anomaly result (clean)', { vendor_id: vendorId });
    return { success: true, data: mockAnomalyResult() };
  }

  try {
    const response = await aiClient.post('/score/anomaly', { vendor_id: vendorId });
    return { success: true, data: response.data };
  } catch (err) {
    logger.error('AI anomaly detection failed — using safe fallback', { vendor_id: vendorId, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Classify a buyer's dispute text.
 * If AI_ENABLED=false, returns a keyword-based mock classification.
 */
async function classifyDispute(disputeText) {
  if (!isAiEnabled()) {
    logger.info('AI disabled — returning mock dispute classification');
    return { success: true, data: mockDisputeClassification(disputeText) };
  }

  try {
    const response = await aiClient.post('/dispute/classify', { dispute_text: disputeText });
    return { success: true, data: response.data };
  } catch (err) {
    logger.error('AI dispute classification failed — using keyword fallback', { error: err.message });
    return { success: true, data: mockDisputeClassification(disputeText) };
  }
}

/**
 * Get a challenge phrase and AssemblyAI token for voice verification.
 */
async function startVoiceChallenge(sessionId) {
  if (!isAiEnabled()) {
    logger.info('AI disabled — returning mock voice challenge start', { session_id: sessionId });
    return {
      success: true,
      data: {
        phrase: 'I am verifying my Vault account today',
        token: 'mock_token',
        websocket_url: 'wss://mock.assemblyai.com',
      }
    };
  }

  try {
    const response = await aiClient.post('/vendor/voice/start', { session_id: sessionId });
    return { success: true, data: response.data };
  } catch (err) {
    logger.error('AI voice start failed', { session_id: sessionId, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Verify the voice transcript against the expected challenge phrase.
 */
async function verifyVoiceChallenge(sessionId, transcript, audioConfidence, multipleSpeakers) {
  if (!isAiEnabled()) {
    logger.info('AI disabled — returning mock voice verification result', { session_id: sessionId });
    return {
      success: true,
      data: {
        voice_passed: true,
        voice_score: 0.95,
        message: 'Voice verification passed (mock)',
      }
    };
  }

  try {
    const response = await aiClient.post('/vendor/voice/verify', {
      session_id: sessionId,
      transcript,
      audio_confidence: audioConfidence,
      multiple_speakers: multipleSpeakers,
    });
    return { success: true, data: response.data };
  } catch (err) {
    logger.error('AI voice verification failed', { session_id: sessionId, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Perform real NIN + Face match verification via Youverify (proxied by AI service).
 */
async function verifyIdentity(sessionId, identityData, selfieBase64) {
  if (!isAiEnabled()) {
    logger.info('AI disabled — returning mock identity verification result', { session_id: sessionId });
    return {
      success: true,
      data: {
        identity_passed: true,
        nin_valid: true,
        face_match: true,
        face_confidence: 0.98,
        identity_score: 95.0,
        message: 'Identity verified successfully (mock)'
      }
    };
  }

  try {
    const response = await aiClient.post('/vendor/verify-identity', {
      session_id: sessionId,
      nin: identityData.nin,
      first_name: identityData.first_name,
      last_name: identityData.last_name,
      date_of_birth: identityData.dob,
      selfie_image: selfieBase64,
    });
    return { success: true, data: response.data };
  } catch (err) {
    logger.error('AI identity verification failed', { session_id: sessionId, error: err.message });
    return { success: false, error: err.message };
  }
}


async function getLivenessChallenge(sessionId) {
  if (!isAiEnabled()) {
    logger.info('AI disabled — returning mock liveness challenge', { session_id: sessionId });
    return {
      success: true,
      data: {
        sequence: ['blink', 'turn_left', 'turn_right'],
        nonce: Math.random().toString(36).slice(2) + Date.now().toString(36),
      }
    };
  }

  try {
    const response = await aiClient.get('/vendor/liveness/challenge', {
      headers: { 'X-Session-Id': sessionId }
    });
    return { success: true, data: response.data };
  } catch (err) {
    logger.error('AI liveness challenge fetch failed', { session_id: sessionId, error: err.message });
    return { success: false, error: err.message };
  }
}

async function submitLiveness(sessionId, payload) {
  if (!isAiEnabled()) {
    logger.info('AI disabled — returning mock liveness submission', { session_id: sessionId });
    return {
      success: true,
      data: {
        success: true,
        liveness_passed: true,
        message: 'Liveness verified (mock)',
        flagged: false,
        flag_reason: '',
        elapsed_ms: 0,
      }
    };
  }

  try {
    const response = await aiClient.post(
      '/vendor/liveness',
      payload,
      { headers: { 'X-Session-Id': sessionId } }
    );
    return { success: true, data: response.data };
  } catch (err) {
    // err.response exists when the upstream (FastAPI) responded with a non-2xx.
    // err.response is undefined on network failures (ECONNREFUSED, timeout, etc.)
    if (err.response) {
      logger.error('AI liveness submission rejected by upstream', {
        session_id: sessionId,
        status: err.response.status,
        error_code: err.response.data?.error_code ?? null,
        detail: err.response.data?.detail ?? null,
        scores: err.response.data?.scores ?? null,
      });
      // Forward the upstream status + body verbatim so callers can act on it
      return {
        success: false,
        upstreamStatus: err.response.status,
        upstreamBody: err.response.data,
        error: err.message,
      };
    }

    // Network-level failure — FastAPI never responded
    logger.error('AI liveness submission network failure', {
      session_id: sessionId,
      error: err.message,
      code: err.code ?? null,
    });
    return { success: false, error: err.message };
  }
}

module.exports = {
  submitVerificationFrame,
  completeVerification,
  runAnomalyDetection,
  classifyDispute,
  startVoiceChallenge,
  verifyVoiceChallenge,
  verifyIdentity,
  getLivenessChallenge,   // ← add
  submitLiveness,
  isAiEnabled,
};