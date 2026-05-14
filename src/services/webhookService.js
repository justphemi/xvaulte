'use strict';

const axios = require('axios');
const { hmacSha256 } = require('../utils/crypto');
const logger = require('../utils/logger');
const db = require('../config/database');

/**
 * Dispatch a webhook to a partner.
 * @param {string} partnerId - The ID of the B2B partner.
 * @param {string} event - The event name (e.g., 'verification.completed').
 * @param {object} payload - The data to send.
 */
async function sendWebhook(partnerId, event, payload) {
  try {
    // 1. Fetch partner webhook config
    // For now, we assume partners have a webhook_secret and callback_url in the b2b_partners table.
    const result = await db.query(
      'SELECT webhook_secret, callback_url FROM b2b_partners WHERE id = $1',
      [partnerId]
    );

    const partner = result.rows[0];
    if (!partner || !partner.callback_url) {
      logger.warn('Partner has no webhook configuration', { partner_id: partnerId });
      return;
    }

    const webhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    const payloadString = JSON.stringify(webhookPayload);
    const signature = hmacSha256(payloadString, partner.webhook_secret || 'default_secret');

    logger.info('Dispatching outgoing webhook', { 
      partner_id: partnerId, 
      event, 
      url: partner.callback_url 
    });

    await axios.post(partner.callback_url, webhookPayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Vaulte-Signature': signature,
        'User-Agent': 'Vaulte-Webhook-Dispatcher/1.0',
      },
      timeout: 10000, // 10 seconds timeout
    });

    logger.info('Webhook dispatched successfully', { partner_id: partnerId, event });
  } catch (err) {
    logger.error('Webhook dispatch failed', { 
      partner_id: partnerId, 
      event, 
      error: err.message,
      response: err.response?.data
    });
    // In production, you might want to implement a retry queue here (e.g., BullMQ)
  }
}

module.exports = {
  sendWebhook,
};
