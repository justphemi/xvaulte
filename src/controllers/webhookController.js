// controllers/webhookController.js
'use strict';

const crypto = require('crypto');
const transactionRepo = require('../repositories/transactionRepository');
const vendorRepo = require('../repositories/vendorRepository');
const smsService = require('../services/smsService');
const trustScoreService = require('../services/trustScoreService');
const logger = require('../utils/logger');
const env = require('../config/env');

// controllers/webhookController.js
async function handleSquadWebhook(req, res) {
  try {
    const signature = req.headers['x-squad-encrypted-body'];  // ✅ Correct header name
    const rawBody = req.rawBody;  // Must be captured BEFORE JSON parsing
    
    if (!rawBody) {
      logger.error('Webhook rawBody missing - check middleware order');
      return res.status(400).json({ status: 'error', message: 'Invalid request' });
    }
    
    // Squad uses SHA512, not SHA256
    const expectedSignature = crypto
      .createHmac('sha512', env.squad.webhook_secret)  // ✅ SHA512
      .update(rawBody)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      logger.warn('Invalid Squad webhook signature', { 
        received: signature?.substring(0, 20), 
        expected: expectedSignature?.substring(0, 20) 
      });
      return res.status(401).json({ status: 'error', message: 'Invalid signature' });
    }
    
    const event = JSON.parse(rawBody);  // Parse after verification
    logger.info('Squad webhook verified', { event_type: event.Event || event.event });
    
    // Handle events (note: Squad uses PascalCase "Event" not lowercase "event")
    switch (event.Event || event.event) {
      case 'charge_successful':
      case 'charge.successful':
        await handleChargeSuccessful(event.Body || event.data);
        break;
      case 'transfer_success':
      case 'transfer.success':
        await handleTransferSuccessful(event.Body || event.data);
        break;
      default:
        logger.info('Unhandled webhook event', { event: event.Event || event.event });
    }
    
    res.status(200).json({ status: 'success' });
  } catch (err) {
    logger.error('Webhook processing error', { error: err.message, stack: err.stack });
    res.status(500).json({ status: 'error', message: 'Webhook processing failed' });
  }
}

async function handleChargeSuccessful(payload) {
  // Squad webhook structure varies - handle both formats
  const data = payload.Data || payload.data || payload;
  
  const transactionRef = data.transaction_ref || data.TransactionRef || data.merchant_ref;
  const gatewayRef = data.gateway_ref || data.GatewayTransactionRef;
  const amount = data.transaction_amount || data.Amount;
  
  logger.info('Processing charge successful webhook', { 
    transaction_ref: transactionRef,
    gateway_ref: gatewayRef,
    amount 
  });
  
  if (!transactionRef) {
    logger.error('No transaction reference in webhook payload', { payload });
    return;
  }
  
  const transaction = await transactionRepo.findById(transactionRef);
  
  if (!transaction) {
    logger.error('Transaction not found for webhook', { reference: transactionRef });
    return;
  }
  
  if (transaction.escrow_status !== 'pending') {
    logger.info('Transaction already processed', { 
      reference: transactionRef, 
      status: transaction.escrow_status 
    });
    return;
  }
  
  // ✅ Single correct call to setFunded
  await transactionRepo.setFunded(
    transaction.id,
    transactionRef,
    gatewayRef
  );
  
  const vendor = await vendorRepo.findById(transaction.vendor_id);
  
  if (transaction.buyer_phone) {
    try {
      await smsService.sendDeliveryConfirmationLink(
        transaction.buyer_phone,
        transaction.confirmation_link_token,
        transaction.amount,
        vendor.business_name
      );
    } catch (smsErr) {
      logger.warn('Failed to send confirmation SMS', { error: smsErr.message });
    }
  }
  
  logger.info('Escrow funded via webhook', { 
    transaction_id: transaction.id, 
    amount: transaction.amount,
    gateway_ref: gatewayRef
  });
}

async function handleTransferSuccessful(payload) {
  const { reference } = payload.data || payload;
  const transaction = await transactionRepo.findById(reference);
  
  if (transaction && transaction.escrow_status === 'released') {
    await trustScoreService.recalculate(transaction.vendor_id, 'payout_completed');
  }
}

async function handleTransferFailed(payload) {
  const { reference, reason } = payload.data || payload;
  logger.error('Transfer failed', { reference, reason });
  // Alert support team here
}

// In webhookController.js - REMOVE AFTER DEBUGGING
// In webhookController.js - add this TEMPORARY debug function
async function debugSquadWebhook(req, res) {
  logger.info('=== WEBHOOK DEBUG START ===', {
    headers: req.headers,
    rawBody: req.rawBody,
    rawBodyLength: req.rawBody?.length,
    parsedBody: req.body,
    path: req.path,
    method: req.method
  });
  
  res.status(200).json({ 
    status: 'debug_success', 
    received: {
      headers: req.headers,
      bodyType: typeof req.body,
      hasRawBody: !!req.rawBody,
      rawBodyPreview: req.rawBody?.substring(0, 100)
    }
  });
}

module.exports = { handleSquadWebhook, debugSquadWebhook };