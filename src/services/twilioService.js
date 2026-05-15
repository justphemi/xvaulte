'use strict';
const twilio = require('twilio');
const env = require('../config/env');
const logger = require('../utils/logger');

// Initialize Twilio client
let twilioClient = null;
let verifyService = null;

if (env.twilio.account_sid && env.twilio.auth_token) {
  twilioClient = twilio(env.twilio.account_sid, env.twilio.auth_token);
  
  // If using Twilio Verify service
  if (env.twilio.verify_service_sid) {
    verifyService = twilioClient.verify.v2.services(env.twilio.verify_service_sid);
  }
  
  logger.info('Twilio client initialized', {
    phoneNumber: env.twilio.phone_number,
    hasVerifyService: !!verifyService
  });
} else {
  logger.warn('Twilio credentials not configured. SMS features will be disabled.');
}

/**
 * Send regular SMS via Twilio
 */
async function sendSms(to, message) {
  if (!twilioClient) {
    logger.warn('Twilio not configured. SMS not sent.', { to });
    return { skipped: true, success: false };
  }

  const cleanPhone = formatPhoneNumber(to);

  try {
    const response = await twilioClient.messages.create({
      body: message,
      to: cleanPhone,
      from: env.twilio.phone_number,
    });

    logger.info('SMS sent via Twilio', { 
      to: cleanPhone, 
      sid: response.sid,
      status: response.status 
    });
    
    return { success: true, data: { sid: response.sid, status: response.status } };

  } catch (err) {
    logger.error('Twilio SMS send failed:', {
      to: cleanPhone,
      error: err.message,
      code: err.code,
      status: err.status
    });

    return { 
      success: false, 
      error: err.message,
      code: err.code 
    };
  }
}

/**
 * Send OTP via Twilio Verify API (Recommended approach)
 * This uses Twilio's built-in OTP verification system
 */
async function sendOtpViaVerify(phone) {
  if (!verifyService) {
    logger.warn('Twilio Verify service not configured');
    return { success: false, error: 'Verify service not configured' };
  }

  const cleanPhone = formatPhoneNumber(phone);

  try {
    const verification = await verifyService.verifications.create({
      to: cleanPhone,
      channel: 'sms',
    });

    logger.info('OTP verification sent via Twilio Verify', { 
      to: cleanPhone, 
      sid: verification.sid,
      status: verification.status 
    });

    return { 
      success: true, 
      data: { 
        sid: verification.sid, 
        status: verification.status 
      } 
    };

  } catch (err) {
    logger.error('Twilio Verify OTP send failed:', {
      phone: cleanPhone,
      error: err.message,
      code: err.code
    });

    return { 
      success: false, 
      error: err.message 
    };
  }
}

/**
 * Verify OTP via Twilio Verify API
 */
async function verifyOtpViaVerify(phone, code) {
  if (!verifyService) {
    logger.warn('Twilio Verify service not configured');
    return { success: false, error: 'Verify service not configured' };
  }

  const cleanPhone = formatPhoneNumber(phone);

  try {
    const verificationCheck = await verifyService.verificationChecks.create({
      to: cleanPhone,
      code: code,
    });

    const isValid = verificationCheck.status === 'approved';

    logger.info('OTP verification check', { 
      to: cleanPhone, 
      status: verificationCheck.status,
      valid: isValid 
    });

    return { 
      success: isValid, 
      data: { 
        status: verificationCheck.status,
        valid: isValid 
      },
      error: isValid ? null : 'Invalid verification code'
    };

  } catch (err) {
    logger.error('Twilio Verify OTP check failed:', {
      phone: cleanPhone,
      error: err.message,
      code: err.code
    });

    return { 
      success: false, 
      error: err.message 
    };
  }
}

/**
 * Send OTP via custom SMS (Fallback method)
 * Generate and send OTP code manually via SMS
 */
async function sendOtpViaSms(phone, otpCode) {
  if (!twilioClient) {
    logger.warn('Twilio not configured. OTP not sent.', { phone });
    return { skipped: true, success: false };
  }

  const cleanPhone = formatPhoneNumber(phone);
  const message = `Your Vaulte verification code is: ${otpCode}. Valid for 10 minutes.`;

  try {
    const response = await twilioClient.messages.create({
      body: message,
      to: cleanPhone,
      from: env.twilio.phone_number,
    });

    logger.info('OTP sent via Twilio SMS', { 
      to: cleanPhone, 
      sid: response.sid,
      status: response.status 
    });

    return { success: true, data: { sid: response.sid, status: response.status } };

  } catch (err) {
    logger.error('Twilio OTP SMS send failed:', {
      phone: cleanPhone,
      error: err.message,
      code: err.code
    });

    return { 
      success: false, 
      error: err.message 
    };
  }
}

/**
 * Send delivery confirmation link
 */
async function sendDeliveryConfirmationLink(phone, token, vendorName, amount) {
  const confirmUrl = `${env.app.buyer_portal_url}/confirm/${token}`;
  const message = 
    `Your order of NGN ${Number(amount).toLocaleString('en-NG')} from ${vendorName} is secured in escrow. ` +
    `Confirm delivery here: ${confirmUrl} (Link expires in ${env.escrow.auto_confirm_hours} hours)`;
  
  return sendSms(phone, message);
}

/**
 * Send escrow created notification
 */
async function sendEscrowCreatedNotification(phone, vendorName, amount) {
  const message = 
    `Payment of NGN ${Number(amount).toLocaleString('en-NG')} to ${vendorName} is secured in Vaulte escrow. ` +
    `Your funds are protected until you confirm delivery. Powered by Vaulte & Squad.`;
  
  return sendSms(phone, message);
}

/**
 * Send funds released notification
 */
async function sendFundsReleasedNotification(phone, amount) {
  const message = 
    `NGN ${Number(amount).toLocaleString('en-NG')} has been released to your account via Squad. ` +
    `Delivery confirmed. Thank you for using Vaulte.`;
  
  return sendSms(phone, message);
}

/**
 * Format phone number to E.164 format
 */
function formatPhoneNumber(phone) {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  
  // Handle Nigerian numbers
  if (cleaned.startsWith('234')) {
    return '+' + cleaned;
  }
  
  // Convert local format (0xxx) to international (+234xxx)
  if (cleaned.startsWith('0')) {
    return '+234' + cleaned.substring(1);
  }
  
  // If it already has a country code
  if (cleaned.length > 10) {
    return '+' + cleaned;
  }
  
  // Default: assume Nigerian number
  return '+234' + cleaned;
}

module.exports = {
  sendSms,
  sendOtpViaVerify,
  verifyOtpViaVerify,
  sendOtpViaSms,
  sendDeliveryConfirmationLink,
  sendEscrowCreatedNotification,
  sendFundsReleasedNotification,
  formatPhoneNumber,
};