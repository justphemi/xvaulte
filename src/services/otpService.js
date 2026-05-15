'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

// In-memory OTP store (replace with Redis in production)
const otpStore = new Map();

class OTPService {

  // 🔒 Always return fixed OTP for testing
  generateOTP() {
    return "000000";
  }

  generateOTPToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  async sendOTP(phoneNumber) {
    const cleanPhone = phoneNumber.replace(/^\+/, '');

    const otp = this.generateOTP();
    const token = this.generateOTPToken();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    // Store OTP session
    otpStore.set(token, {
      phone: phoneNumber,
      otp: otp,
      expires_at: expiresAt,
      attempts: 0,
      verified: false,
      created_at: Date.now()
    });

    // Auto cleanup after expiry
    setTimeout(() => {
      const session = otpStore.get(token);
      if (session && !session.verified) {
        otpStore.delete(token);
        logger.info('OTP expired and cleaned up', { phone: phoneNumber });
      }
    }, 10 * 60 * 1000);

    // ================================
    // ❌ SMS PROVIDERS DISABLED
    // ================================

    /*
    // Twilio / Termii / SMS provider integration (DISABLED)

    try {
      await termiiService.sendOtpViaSms(cleanPhone, otp);
      logger.info('SMS sent via provider', { phone: cleanPhone });
    } catch (err) {
      logger.warn('SMS provider failed (ignored)', err.message);
    }
    */

    // ================================
    // ✅ DEV MODE RESPONSE ONLY
    // ================================
    logger.info('MOCK OTP GENERATED (NO SMS SENT)', {
      phone: phoneNumber,
      otp
    });

    return {
      success: true,
      token: token,
      expires_in_minutes: 10,

      // useful for frontend/dev testing
      dev_otp: otp
    };
  }

  async verifyOTP(token, otpInput) {
    const session = otpStore.get(token);

    if (!session) {
      return { success: false, error: 'OTP session not found or expired' };
    }

    if (session.verified) {
      return { success: false, error: 'OTP already verified' };
    }

    if (Date.now() > session.expires_at) {
      otpStore.delete(token);
      return { success: false, error: 'OTP has expired' };
    }

    session.attempts += 1;

    if (session.attempts > 5) {
      otpStore.delete(token);
      return {
        success: false,
        error: 'Too many failed attempts. Please request a new OTP.'
      };
    }

    if (session.otp !== otpInput) {
      otpStore.set(token, session);
      return {
        success: false,
        error: 'Invalid OTP',
        attempts_left: 5 - session.attempts
      };
    }

    session.verified = true;
    otpStore.set(token, session);

    logger.info('OTP verified successfully', {
      phone: session.phone
    });

    return {
      success: true,
      phone: session.phone
    };
  }

  getSessionForDev(token) {
    if (process.env.NODE_ENV !== 'development') {
      return null;
    }
    return otpStore.get(token);
  }
}

module.exports = new OTPService();