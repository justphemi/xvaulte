'use strict';

const { success, error } = require('../utils/response');
const { hmacSha512, timingSafeEqual } = require('../utils/crypto');
const transactionRepo = require('../repositories/transactionRepository');
const vendorRepo = require('../repositories/vendorRepository');
const aiService = require('../services/aiService');
const trustScoreService = require('../services/trustScoreService');
const smsService = require('../services/smsService');
const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * POST /api/webhooks/squad
 *
 * Squad webhook signature validation (Method 1 — Hash Comparison):
 * Header: x-squad-signature
 * Algorithm: HMAC-SHA512 of the raw JSON body using your secret key
 * Docs: https://docs.squadco.com/Virtual-accounts/api-specifications#webhook-validation---version-1
 *
 * Known webhook events from Squad docs:
 *   charge_successful   — card/bank/transfer payment completed
 *   transfer.success    — payout transfer completed
 *   virtual-account.credit — VA received funds
 */
async function handleSquadWebhook(req, res, next) {
  try {
    // ============================================================
    // STEP 1: Validate x-squad-signature header (HMAC-SHA512)
    // Per Squad docs, header is 'x-squad-signature', NOT x-squad-encrypted-body
    // ============================================================
    const receivedSig = req.headers['x-squad-signature'];

    if (!receivedSig) {
      logger.warn('Webhook received with no x-squad-signature header', { ip: req.ip });
      return error(res, 'Missing webhook signature', 401);
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      logger.warn('Webhook raw body not captured', { ip: req.ip });
      return error(res, 'Cannot verify request body', 400);
    }

    const expectedSig = hmacSha512(rawBody, env.squad.webhook_secret);

    if (!timingSafeEqual(expectedSig.toLowerCase(), receivedSig.toLowerCase())) {
      logger.warn('Webhook x-squad-signature mismatch', { ip: req.ip, received: receivedSig.substring(0, 20) });
      return error(res, 'Invalid webhook signature', 401);
    }

    // ============================================================
    // STEP 2: Parse and route the event
    // Squad uses "Event" (capital E) as the event field
    // ============================================================
    const event = req.body;
    const eventType = event?.Event || event?.event || '';
    const transactionRef = event?.TransactionRef || event?.transaction_ref || '';

    logger.info('Squad webhook validated and received', { event_type: eventType, transaction_ref: transactionRef });

    switch (eventType) {
      // Standard payment completion (card, bank transfer, USSD)
      case 'charge_successful':
        await handleChargeSuccessful(event);
        break;

      // Virtual account credit notification
      case 'virtual-account.credit':
        await handleVirtualAccountCredit(event);
        break;

      // Payout transfer success
      case 'transfer.success':
        logger.info('Transfer success webhook received', { ref: transactionRef });
        break;

      // Virtual account dynamic — expired
      case 'virtual-account.expired':
        logger.info('Virtual account expired webhook received', { ref: transactionRef });
        break;

      default:
        logger.info('Unhandled Squad webhook event', { event_type: eventType, ref: transactionRef });
    }

    // Always return 200 — Squad will mark as failed and retry if we don't
    return res.status(200).json({
      response_code: 200,
      transaction_reference: transactionRef,
      response_description: 'Success',
    });

  } catch (err) {
    logger.error('Webhook processing error', { error: err.message, stack: err.stack });
    // Return 200 to prevent Squad from retrying — log the failure internally
    return res.status(200).json({
      response_code: 200,
      response_description: 'Received with processing error',
    });
  }
}

/**
 * Handle charge_successful webhook event
 * Fired when a buyer pays via card, bank transfer, or USSD
 *
 * Event body shape (from Squad docs):
 * {
 *   "Event": "charge_successful",
 *   "TransactionRef": "SQTECH...",
 *   "Body": {
 *     "amount": 10000,
 *     "transaction_ref": "...",
 *     "gateway_ref": "..._1_1",
 *     "transaction_status": "Success",
 *     "email": "...",
 *     "merchant_id": "...",
 *     "currency": "NGN",
 *     "transaction_type": "Transfer",
 *     "merchant_amount": 10000
 *   }
 * }
 */
async function handleChargeSuccessful(event) {
  const body = event?.Body || {};
  const squadRef = event.TransactionRef || body.transaction_ref;
  const gatewayRef = body.gateway_ref;
  const merchantRef = body.transaction_ref; // This is what we passed as transaction_ref

  // Duplicate check — avoid processing same event twice
  const existingByRef = await transactionRepo.findBySquadRef(squadRef);
  if (existingByRef && existingByRef.escrow_status !== 'pending') {
    logger.info('Webhook: duplicate event ignored', { squad_ref: squadRef, status: existingByRef.escrow_status });
    return;
  }

  // Find transaction by the merchant ref we passed during initiation
  const transaction = await transactionRepo.findById(merchantRef);
  if (!transaction) {
    logger.warn('Webhook: transaction not found for merchant ref', { merchant_ref: merchantRef, squad_ref: squadRef });
    return;
  }

  if (transaction.escrow_status !== 'pending') {
    logger.info('Webhook: transaction already processed', { transaction_id: transaction.id, status: transaction.escrow_status });
    return;
  }

  // Mark as funded, store Squad refs for later refund/release use
  await transactionRepo.setFunded(transaction.id, squadRef, gatewayRef);

  logger.info('Escrow funded via webhook', {
    transaction_id: transaction.id,
    squad_ref: squadRef,
    gateway_ref: gatewayRef,
    amount: body.amount,
  });

  // API 2: Webhooks — trigger behavioral anomaly detection
  const anomalyResult = await aiService.runAnomalyDetection(transaction.vendor_id);
  if (anomalyResult.success && anomalyResult.data?.is_anomalous) {
    const { flag_level, triggered_signals } = anomalyResult.data;
    await transactionRepo.setAnomalyFlag(transaction.id, flag_level, triggered_signals);

    if (flag_level >= 2) {
      await vendorRepo.freezeScore(transaction.vendor_id, true);
      logger.warn('Anomaly level 2+ detected — vendor score frozen', {
        vendor_id: transaction.vendor_id,
        flag_level,
        signals: triggered_signals,
      });
    }
  }

  // Recalculate trust score (webhooks are the live AI data spine)
  await trustScoreService.recalculate(transaction.vendor_id, 'payment_received');

  // Send delivery confirmation SMS link to buyer
  if (transaction.buyer_phone) {
    const vendor = await vendorRepo.findById(transaction.vendor_id);
    await smsService.sendDeliveryConfirmationLink(
      transaction.buyer_phone,
      transaction.confirmation_link_token,
      vendor?.business_name || 'Vendor',
      transaction.amount
    );
  }
}

/**
 * Handle virtual-account.credit webhook
 * Fired when money is deposited into a dedicated virtual account
 */
async function handleVirtualAccountCredit(event) {
  const body = event?.Body || {};
  const vaNumber = body.virtual_account_number;
  const amount = body.amount;

  logger.info('Virtual account credit received', { va_number: vaNumber, amount });

  // Find transaction by VA account number
  const transaction = await transactionRepo.findByVaAccount(vaNumber);
  if (!transaction) {
    logger.warn('Webhook: no transaction found for VA', { va_number: vaNumber });
    return;
  }

  if (transaction.escrow_status !== 'pending') {
    logger.info('Webhook: VA credit but transaction already processed', { transaction_id: transaction.id });
    return;
  }

  await transactionRepo.setFunded(transaction.id, body.transaction_ref || vaNumber, body.gateway_ref || '');
  await trustScoreService.recalculate(transaction.vendor_id, 'payment_received');

  if (transaction.buyer_phone) {
    const vendor = await vendorRepo.findById(transaction.vendor_id);
    await smsService.sendDeliveryConfirmationLink(
      transaction.buyer_phone,
      transaction.confirmation_link_token,
      vendor?.business_name || 'Vendor',
      transaction.amount
    );
  }
}

module.exports = { handleSquadWebhook };