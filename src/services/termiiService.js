'use strict';
const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');

const termiiClient = axios.create({
  baseURL: 'https://v3.api.termii.com',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

async function sendSms(to, message) {
  if (!env.termii.api_key) {
    logger.warn('Termii API key not configured. SMS not sent.', { to });
    return { skipped: true, success: false };
  }

  const cleanPhone = to.replace(/^\+/, '');

  try {
    const response = await termiiClient.post('/api/sms/send', {
      api_key: env.termii.api_key,
      to: cleanPhone,
      from: env.termii.from || 'N-Alert',
      sms: message,
      type: 'plain',
      channel: 'generic',
    });

    logger.info('SMS sent', { to: cleanPhone, message_id: response.data?.message_id });
    return { success: true, data: response.data };

  } catch (err) {
    logger.error('SMS send failed', {
      to: cleanPhone,
      error: err.message,
      code: err.code,
      response: err.response?.data,
      status: err.response?.status,
    });
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

async function sendOtp(phone, otpCode) {
  const cleanPhone = phone.replace(/^\+/, '');

  const message = `Your Vaulte verification code is ${otpCode}. Valid for 10 minutes.`;

  const response = await termiiClient.post('/api/sms/send', {
    api_key: env.termii.api_key,
    to: cleanPhone,
    from: 'N-Alert',
    sms: message,
    type: 'plain',
    channel: 'generic',
  });

  return response.data;
}

// Alternative: If the above doesn't work, try the simple SMS approach
async function sendOtpViaSms(phone, otpCode) {
  if (!env.termii.api_key) {
    logger.warn('Termii API key not configured. OTP not sent.', { phone });
    return { skipped: true, success: false };
  }

  console.log({"OTPCODE": otpCode})
  const cleanPhone = phone.replace(/^\+/, '');
  const message = `Your Vaulte verification code is: ${otpCode}. Valid for 10 minutes.`;

  try {
    const response = await termiiClient.post('/api/sms/send', {
      api_key: env.termii.api_key,
      to: cleanPhone,
      from: 'N-Alert', 
      sms: message,
      type: 'plain',
      channel: 'dnd',
    });

    logger.info('OTP sent via SMS', { to: cleanPhone });
    return { success: true, data: response.data };

  } catch (err) {
    logger.error('OTP via SMS failed:', {
      phone: cleanPhone,
      error: err.response?.data || err.message
    });
    return { success: false, error: err.response?.data?.message || err.message };
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
  sendOtpViaSms,  // Export the alternative method
  sendDeliveryConfirmationLink,
  sendEscrowCreatedNotification,
  sendFundsReleasedNotification,
};