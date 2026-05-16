'use strict';

const { v4: uuidv4 } = require('uuid');
const { success, created, error, notFound } = require('../utils/response');
const { AppError } = require('../middleware/errorHandler');
const vendorRepo = require('../repositories/vendorRepository');
const squadService = require('../services/squadService');
const aiService = require('../services/aiService');
const trustScoreService = require('../services/trustScoreService');
const { generateApiKey, hashApiKey, generateToken } = require('../utils/crypto');
const jwt = require('../utils/jwt');
const logger = require('../utils/logger');
const env = require('../config/env'); 
const otpService = require('../services/otpService');

// In-memory session store for liveness check sessions
// In production, replace with Redis
const verificationSessions = new Map();

function generateActionSequence() {
  const blinks = Math.floor(Math.random() * 2) + 2; // 2-3 blinks
  const headTurn = Math.random() > 0.5 ? 'left-first' : 'right-first';
  return { blinks_required: blinks, head_turn_order: headTurn };
}

async function register(req, res, next) {
  try {
    const { business_name, category, phone, nin, payout_account_number, payout_bank_code, location_state } = req.body;

    const existing = await vendorRepo.findByPhone(phone);
    if (existing) {
      return error(res, 'A vendor account with this phone number already exists.', 409);
    }

    // Verify payout bank account via Squad
    let payoutVerified = false;

    if (env.node_env === 'development' && env.squad.skip_bank_verification) {
      // ⚠️ DEVELOPMENT ONLY — bypasses Squad bank verification
      logger.warn('⚠️  BANK VERIFICATION SKIPPED (dev mode)', {
        account_number: payout_account_number,
        bank_code: payout_bank_code,
      });
      payoutVerified = true;
    } else {
      try {
          const verification = await squadService.verifyBankAccount({
            account_number: payout_account_number,
            bank_code: payout_bank_code,
          });


          if (!verification?.success) {
            return error(
              res,
              'Payout bank account could not be verified.',
              422
            );
          }

          logger.error("VERIFIED ACCOUNT NUMBER")
          payoutVerified = true;
        } catch (err) {
          logger.warn('Payout account verification failed', {
            account_number: payout_account_number,
            error: err.message,
          });

          return error(
            res,
            'Payout bank account could not be verified. Please check the account number and bank code.',
            422
          );
        }
    }

    const vendorId = uuidv4();
    const plainApiKey = generateApiKey();
    const hashedApiKey = await hashApiKey(plainApiKey);

    // Create vendor with payout_verified set immediately
    const vendor = await vendorRepo.create({
      id: vendorId,
      business_name,
      category,
      phone,
      nin,
      squad_payout_account: payout_account_number,
      squad_payout_bank_code: payout_bank_code,
      payout_verified: payoutVerified,  // ✅ Set at creation time
      location_state,
      api_key_hash: hashedApiKey,
    });

    // Remove the separate setPayoutVerified call since it's set above
    // if (payoutVerified) {
    //   await vendorRepo.setPayoutVerified(vendorId, true);
    // }

    const token = jwt.sign({ vendor_id: vendorId });

    logger.info('Vendor registered', { vendor_id: vendorId, business_name });

    return created(res, {
      vendor: {
        id: vendor.id,
        business_name: vendor.business_name,
        category: vendor.category,
        trust_score: 0,
        score_tier: 'Unverified',
        verification_status: 'pending',
      },
      api_key: plainApiKey,
      token,
    }, 'Vendor registered. Complete AI verification to activate your account.');
  } catch (err) {
    next(err);
  }
}

async function requestOTP(req, res, next) {
  try {
    const { phone } = req.body;

    // Validate phone number
    if (!phone || !phone.match(/^\+?[0-9]{10,15}$/)) {
      return error(res, 'Valid phone number is required', 400);
    }

    // Check if vendor exists
    const vendor = await vendorRepo.findByPhone(phone);

    if (!vendor) {
      return error(
        res,
        'No account found with this phone number. Please register first.',
        404
      );
    }

    // Send OTP (OTP is hardcoded to 000000 inside service)
    const otpResult = await otpService.sendOTP(phone);

    if (!otpResult.success) {
      return error(res, 'Failed to send OTP. Please try again.', 500);
    }

    return success(
      res,
      {
        otp_token: otpResult.token,
        expires_in_minutes: otpResult.expires_in_minutes,
        phone_masked: maskPhoneNumber(phone),

        // DEV ONLY
        dev_otp: otpResult.dev_otp,
      },
      'OTP sent successfully'
    );
  } catch (err) {
    next(err);
  }
}

async function verifyOTPAndLogin(req, res, next) {
  try {
    const { otp_token, otp_code } = req.body;

    // Validate inputs
    if (!otp_token || !otp_code) {
      return error(res, 'OTP token and code are required', 400);
    }

    if (!otp_code.match(/^\d{6}$/)) {
      return error(res, 'OTP code must be 6 digits', 400);
    }

    // Since OTP is hardcoded to 000000
    if (otp_code !== '000000') {
      return error(res, 'Invalid OTP', 401);
    }

    // Get stored OTP session
    const session = otpService.getSessionForDev(otp_token);

    if (!session) {
      return error(res, 'OTP session not found or expired', 404);
    }

    // Get vendor by phone
    const vendor = await vendorRepo.findByPhone(session.phone);

    if (!vendor) {
      return error(res, 'Vendor account not found', 404);
    }

    // Generate JWT token
    const token = jwt.sign({ vendor_id: vendor.id });

    // Get fresh vendor data
    const fullVendor = await vendorRepo.findById(vendor.id);

    logger.info('Vendor logged in', {
      vendor_id: vendor.id,
      phone: session.phone,
    });

    return success(
      res,
      {
        vendor: {
          id: fullVendor.id,
          business_name: fullVendor.business_name,
          category: fullVendor.category,
          trust_score: fullVendor.trust_score,
          score_tier: fullVendor.score_tier,
          verification_status: fullVendor.verification_status,
          payout_verified: fullVendor.payout_verified,
        },
        token,
      },
      'Login successful'
    );
  } catch (err) {
    next(err);
  }
}
// Helper function to mask phone number for display
function maskPhoneNumber(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.length <= 4) return '***';
  return cleaned.slice(0, 4) + '****' + cleaned.slice(-2);
}

// Add this function before the module.exports
async function devGetOTP(req, res, next) {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return error(res, 'Not available in production', 403);
    }
    
    const { otp_token } = req.query;
    
    if (!otp_token) {
      return error(res, 'otp_token is required', 400);
    }
    
    const session = otpService.getSessionForDev(otp_token);
    
    if (!session) {
      return error(res, 'Session not found', 404);
    }
    
    return success(res, {
      otp_code: session.otp,
      expires_at: session.expires_at,
      phone: session.phone
    }, 'Development OTP retrieval');
  } catch (err) {
    next(err);
  }
}

async function startVerification(req, res, next) {
  try {
    const vendorId = req.vendor.id;
    const sessionId = generateToken(16);
    const actionSequence = generateActionSequence();

    verificationSessions.set(sessionId, {
      vendor_id: vendorId,
      action_sequence: actionSequence,
      started_at: Date.now(),
      frames_received: 0,
      completed: false,
    });

    // Session expires in 10 minutes
    setTimeout(() => verificationSessions.delete(sessionId), 10 * 60 * 1000);

    logger.info('Verification session started', { vendor_id: vendorId, session_id: sessionId });

    return success(res, {
      session_id: sessionId,
      instructions: {
        step_1: 'Hold your NIN slip or valid government ID visible to the camera',
        step_2: `Blink ${actionSequence.blinks_required} times when prompted`,
        step_3: actionSequence.head_turn_order === 'left-first'
          ? 'Turn head LEFT then RIGHT when prompted'
          : 'Turn head RIGHT then LEFT when prompted',
      },
      expires_in_minutes: 10,
    }, 'Verification session started');
  } catch (err) {
    next(err);
  }
}

async function submitVerificationFrame(req, res, next) {
  try {
    const { session_id, frame_base64 } = req.body;
    const session = verificationSessions.get(session_id);

    if (!session) {
      return error(res, 'Verification session not found or expired. Please start a new session.', 404);
    }
    if (session.vendor_id !== req.vendor.id) {
      return error(res, 'Session does not belong to this vendor.', 403);
    }
    if (session.completed) {
      return error(res, 'Verification session already completed.', 409);
    }

    session.frames_received += 1;
    verificationSessions.set(session_id, session);

    const aiResult = await aiService.submitVerificationFrame(session_id, frame_base64);

    if (!aiResult.success) {
      logger.warn('AI frame processing failed', { session_id, error: aiResult.error });
      return success(res, {
        progress: 'processing',
        frame_count: session.frames_received,
        ai_status: 'fallback',
      }, 'Frame received. AI processing temporarily unavailable.');
    }

    return success(res, {
      progress: aiResult.data.progress || 'processing',
      face_distance: aiResult.data.face_distance,
      blink_detected: aiResult.data.blink_detected,
      head_yaw: aiResult.data.head_yaw,
      frame_count: session.frames_received,
    }, 'Frame processed');
  } catch (err) {
    next(err);
  }
}

async function completeVerification(req, res, next) {
  try {
    const { session_id } = req.body;
    const session = verificationSessions.get(session_id);

    if (!session) {
      return error(res, 'Verification session not found or expired.', 404);
    }
    if (session.vendor_id !== req.vendor.id) {
      return error(res, 'Session does not belong to this vendor.', 403);
    }

    const aiResult = await aiService.completeVerification(session_id);

    let verificationStatus = 'failed';
    let confidencePercent = 0;

    if (aiResult.success && aiResult.data) {
      verificationStatus = aiResult.data.verified ? 'passed' : 'failed';
      confidencePercent = aiResult.data.confidence_percent || 0;

      if (aiResult.data.confidence_percent >= 60 && aiResult.data.confidence_percent < 75) {
        verificationStatus = 'review';
      }
    } else {
      // AI service down — mark as review pending manual check
      verificationStatus = 'review';
      confidencePercent = 0;
      logger.warn('AI service unavailable during verification complete', { vendor_id: req.vendor.id });
    }

    await vendorRepo.updateVerification(req.vendor.id, {
      verification_status: verificationStatus,
      verification_confidence: confidencePercent,
    });

    session.completed = true;
    verificationSessions.set(session_id, session);

    const updatedScore = await trustScoreService.recalculate(req.vendor.id, 'verification_complete');

    logger.info('Vendor verification completed', {
      vendor_id: req.vendor.id,
      status: verificationStatus,
      confidence: confidencePercent,
    });

    return success(res, {
      verification_status: verificationStatus,
      confidence_percent: confidencePercent,
      trust_score: updatedScore?.trust_score,
      score_tier: updatedScore?.score_tier,
      failure_reason: aiResult.data?.failure_reason || null,
      deepfake_variance: aiResult.data?.deepfake_variance || null,
    }, verificationStatus === 'passed' ? 'Identity verified.' : 'Verification did not pass. Please retry.');
  } catch (err) {
    next(err);
  }
}

async function getScore(req, res, next) {
  try {
    const vendorId = req.params.id || req.vendor.id;
    const vendor = await vendorRepo.findById(vendorId);
    if (!vendor) return notFound(res, 'Vendor');

    const history = await vendorRepo.getScoreHistory(vendorId, 30);

    return success(res, {
      vendor_id: vendor.id,
      business_name: vendor.business_name,
      trust_score: vendor.trust_score,
      score_tier: vendor.score_tier,
      verification_status: vendor.verification_status,
      score_frozen: vendor.score_frozen,
      score_history: history,
    });
  } catch (err) {
    next(err);
  }
}

async function getTransactions(req, res, next) {
  try {
    const vendorId = req.vendor.id;
    const { status, page = 1, limit = 20 } = req.query;
    const txRepo = require('../repositories/transactionRepository');
    const transactions = await txRepo.listByVendor(vendorId, { status, page: parseInt(page), limit: parseInt(limit) });
    return success(res, { transactions, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}



async function getBanks(req, res, next) {
  try {
    const banksData = await squadService.getBankList();
    return success(res, {
      banks: banksData?.data || [],
    });
  } catch (err) {
    next(err);
  }
}

async function verifyInternal(req, res, next) {
  try {
    const vendorId = req.vendor.id;
    // We act as a B2B partner using the internal API key seeded in migration
    const internalApiKey = 'sk_live_vaulte_internal_commerce_api_key_v1';
    
    // The callback_url is our own webhook handler for internal commerce (if needed)
    // For now we just hit the B2B endpoint to get a session
    const port = process.env.PORT || 4000;
    const apiUrl = `http://localhost:${port}/v1/verify/session`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': internalApiKey
      },
      body: JSON.stringify({
        external_user_id: vendorId, // We map the vendor ID to the external_user_id
        callback_url: `https://cd69-2605-59c0-eb7-e210-ef65-afa1-e758-11fa.ngrok-free.app/api/commerce/webhooks/verify` // Dummy for now
      })
    });

    const data = await response.json();
    if (!response.ok) {
      logger.error('Failed internal verification request', { status: response.status, data });
      return error(res, 'Internal B2B verification failed', 500);
    }

    return success(res, {
      hosted_url: data.data.hosted_url,
      session_token: data.data.session_token
    }, 'Verification session generated via Infra API');
  } catch (err) {
      logger.error('Error calling internal infra API', {
        message: err.message,
        stack: err.stack
      });

      return error(res, err.message, 500);
    }}

module.exports = {
  register,
  startVerification,
  submitVerificationFrame,
  completeVerification,
  getScore,
  getTransactions,
  getBanks,
  requestOTP,           
  verifyOTPAndLogin,    
  devGetOTP,           
  verifyInternal
};