'use strict';

const crypto = require('crypto');
const termiiService = require('./termiiService');
const logger = require('../utils/logger');

// In-memory OTP store (replace with Redis in production)
const otpStore = new Map();

class OTPService {
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  generateOTPToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  async sendOTP(phoneNumber) {
    const otp = this.generateOTP();
    const token = this.generateOTPToken();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    otpStore.set(token, {
      phone: phoneNumber,
      otp: otp,
      expires_at: expiresAt,
      attempts: 0,
      verified: false,
      created_at: Date.now()
    });

    setTimeout(() => {
      const session = otpStore.get(token);
      if (session && !session.verified) {
        otpStore.delete(token);
        logger.info('OTP expired and cleaned up', { phone: phoneNumber });
      }
    }, 10 * 60 * 1000);

    const message = `Your Vaulte verification code is: ${otp}. Valid for 10 minutes.`;
    const smsResult = await termiiService.sendSms(phoneNumber, message);

    logger.info('OTP sent', { phone: phoneNumber, smsResult });

    return {
      success: !smsResult.failed,
      token: token,
      expires_in_minutes: 10
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
      return { success: false, error: 'Too many failed attempts. Please request a new OTP.' };
    }

    if (session.otp !== otpInput) {
      otpStore.set(token, session);
      return { success: false, error: 'Invalid OTP', attempts_left: 5 - session.attempts };
    }

    session.verified = true;
    otpStore.set(token, session);

    logger.info('OTP verified successfully', { phone: session.phone });

    return {
      success: true,
      phone: session.phone
    };
  }

  // DEV ONLY - for testing
  getSessionForDev(token) {
    return otpStore.get(token);
  }
}

module.exports = new OTPService();