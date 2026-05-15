'use strict';
const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');

const termiiClient = axios.create({
  baseURL: env.termii.base_url, // https://v3.api.termii.com
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

async function sendSms(to, message) {
  if (!env.termii.api_key) {
    logger.warn('Termii API key not configured. SMS not sent.', { to, preview: message.substring(0, 60) });
    return { skipped: true };
  }

  const cleanPhone = to.replace(/^\+/, '');

  try {
    const response = await termiiClient.post('/api/sms/number/send', {
      // ✅ Number API — no Sender ID needed
      api_key: env.termii.api_key,
      to: cleanPhone,
      sms: message,
    });

    logger.info('SMS sent', { to: cleanPhone, status: response.data?.message, balance: response.data?.balance });
    return { success: true, data: response.data };

  } catch (err) {
    logger.error('SMS send failed', {
      to: cleanPhone,
      error: err.message,
      response: err.response?.data,
      status: err.response?.status,
    });
    return { success: false, error: err.message };
  }
}

async function sendOtp(phone, otpCode) {
  if (!env.termii.api_key) {
    logger.warn('Termii API key not configured. OTP not sent.', { phone });
    return { skipped: true };
  }

  const cleanPhone = phone.replace(/^\+/, '');

  try {
    const response = await termiiClient.post('/api/sms/otp/send', {
      api_key: env.termii.api_key,
      message_type: 'NUMERIC',
      to: cleanPhone,
      from: 'N-Alert',       // ✅ use N-Alert until Vaulte sender ID is approved
      channel: 'dnd',        // ✅ required for Nigerian numbers
      pin_attempts: 3,
      pin_time_to_live: 10,
      pin_length: 6,
      pin_placeholder: '< 123456 >',
      message_text: 'Your Vaulte verification code is < 123456 >. Valid for 10 minutes.',
      pin_code: otpCode,
    });

    logger.info('OTP sent', { to: cleanPhone, pinId: response.data?.pinId });
    return { success: true, data: response.data };

  } catch (err) {
    logger.error('OTP send failed', {
      to: cleanPhone,
      error: err.message,
      response: err.response?.data,
      status: err.response?.status,
    });
    return { success: false, error: err.message };
  }
}

async function sendDeliveryConfirmationLink(phone, token, vendorName, amount) {
  const confirmUrl = `${env.app.buyer_portal_url}/confirm/${token}`;
  const message =
    `Your order of NGN ${Number(amount).toLocaleString('en-NG')} from ${vendorName} is secured in escrow. ` +
    `Confirm delivery here: ${confirmUrl} (Link expires in ${env.escrow.auto_confirm_hours} hours)`;
  return sendSms(phone, message);
}

async function sendEscrowCreatedNotification(phone, vendorName, amount) {
  const message =
    `Payment of NGN ${Number(amount).toLocaleString('en-NG')} to ${vendorName} is secured in Vaulte escrow. ` +
    `Your funds are protected until you confirm delivery. Powered by Vaulte & Squad.`;
  return sendSms(phone, message);
}

async function sendFundsReleasedNotification(phone, amount) {
  const message =
    `NGN ${Number(amount).toLocaleString('en-NG')} has been released to your account via Squad. ` +
    `Delivery confirmed. Thank you for using Vaulte.`;
  return sendSms(phone, message);
}

module.exports = {
  sendSms,
  sendOtp,
  sendDeliveryConfirmationLink,
  sendEscrowCreatedNotification,
  sendFundsReleasedNotification,
};